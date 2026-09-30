import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type pg from "pg";
import type { Redis } from "ioredis";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { PDFDocument } from "pdf-lib";
import { CP, NOMBRE_TRANSPORTE, type TransporteTienda } from "@isu/shared";
import { ErrorTransporte, type Paquete, type Transportes } from "@isu/envios";
import type { Almacen } from "@isu/almacen";
import type { Entorno } from "../../entorno.js";
import type { Colas } from "../../lib/colas.js";
import { ErrorHttp } from "../../lib/errores.js";
import { ipDe } from "../../lib/cliente.js";
import type { CotizadorEnvios } from "../envios/cotizador.js";
import { auditar, exigir } from "./sesion.js";

/*
 * Backoffice de envíos (etapa 4). El circuito:
 *
 *   1. "Para preparar": pedidos pagados que salen con un transporte. Se
 *      eligen (de a muchos) y "Preparar" crea el envío en cada transporte,
 *      guarda la etiqueta y le pasa a Stocker el número de seguimiento.
 *   2. "Etiquetados": se imprimen las etiquetas (un solo PDF) y se arman los
 *      paquetes. El depósito los despacha desde Envíos del día en Stocker:
 *      ahí se descuenta el stock y Stocker le avisa a la tienda.
 *   3. "En camino": el worker sigue cada envío y avisa al cliente.
 *   4. "Problemas": no se pudo entregar, se devolvió o el transporte no responde.
 *
 * Mercado Envíos no se "prepara": el envío lo crea Mercado Pago con el pago;
 * acá sólo se trae (si todavía no llegó) y se baja su etiqueta.
 */
export interface DepsEnviosAdmin {
  pool: pg.Pool; redis: Redis; env: Entorno; colas: Colas; transportes: Transportes; cotizador: CotizadorEnvios; etiquetas: Almacen | null;
}

const NUMERO = z.string().regex(/^ISU-\d{4,10}$/);
const Numeros = z.array(NUMERO).min(1).max(30);
const VISTAS = ["preparar", "etiquetados", "en_camino", "problemas", "entregados"] as const;
/** Los que reintenta el worker sin respuesta del transporte: desde acá, "problema". */
const ERRORES_PROBLEMA = 5;

const CONDICION: Record<(typeof VISTAS)[number], string> = {
  preparar: "p.estado = 'pagado' AND p.transporte <> 'estandar' AND e.id IS NULL",
  etiquetados: "p.estado = 'pagado' AND e.id IS NOT NULL AND e.despachado_en IS NULL",
  en_camino: `e.despachado_en IS NOT NULL AND e.estado NOT IN ('entregado','no_entregado','devuelto','cancelado') AND e.errores_seguidos < ${ERRORES_PROBLEMA}`,
  problemas: `e.id IS NOT NULL AND (e.estado IN ('no_entregado','devuelto') OR e.errores_seguidos >= ${ERRORES_PROBLEMA})`,
  entregados: "e.estado = 'entregado' AND e.entregado_en > now() - interval '30 days'",
};

interface FilaPreparar {
  id: number; numero: string; estado: string; nombre: string; apellido: string; email: string; telefono: string; dni: string;
  direccion: { calle: string; numero: string; piso?: string; cp: string; localidad: string; provincia: string; indicaciones?: string } | null;
  transporte: TransporteTienda | "estandar"; servicio_envio: "domicilio" | "sucursal" | "en_el_dia"; sucursal_envio: { id: string } | null;
  paquete_envio: Paquete | null; total: number; subtotal: number; descuento: number; prendas: number;
}

export async function rutasEnviosAdmin(app: FastifyInstance, deps: DepsEnviosAdmin) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const { pool } = deps;
  const ip = (req: FastifyRequest) => ipDe(req, deps.env.INTERNO_TOKEN);

  api.get("/v1/admin/envios", {
    schema: { querystring: z.object({ vista: z.enum(VISTAS).default("preparar"), q: z.string().trim().max(80).optional() }).strict() },
  }, async (req) => {
    await exigir(pool, req);
    const params: unknown[] = [];
    let extra = "";
    if (req.query.q) { params.push(`%${req.query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`); extra = ` AND (p.numero ILIKE $1 OR p.email ILIKE $1 OR (p.nombre || ' ' || p.apellido) ILIKE $1 OR e.seguimiento ILIKE $1)`; }
    const { rows } = await pool.query(
      `SELECT p.numero, p.estado, p.nombre || ' ' || p.apellido AS cliente, p.transporte, p.servicio_envio AS servicio,
              p.direccion->>'cp' AS cp, p.direccion->>'localidad' AS localidad, p.sucursal_envio->>'nombre' AS sucursal,
              p.pagado_en AS "pagadoEn", p.avisos_whatsapp AS "avisosWhatsapp",
              (SELECT COALESCE(sum(cantidad), 0)::int FROM tienda.pedido_items i WHERE i.pedido_id = p.id) AS prendas,
              e.seguimiento, e.estado AS "estadoEnvio", e.etiqueta_clave IS NOT NULL AS "tieneEtiqueta",
              e.despachado_en AS "despachadoEn", e.entregado_en AS "entregadoEn", e.ultimo_error AS "ultimoError", e.errores_seguidos AS "erroresSeguidos"
         FROM tienda.pedidos p
         LEFT JOIN tienda.envios e ON e.pedido_id = p.id AND e.activo
        WHERE p.entrega = 'envio' AND ${CONDICION[req.query.vista]}${extra}
        ORDER BY p.servicio_envio = 'en_el_dia' DESC, p.pagado_en NULLS LAST, p.id
        LIMIT 300`, params);
    const conteo = await pool.query<{ vista: string; n: number }>(
      `SELECT v.vista, count(*)::int AS n FROM tienda.pedidos p LEFT JOIN tienda.envios e ON e.pedido_id = p.id AND e.activo,
         LATERAL (VALUES ${VISTAS.map((v) => `('${v}', ${CONDICION[v]})`).join(", ")}) AS v(vista, cumple)
        WHERE p.entrega = 'envio' AND v.cumple GROUP BY v.vista`);
    return {
      envios: rows.map((r) => ({ ...r, nombreTransporte: NOMBRE_TRANSPORTE[r.transporte as TransporteTienda] ?? r.transporte, urlSeguimiento: urlDe(r.transporte, r.seguimiento) })),
      conteo: Object.fromEntries(VISTAS.map((v) => [v, conteo.rows.find((c) => c.vista === v)?.n ?? 0])),
      transportes: Object.keys(deps.transportes.adaptadores),
    };
  });

  const urlDe = (t: string, s: string | null) => (s ? deps.transportes.adaptadores[t as TransporteTienda]?.urlSeguimiento(s) ?? null : null);

  /*
   * Preparar: por cada pedido, crear el envío en el transporte y guardar la
   * etiqueta. De a uno (los transportes no quieren ráfagas) y con un candado
   * por pedido: un doble clic no crea dos envíos (y dos cobros) en Andreani.
   */
  api.post("/v1/admin/envios/preparar", { schema: { body: z.object({ numeros: Numeros }).strict() } }, async (req) => {
    const a = await exigir(pool, req, "operador");
    const cfg = await deps.cotizador.config();
    const resultados: Array<{ numero: string; ok: boolean; seguimiento?: string; etiqueta?: boolean; mensaje?: string }> = [];
    for (const numero of [...new Set(req.body.numeros)]) {
      const candado = `isu:preparar:${numero}`;
      if (await deps.redis.set(candado, "1", "EX", 120, "NX").catch(() => "OK") !== "OK") {
        resultados.push({ numero, ok: false, mensaje: "Ya se está preparando (esperá unos segundos)." });
        continue;
      }
      try {
        resultados.push({ numero, ok: true, ...await preparar(numero, cfg, a.email) });
      } catch (e) {
        const mensaje = e instanceof ErrorHttp ? e.message
          : e instanceof ErrorTransporte ? `${NOMBRE_TRANSPORTE[e.transporte as TransporteTienda] ?? e.transporte}: ${e.message}`
          : "No se pudo crear el envío. Probá de nuevo en un rato.";
        if (!(e instanceof ErrorHttp)) req.log.warn({ err: e, numero }, "no se pudo preparar el envío");
        resultados.push({ numero, ok: false, mensaje: mensaje.slice(0, 300) });
      } finally {
        await deps.redis.del(candado).catch(() => 0);
      }
    }
    await auditar(pool, a, "preparar_envios", "envio", null, resultados.map((r) => ({ numero: r.numero, ok: r.ok, seguimiento: r.seguimiento })), ip(req));
    return { resultados };
  });

  async function preparar(numero: string, cfg: Awaited<ReturnType<CotizadorEnvios["config"]>>, quien: string) {
    const { rows } = await pool.query<FilaPreparar>(
      `SELECT p.*, (SELECT COALESCE(sum(cantidad), 0)::int FROM tienda.pedido_items i WHERE i.pedido_id = p.id) AS prendas
         FROM tienda.pedidos p WHERE p.numero = $1`, [numero]);
    const p = rows[0];
    if (!p) throw new ErrorHttp(404, "no_encontrado", "No existe ese pedido.");
    if (p.estado !== "pagado") throw new ErrorHttp(409, "no_pagado", "Sólo se preparan pedidos pagados que no salieron.");
    if (!p.transporte || p.transporte === "estandar") throw new ErrorHttp(409, "sin_transporte", "Este pedido va con envío estándar: se marca a mano.");
    const vigente = await pool.query("SELECT 1 FROM tienda.envios WHERE pedido_id = $1 AND activo", [p.id]);
    if (vigente.rowCount) throw new ErrorHttp(409, "ya_preparado", "Ya tiene un envío. Si hay que rehacerlo, descartalo primero.");

    const t = p.transporte;
    const paquete = p.paquete_envio ?? deps.cotizador.paquete({ lineas: [], filas: new Map(), neto: p.subtotal - p.descuento }, cfg);
    let seguimiento: string, externoId: string | null, etiqueta: Buffer | null;

    if (t === "mercado_envios") {
      // Lo creó Mercado Pago con el pago; si el worker no lo trajo todavía, se busca ahora.
      const me = deps.transportes.mercadoEnvios;
      if (!me) throw new ErrorHttp(409, "sin_transporte", "Mercado Envíos no está configurado.");
      const pago = await pool.query<{ externo: string }>("SELECT externo FROM tienda.pagos WHERE pedido_id = $1 AND proveedor = 'mercadopago' AND estado = 'aprobado' ORDER BY id DESC LIMIT 1", [p.id]);
      const envio = pago.rows[0] ? await me.envioDePago(pago.rows[0].externo) : null;
      if (!envio) throw new ErrorHttp(409, "me_sin_envio", "Mercado Pago todavía no generó el envío de este pedido. Probá en unos minutos.");
      seguimiento = envio.id; externoId = envio.id;
      etiqueta = await me.etiqueta({ seguimiento, externoId }).catch(() => null);
      if (envio.costo !== null) await pool.query("UPDATE tienda.pedidos SET envio_mercado_pago = $2 WHERE id = $1", [p.id, envio.costo]);
    } else {
      const ad = deps.transportes.adaptadores[t];
      if (!ad) throw new ErrorHttp(409, "sin_transporte", `${NOMBRE_TRANSPORTE[t]} no está configurado (faltan las credenciales).`);
      if (p.servicio_envio !== "sucursal" && !p.direccion) throw new ErrorHttp(409, "sin_direccion", "El pedido no tiene dirección.");
      const d = p.direccion;
      const cp = d ? CP.safeParse(d.cp) : null;
      const creado = await ad.crearEnvio({
        pedido: p.numero,
        servicio: p.servicio_envio,
        destinatario: { nombre: p.nombre, apellido: p.apellido, email: p.email, telefono: p.telefono, dni: p.dni },
        direccion: d ? { calle: d.calle, numero: d.numero, piso: d.piso || null, cp: cp?.success ? cp.data : d.cp, localidad: d.localidad, provincia: d.provincia, indicaciones: d.indicaciones || null } : null,
        sucursal: p.sucursal_envio?.id ?? null,
        paquete,
        origen: { ...cfg.origen, piso: cfg.origen.piso || null },
      });
      seguimiento = creado.seguimiento; externoId = creado.externoId;
      etiqueta = creado.etiqueta ?? await ad.etiqueta({ seguimiento, externoId }).catch(() => null);
    }

    let clave: string | null = null;
    if (etiqueta && deps.etiquetas) {
      if (etiqueta.subarray(0, 5).toString("latin1") !== "%PDF-") throw new ErrorHttp(502, "etiqueta", "El transporte devolvió una etiqueta que no es un PDF.");
      clave = `e/${p.id}/${randomBytes(12).toString("hex")}.pdf`;
      await deps.etiquetas.guardar(clave, etiqueta, "application/pdf");
    }
    // El mismo número otra vez (Mercado Envíos después de descartar): se reactiva. De OTRO pedido: error.
    const ins = await pool.query(
      `INSERT INTO tienda.envios (pedido_id, transporte, servicio, seguimiento, externo_id, etiqueta_clave, creado_por, proximo_chequeo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now() + interval '30 minutes')
       ON CONFLICT (transporte, seguimiento) DO UPDATE
         SET activo = true, estado = 'creado', etiqueta_clave = COALESCE(EXCLUDED.etiqueta_clave, tienda.envios.etiqueta_clave), actualizado_en = now()
       WHERE tienda.envios.pedido_id = EXCLUDED.pedido_id`,
      [p.id, t, p.servicio_envio, seguimiento, externoId, clave, quien]);
    if (!ins.rowCount) throw new ErrorHttp(409, "seguimiento_repetido", `El transporte devolvió un número (${seguimiento}) que ya es de otro pedido. Revisalo en su portal.`);
    await pool.query("INSERT INTO tienda.pedido_eventos (pedido_id, estado, detalle, actor) VALUES ($1, 'pagado', $2, $3)",
      [p.id, `Envío preparado: ${NOMBRE_TRANSPORTE[t]} ${seguimiento}`, quien]);
    // Stocker: el número de seguimiento sale en Envíos del día (con reintentos).
    await deps.colas.stocker("envio", { numero: p.numero, tipo: t, seguimiento }, `envio-${p.numero}-${seguimiento}`);
    return { seguimiento, etiqueta: clave !== null };
  }

  // Todas las etiquetas elegidas en un solo PDF, para imprimir de una vez.
  api.get("/v1/admin/envios/etiquetas", {
    schema: { querystring: z.object({ numeros: z.string().transform((s) => s.split(",")).pipe(Numeros) }).strict() },
  }, async (req, reply) => {
    const a = await exigir(pool, req, "operador");
    if (!deps.etiquetas) throw new ErrorHttp(503, "sin_almacen", "No hay dónde guardar etiquetas (configurá R2 o COMPROBANTES_DIR).");
    const { rows } = await pool.query<{ id: number; pedido_id: number; numero: string; transporte: string; seguimiento: string; externo_id: string | null; etiqueta_clave: string | null }>(
      `SELECT e.id, e.pedido_id, p.numero, e.transporte, e.seguimiento, e.externo_id, e.etiqueta_clave FROM tienda.envios e JOIN tienda.pedidos p ON p.id = e.pedido_id
        WHERE p.numero = ANY($1::text[]) AND e.activo ORDER BY array_position($1::text[], p.numero::text)`, [req.query.numeros]);
    const salida = await PDFDocument.create();
    const sinEtiqueta: string[] = [];
    for (const r of rows) {
      // La que no se bajó al preparar (Mercado Envíos, o el transporte tardó): se pide ahora y se guarda.
      if (!r.etiqueta_clave) {
        const ad = r.transporte === "mercado_envios" ? deps.transportes.mercadoEnvios : deps.transportes.adaptadores[r.transporte as TransporteTienda];
        const pdf = await ad?.etiqueta({ seguimiento: r.seguimiento, externoId: r.externo_id }).catch(() => null);
        if (!pdf || pdf.subarray(0, 5).toString("latin1") !== "%PDF-") { sinEtiqueta.push(r.numero); continue; }
        r.etiqueta_clave = `e/${r.pedido_id}/${randomBytes(12).toString("hex")}.pdf`;
        await deps.etiquetas.guardar(r.etiqueta_clave, pdf, "application/pdf");
        await pool.query("UPDATE tienda.envios SET etiqueta_clave = $2 WHERE id = $1", [r.id, r.etiqueta_clave]);
      }
      const datos = await deps.etiquetas.leer(r.etiqueta_clave);
      if (!datos) continue;
      try {
        const doc = await PDFDocument.load(datos, { updateMetadata: false });
        for (const pag of await salida.copyPages(doc, doc.getPageIndices())) salida.addPage(pag);
      } catch (e) {
        req.log.warn({ err: e, numero: r.numero }, "etiqueta ilegible");
      }
    }
    if (!salida.getPageCount()) {
      throw new ErrorHttp(404, "sin_etiquetas", "Ninguno de esos pedidos tiene etiqueta para imprimir (Correo Argentino se imprime desde MiCorreo).");
    }
    if (sinEtiqueta.length) reply.header("x-isu-sin-etiqueta", sinEtiqueta.join(","));
    await auditar(pool, a, "imprimir_etiquetas", "envio", null, rows.map((r) => r.numero), ip(req));
    reply.header("content-type", "application/pdf");
    reply.header("content-disposition", `attachment; filename="etiquetas-${new Date().toISOString().slice(0, 10)}.pdf"`);
    reply.header("x-content-type-options", "nosniff");
    return reply.send(Buffer.from(await salida.save()));
  });

  // Descartar la etiqueta (dirección mal cargada, paquete distinto): el pedido vuelve a "Para preparar".
  api.post("/v1/admin/envios/:numero/descartar", {
    schema: { params: z.object({ numero: NUMERO }), body: z.object({ motivo: z.string().trim().min(3).max(300) }).strict() },
  }, async (req) => {
    const a = await exigir(pool, req, "operador");
    const { rows } = await pool.query<{ id: number; pedido_id: number; transporte: string; seguimiento: string }>(
      `UPDATE tienda.envios e SET activo = false, estado = 'cancelado', actualizado_en = now()
         FROM tienda.pedidos p
        WHERE p.id = e.pedido_id AND p.numero = $1 AND e.activo AND e.despachado_en IS NULL
        RETURNING e.id, e.pedido_id, e.transporte, e.seguimiento`, [req.params.numero]);
    const e = rows[0];
    if (!e) throw new ErrorHttp(409, "no_descartable", "No hay una etiqueta sin despachar para descartar (si ya salió, se sigue desde En camino).");
    await pool.query("INSERT INTO tienda.pedido_eventos (pedido_id, estado, detalle, actor) VALUES ($1, 'pagado', $2, $3)",
      [e.pedido_id, `Etiqueta descartada (${e.seguimiento}): ${req.body.motivo}`, a.email]);
    await auditar(pool, a, "descartar_envio", "envio", e.id, { numero: req.params.numero, seguimiento: e.seguimiento, motivo: req.body.motivo }, ip(req));
    return { ok: true, aviso: e.transporte === "mercado_envios" ? null : `Si el envío llegó a cargarse en ${NOMBRE_TRANSPORTE[e.transporte as TransporteTienda]}, anulalo también en su portal.` };
  });

  // Preguntarle ya al transporte cómo viene (sin esperar la vuelta del worker).
  api.post("/v1/admin/envios/:numero/actualizar", { schema: { params: z.object({ numero: NUMERO }) } }, async (req) => {
    const a = await exigir(pool, req, "operador");
    const { rows } = await pool.query<{ id: number }>(
      "SELECT e.id FROM tienda.envios e JOIN tienda.pedidos p ON p.id = e.pedido_id WHERE p.numero = $1 AND e.activo", [req.params.numero]);
    if (!rows[0]) throw new ErrorHttp(404, "sin_envio", "Este pedido no tiene envío.");
    await pool.query("UPDATE tienda.envios SET proximo_chequeo = now(), errores_seguidos = 0 WHERE id = $1", [rows[0].id]);
    await deps.colas.envios("seguir", { envioId: rows[0].id }, `seguir-${rows[0].id}-${Math.floor(Date.now() / 60_000)}`);
    await auditar(pool, a, "actualizar_envio", "envio", rows[0].id, null, ip(req));
    return { ok: true };
  });

  // Detalle del envío de un pedido (para la ficha del pedido).
  api.get("/v1/admin/envios/:numero", { schema: { params: z.object({ numero: NUMERO }) } }, async (req) => {
    await exigir(pool, req);
    const { rows } = await pool.query(
      `SELECT e.id, e.transporte, e.servicio, e.seguimiento, e.estado, e.activo, e.etiqueta_clave IS NOT NULL AS "tieneEtiqueta",
              e.despachado_en AS "despachadoEn", e.entregado_en AS "entregadoEn", e.ultimo_error AS "ultimoError", e.creado_por AS "creadoPor", e.creado_en AS "creadoEn"
         FROM tienda.envios e JOIN tienda.pedidos p ON p.id = e.pedido_id WHERE p.numero = $1 ORDER BY e.activo DESC, e.id DESC LIMIT 10`, [req.params.numero]);
    const vigente = rows.find((r) => r.activo);
    const eventos = vigente
      ? (await pool.query("SELECT fecha, estado, descripcion, ubicacion FROM tienda.envio_eventos WHERE envio_id = $1 ORDER BY fecha DESC, id DESC LIMIT 100", [vigente.id])).rows
      : [];
    const avisos = (await pool.query(
      "SELECT a.tipo, a.canal, a.creado_en AS \"creadoEn\" FROM tienda.avisos a JOIN tienda.pedidos p ON p.id = a.pedido_id WHERE p.numero = $1 ORDER BY a.id", [req.params.numero])).rows;
    return { envios: rows.map((r) => ({ ...r, urlSeguimiento: urlDe(r.transporte, r.seguimiento) })), eventos, avisos };
  });
}
