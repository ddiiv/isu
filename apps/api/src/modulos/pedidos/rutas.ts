import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type pg from "pg";
import type { Redis } from "ioredis";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { Arrepentimiento, Cotizacion, ESTADOS_PENDIENTES, PedidoCotizar, PedidoCreado, PedidoNuevo, PedidoPublico } from "@isu/shared";
import type { Almacen } from "@isu/almacen";
import type { Entorno } from "../../entorno.js";
import { ErrorHttp } from "../../lib/errores.js";
import { frenar } from "../../lib/frenos.js";
import { esInterno, ipDe } from "../../lib/cliente.js";
import { iguales, tokenNuevo } from "../../lib/cripto.js";
import { firmaValida, type MercadoPago } from "../../lib/mercadopago.js";
import type { Colas } from "../../lib/colas.js";
import { sesionDe } from "../cuentas/rutas.js";
import { conEnvio, cotizar } from "./cotizar.js";
import type { Descuentos } from "../../lib/descuentos.js";
import type { ServicioPedidos } from "./servicio.js";
import type { CotizadorEnvios } from "../envios/cotizador.js";
import { CP } from "@isu/shared";

export interface DepsRutasPedidos {
  pool: pg.Pool; redis: Redis; env: Entorno; servicio: ServicioPedidos; mp: MercadoPago | null;
  comprobantes: Almacen | null; colas: Colas; descuentos: Descuentos; cotizador?: CotizadorEnvios;
}

const NUMERO = z.string().regex(/^ISU-\d{4,10}$/);
const ACCESO = /^[A-Za-z0-9_-]{30,40}$/;
const sinCache = { "cache-control": "no-store" };

export async function rutasPedidos(app: FastifyInstance, deps: DepsRutasPedidos) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const { servicio } = deps;
  const ip = (req: FastifyRequest) => ipDe(req, deps.env.INTERNO_TOKEN);
  const quien = async (req: FastifyRequest) => {
    const s = await sesionDe(req, deps);
    const h = req.headers["x-isu-acceso"];
    return { clienteId: s?.clienteId ?? null, acceso: typeof h === "string" && ACCESO.test(h) ? h : null };
  };

  // ── Carrito: cotización (precios, stock, envío y descuento de verdad) ──
  api.post("/v1/carrito", { schema: { body: PedidoCotizar, response: { 200: Cotizacion } } }, async (req, reply) => {
    // Probar códigos es gratis para quien adivina: con tope por IP (sólo cuenta si escribió uno).
    if (req.body.cupon?.trim()) await frenar(deps.redis, "cupon-ip", ip(req), 40, 600);
    const c = await cotizar(deps.pool, req.body.items, {
      entrega: req.body.entrega, medioPago: req.body.medioPago, descuentos: deps.descuentos, cupon: req.body.cupon, email: req.body.email,
    });
    reply.headers(sinCache);
    // Con la opción de envío elegida en el checkout, el total la incluye. Si ya no está, sin opción (la tienda vuelve a pedir las opciones).
    const e = req.body.envio;
    let opcionEnvio;
    if (e && deps.cotizador && req.body.entrega === "envio") {
      const cp = CP.safeParse(e.cp);
      const o = cp.success
        ? await deps.cotizador.elegir({ destino: { cp: cp.data, provincia: e.provincia, localidad: e.localidad }, carrito: { lineas: c.lineas, filas: c.filas, neto: c.neto }, medioPago: req.body.medioPago, id: e.opcion }).catch(() => null)
        : null;
      conEnvio(c, o?.precio ?? 0, { soloMercadoPago: o?.soloMercadoPago });
      opcionEnvio = o;
    }
    const { filas: _f, cobrado: _c, aplicado: _a, neto: _n, envioBonificado: _e, cuponInvalido: _i, ...publica } = c;
    return opcionEnvio === undefined ? publica : { ...publica, opcionEnvio };
  });

  // ── Crear pedido ──
  api.post("/v1/pedidos", { schema: { body: PedidoNuevo, response: { 201: PedidoCreado } } }, async (req, reply) => {
    // Por IP con margen: una familia o una oficina comparten IP. Por email, más corto.
    await frenar(deps.redis, "pedidos-ip", ip(req), 20, 600);
    await frenar(deps.redis, "pedidos-email", req.body.contacto.email, 6, 600);
    const s = await sesionDe(req, deps);
    const r = await servicio.crear(req.body, { clienteId: s?.clienteId ?? null, ip: ip(req) });
    reply.code(201).headers(sinCache);
    return r;
  });

  // ── Ver pedido (dueño con sesión, o quien tiene el enlace) ──
  api.get("/v1/pedidos/:numero", { schema: { params: z.object({ numero: NUMERO }), response: { 200: PedidoPublico } } }, async (req, reply) => {
    await frenar(deps.redis, "ver-pedido", ip(req), 120, 60);
    let p = await servicio.delDueno(req.params.numero, await quien(req));
    // Volviendo de Mercado Pago el aviso puede no haber llegado: se pregunta (como mucho cada 15 s por pedido).
    if (p.estado === "esperando_pago" && deps.mp) {
      const primera = await deps.redis.set(`isu:consulta-mp:${p.numero}`, "1", "EX", 15, "NX").catch(() => "OK");
      if (primera === "OK") {
        await servicio.consultarMp(p.numero).catch(() => {});
        p = await servicio.delDueno(req.params.numero, await quien(req));
      }
    }
    reply.headers(sinCache);
    return servicio.publico(p);
  });

  // ── Link de pago nuevo (reintentar Mercado Pago / Pago Fácil) ──
  api.post("/v1/pedidos/:numero/pagar", { schema: { params: z.object({ numero: NUMERO }), response: { 200: z.object({ url: z.string() }) } } }, async (req, reply) => {
    await frenar(deps.redis, "pagar", ip(req), 20, 600);
    const q = await quien(req);
    const p = await servicio.delDueno(req.params.numero, q);
    if (p.estado !== "esperando_pago") throw new ErrorHttp(409, "no_pendiente", "Este pedido ya no está esperando el pago.");
    const url = await servicio.linkDePago(p, q.acceso);
    if (!url) throw new ErrorHttp(409, "sin_link", "Este pedido no se paga online.");
    reply.headers(sinCache);
    return { url };
  });

  // ── Comprobante de transferencia (imagen o PDF, privado) ──
  await app.register(async (sub) => {
    const TIPOS = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];
    sub.addContentTypeParser(TIPOS, { parseAs: "buffer", bodyLimit: 6 * 1024 * 1024 }, (_req, cuerpo, hecho) => hecho(null, cuerpo));
    sub.withTypeProvider<ZodTypeProvider>().post(
      "/v1/pedidos/:numero/comprobante",
      { schema: { params: z.object({ numero: NUMERO }) }, bodyLimit: 6 * 1024 * 1024 },
      async (req, reply) => {
        if (!deps.comprobantes) throw new ErrorHttp(503, "sin_almacen", "Por ahora mandanos el comprobante por WhatsApp.");
        await frenar(deps.redis, "comprobante", ip(req), 10, 3600);
        const p = await servicio.delDueno(req.params.numero, await quien(req));
        if (p.medio_pago !== "transferencia" || !["esperando_transferencia", "transferencia_informada"].includes(p.estado)) {
          throw new ErrorHttp(409, "no_corresponde", "Este pedido no está esperando una transferencia.");
        }
        const cuantos = (await deps.pool.query("SELECT count(*)::int AS n FROM tienda.comprobantes WHERE pedido_id = $1", [p.id])).rows[0].n;
        if (cuantos >= 5) throw new ErrorHttp(409, "demasiados", "Ya subiste 5 comprobantes para este pedido. Si hace falta otro, escribinos por WhatsApp.");
        const datos = req.body as Buffer;
        if (!Buffer.isBuffer(datos) || datos.length < 100) throw new ErrorHttp(400, "archivo_invalido", "El archivo llegó vacío.");
        // Se mira el contenido, no lo que dice el navegador que es.
        const esPdf = datos.subarray(0, 5).toString("latin1") === "%PDF-";
        let final: Buffer, tipo: "image/webp" | "application/pdf", ext: string;
        if (esPdf) {
          final = datos; tipo = "application/pdf"; ext = "pdf";
        } else {
          try {
            // Se vuelve a codificar: sale una imagen limpia, sin metadatos ni nada escondido.
            final = await sharp(datos, { limitInputPixels: 50_000_000, failOn: "error" }).rotate()
              .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
            tipo = "image/webp"; ext = "webp";
          } catch {
            throw new ErrorHttp(400, "archivo_invalido", "Subí una foto (JPG, PNG) o un PDF del comprobante.");
          }
        }
        const clave = `c/${p.id}/${randomBytes(12).toString("hex")}.${ext}`;
        await deps.comprobantes.guardar(clave, final, tipo);
        await deps.pool.query("INSERT INTO tienda.comprobantes (pedido_id, clave, tipo, bytes) VALUES ($1, $2, $3, $4)", [p.id, clave, tipo, final.length]);
        if (p.estado === "esperando_transferencia") {
          await deps.pool.query("UPDATE tienda.pedidos SET estado = 'transferencia_informada', actualizado_en = now() WHERE id = $1", [p.id]);
          await servicio.evento(deps.pool, p.id, "transferencia_informada", "cliente", "Subió el comprobante");
          await deps.colas.email("transferencia_informada", p.email, { numero: p.numero, nombre: p.nombre });
        }
        reply.code(201).headers(sinCache);
        return { ok: true };
      },
    );
  });

  // ── Aviso de Mercado Pago ──
  api.post("/v1/pagos/mercadopago/aviso", async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const b = (req.body ?? {}) as { type?: string; data?: { id?: string | number } };
    const tipo = q.type ?? q.topic ?? b.type;
    const dataId = String(q["data.id"] ?? q.id ?? b.data?.id ?? "");
    if (!deps.mp || !deps.env.MP_WEBHOOK_SECRET) return reply.code(503).send({ error: "sin_mercadopago" });
    if (!/^\d{1,20}$/.test(dataId)) return reply.code(200).send({ ok: true, ignorado: "sin_id" });
    const firma = typeof req.headers["x-signature"] === "string" ? req.headers["x-signature"] : undefined;
    const rid = typeof req.headers["x-request-id"] === "string" ? req.headers["x-request-id"] : undefined;
    if (!firmaValida({ firma, requestId: rid, dataId, secreto: deps.env.MP_WEBHOOK_SECRET })) {
      req.log.warn({ dataId }, "aviso de Mercado Pago con firma inválida");
      return reply.code(401).send({ error: "firma_invalida" });
    }
    if (tipo && tipo !== "payment") return reply.code(200).send({ ok: true, ignorado: tipo });
    // No se cree el aviso: se le pregunta a Mercado Pago por ese pago.
    const pago = await deps.mp.pago(dataId);
    const r = await servicio.aplicarPagoMp(pago, "mercadopago (aviso)");
    return reply.code(200).send({ ok: true, aplicado: r.aplicado });
  });

  /*
   * ── Registrar un pago por API ──
   * Transferencias acreditadas y cobros en el local. Lo usa el backoffice
   * (etapa 3) o una integración con el banco, con su propia credencial.
   */
  api.post("/v1/pagos/registrar", {
    schema: {
      body: z.object({
        pedido: NUMERO,
        medio: z.enum(["transferencia", "local"]),
        monto: z.number().int().positive(),              // centavos
        referencia: z.string().trim().min(3).max(80),    // nro de operación, recibo…
        quien: z.string().trim().min(2).max(150),
      }).strict(),
    },
  }, async (req, reply) => {
    const h = req.headers.authorization ?? "";
    if (!deps.env.PAGOS_TOKEN || !iguales(h, `Bearer ${deps.env.PAGOS_TOKEN}`)) return reply.code(401).send({ error: "credencial", mensaje: "Credencial inválida." });
    const b = req.body;
    const { rows } = await deps.pool.query<{ medio_pago: string }>("SELECT medio_pago FROM tienda.pedidos WHERE numero = $1", [b.pedido]);
    if (!rows[0]) throw new ErrorHttp(404, "no_encontrado", "No existe ese pedido.");
    const r = await servicio.pagar(b.pedido, { proveedor: b.medio, externo: b.referencia, monto: b.monto, detalle: { medioPedido: rows[0].medio_pago }, quien: b.quien });
    reply.headers(sinCache);
    return r;
  });

  // ── Tareas del worker (sólo con la credencial interna) ──
  const soloInterno = (req: FastifyRequest) => {
    if (!esInterno(req, deps.env.INTERNO_TOKEN)) throw new ErrorHttp(404, "no_encontrado", "No existe.");
  };
  api.post("/v1/interno/vencer", async (req) => { soloInterno(req); return servicio.vencer(); });
  api.post("/v1/interno/conciliar-mp", async (req) => { soloInterno(req); return servicio.conciliarMp(); });

  // ── Botón de arrepentimiento (Res. 424/2020) ──
  api.post("/v1/arrepentimiento", { schema: { body: Arrepentimiento, response: { 201: z.object({ codigo: z.string(), mensaje: z.string() }) } } }, async (req, reply) => {
    await frenar(deps.redis, "arrepentimiento", ip(req), 5, 3600);
    const b = req.body;
    const codigo = `ARR-${tokenNuevo(6).replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase().padEnd(6, "X")}`;
    const { rows } = await deps.pool.query("SELECT * FROM tienda.pedidos WHERE numero = $1 AND email = $2", [b.numero, b.email]);
    const p = rows[0];
    let resultado = "a_revisar";
    let mensaje = `Recibimos tu pedido de arrepentimiento. Tu código de trámite es ${codigo}. Te contactamos dentro de las 24 horas hábiles.`;
    if (p && (ESTADOS_PENDIENTES as readonly string[]).includes(p.estado)) {
      const c = await servicio.liberar(p, "cancelado", `Arrepentimiento ${codigo}`, "cliente").catch(() => null);
      if (c) { resultado = "cancelado"; mensaje = `Tu pedido ${b.numero} quedó cancelado. Código de trámite: ${codigo}. No se te va a cobrar.`; }
    } else if (p && p.estado === "pagado" && await servicio.sigueEnDeposito(p.numero).catch(() => false)) {
      // Cobrado pero todavía en el depósito: se cancela ya y se devuelve el dinero. Si ya salió, lo resuelve una persona (devolución).
      const c = await servicio.liberar(p, "cancelado", `Arrepentimiento ${codigo}: devolver el dinero`, "cliente").catch(() => null);
      if (c) { resultado = "cancelado_reembolso"; mensaje = `Tu pedido ${b.numero} quedó cancelado y te vamos a devolver el dinero por el mismo medio de pago. Código de trámite: ${codigo}.`; }
    }
    await deps.pool.query(
      "INSERT INTO tienda.arrepentimientos (codigo, pedido_id, numero, email, nombre, motivo, resultado, ip) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [codigo, p?.id ?? null, b.numero, b.email, b.nombre, b.motivo ?? null, resultado, ip(req)],
    );
    // El mail sólo si el email es el del pedido: si no, el formulario serviría para mandarle mails a cualquiera.
    if (p) await deps.colas.email("arrepentimiento", b.email, { codigo, numero: b.numero, nombre: b.nombre, resultado });
    reply.code(201).headers(sinCache);
    return { codigo, mensaje };
  });
}
