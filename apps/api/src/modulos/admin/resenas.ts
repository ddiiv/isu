import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type pg from "pg";
import type { Redis } from "ioredis";
import { z } from "zod";
import {
  ALINEACIONES_BANNER, BANNERS_SUGERIDOS, BotonBanner, FONDOS_BANNER, PRODUCTO_AUTO, VARIABLES_BANNER, type BannerPublico,
} from "@isu/shared";
import { claveNueva, FotoInvalida, procesarBanner, type Almacen } from "@isu/almacen";
import type { Entorno } from "../../entorno.js";
import type { CacheCorta } from "../../lib/cache.js";
import type { Colas } from "../../lib/colas.js";
import { ErrorHttp } from "../../lib/errores.js";
import { ipDe } from "../../lib/cliente.js";
import type { Descuentos } from "../../lib/descuentos.js";
import { armarBanner, COLUMNAS_BANNER, productoDeBanner, variablesDeBanners, type FilaBanner } from "../portada/banners.js";
import { auditar, exigir } from "./sesion.js";

/*
 * Backoffice de la etapa 8: reseñas (moderar y responder) y portada (banners).
 *
 * Moderar es para lo que no se puede publicar (insultos, datos personales,
 * algo que no es sobre la compra), no para esconder las malas: una tienda
 * con sólo 5 estrellas no le parece creíble a nadie, y la ley de defensa
 * del consumidor no deja mostrar opiniones elegidas como si fueran todas.
 */
const Id = z.coerce.number().int().positive().max(2_147_483_647);
const POR_PAGINA = 30;
const Ruta = z.string().trim().max(300).regex(/^\/([^/\\\s]|$)[^\s\\]*$/, "Una dirección de esta tienda, que empiece con / (por ejemplo /mujer o /packs)");

export async function rutasResenasAdmin(app: FastifyInstance, deps: {
  pool: pg.Pool; redis: Redis; env: Entorno; cache: CacheCorta; colas: Colas; canalInvalidar: string; banners: Almacen | null; descuentos: Descuentos;
}) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const { pool } = deps;
  const ip = (req: FastifyRequest) => ipDe(req, deps.env.INTERNO_TOKEN);
  async function invalidar(slugs: string[]) {
    deps.cache.limpiar();
    await deps.redis.publish(deps.canalInvalidar, JSON.stringify({ etiquetas: ["catalogo"] })).catch(() => 0);
    await deps.colas.stocker("invalidar", { slugs: slugs.slice(0, 500) });
  }

  // ── Reseñas ──────────────────────────────────────────────────────
  api.get("/v1/admin/resenas", {
    schema: {
      querystring: z.object({
        estado: z.enum(["pendiente", "publicada", "rechazada", "todas"]).default("pendiente"),
        q: z.string().trim().max(80).optional(),
        pagina: z.coerce.number().int().min(1).max(1000).default(1),
      }).strict(),
    },
  }, async (req) => {
    await exigir(pool, req);
    const { estado, q, pagina } = req.query;
    const w: string[] = [];
    const params: unknown[] = [];
    if (estado !== "todas") { params.push(estado); w.push(`r.estado = $${params.length}`); }
    if (q) {
      params.push(`%${q.replace(/[%_\\]/g, "\\$&")}%`);
      w.push(`(r.texto ILIKE $${params.length} OR r.nombre ILIKE $${params.length} OR pe.numero ILIKE $${params.length} OR p.nombre ILIKE $${params.length})`);
    }
    params.push(POR_PAGINA, (pagina - 1) * POR_PAGINA);
    const [lista, cuentas] = await Promise.all([
      pool.query(
        `SELECT r.id, r.estrellas, r.texto, r.calce, r.talle, r.color, r.nombre, r.estado, r.respuesta, r.creado_en AS "creadoEn",
                r.moderada_por AS "moderadaPor", r.moderada_en AS "moderadaEn",
                pe.numero AS pedido, p.id AS "productoId", p.nombre AS producto, p.slug,
                count(*) OVER()::int AS "totalFilas"
           FROM tienda.resenas r JOIN tienda.pedidos pe ON pe.id = r.pedido_id
           LEFT JOIN tienda.productos p ON p.id = r.producto_id
          ${w.length ? `WHERE ${w.join(" AND ")}` : ""}
          ORDER BY r.creado_en ${estado === "pendiente" ? "ASC" : "DESC"}, r.id
          LIMIT $${params.length - 1} OFFSET $${params.length}`, params),
      pool.query<{ estado: string; n: number }>("SELECT estado, count(*)::int AS n FROM tienda.resenas GROUP BY estado"),
    ]);
    return {
      resenas: lista.rows.map(({ totalFilas: _t, ...r }) => r),
      total: lista.rows[0]?.totalFilas ?? 0,
      porPagina: POR_PAGINA,
      cuentas: Object.fromEntries(cuentas.rows.map((c) => [c.estado, c.n])),
    };
  });

  api.patch("/v1/admin/resenas/:id", {
    schema: {
      params: z.object({ id: Id }),
      body: z.object({
        estado: z.enum(["publicada", "rechazada", "pendiente"]).optional(),
        // La respuesta de la tienda se ve debajo de la reseña. "" = sacarla.
        respuesta: z.string().trim().max(1000).nullable().optional(),
      }).strict().refine((b) => b.estado !== undefined || b.respuesta !== undefined, "Nada para cambiar"),
    },
  }, async (req) => {
    const a = await exigir(pool, req, "operador");
    const { estado, respuesta } = req.body;
    const sets: string[] = [];
    const params: unknown[] = [req.params.id];
    if (estado !== undefined) {
      params.push(estado, a.email);
      sets.push(`estado = $${params.length - 1}`, `moderada_por = $${params.length}`, "moderada_en = now()");
    }
    if (respuesta !== undefined) {
      params.push(respuesta || null, !!respuesta);
      sets.push(`respuesta = $${params.length - 1}`, `respondida_en = CASE WHEN $${params.length}::boolean THEN now() ELSE NULL END`);
    }
    const { rows } = await pool.query<{ slug: string | null }>(
      `UPDATE tienda.resenas r SET ${sets.join(", ")} WHERE r.id = $1
       RETURNING (SELECT slug FROM tienda.productos WHERE id = r.producto_id) AS slug`, params,
    );
    if (!rows[0]) throw new ErrorHttp(404, "no_encontrado", "No existe esa reseña.");
    await auditar(pool, a, "moderar_resena", "resena", req.params.id, req.body, ip(req));
    await invalidar(rows[0].slug ? [rows[0].slug] : []);
    return { ok: true };
  });

  // Aprobar varias de una (las pendientes que ya se leyeron).
  api.post("/v1/admin/resenas/masivo", {
    schema: { body: z.object({ ids: z.array(Id).min(1).max(200), estado: z.enum(["publicada", "rechazada"]) }).strict() },
  }, async (req) => {
    const a = await exigir(pool, req, "operador");
    const ids = [...new Set(req.body.ids)];
    const { rows } = await pool.query<{ slug: string | null }>(
      `UPDATE tienda.resenas r SET estado = $2, moderada_por = $3, moderada_en = now() WHERE r.id = ANY($1::int[])
       RETURNING (SELECT slug FROM tienda.productos WHERE id = r.producto_id) AS slug`, [ids, req.body.estado, a.email],
    );
    await auditar(pool, a, "moderar_resenas", "resena", null, { ids, estado: req.body.estado }, ip(req));
    await invalidar([...new Set(rows.map((r) => r.slug).filter((s): s is string => !!s))]);
    return { ok: true, cambiadas: rows.length };
  });

  // ── Portada: banners del inicio ──────────────────────────────────
  // Etapa 12: interactivos (título, texto, etiqueta, botones, fondo, producto). El producto va por su slug, nunca por el id.
  const COLS = `b.id, b.alt, b.enlace, b.foto, b.foto_ancho AS "fotoAncho", b.foto_alto AS "fotoAlto", b.foto_movil AS "fotoMovil", b.movil_ancho AS "movilAncho",
    b.movil_alto AS "movilAlto", b.orden, b.activo, b.desde, b.hasta, b.creado_en AS "creadoEn",
    b.titulo, b.texto, b.etiqueta, b.botones, b.fondo, b.alineacion, p.slug AS producto, p.nombre AS "productoNombre", b.producto_auto AS "productoAuto",
    b.ocultar_sin_producto AS "ocultarSinProducto", b.sugerido`;
  const DESDE = "FROM tienda.banners b LEFT JOIN tienda.productos p ON p.id = b.producto_id";
  const leerBanner = async (id: number) => (await pool.query(`SELECT ${COLS} ${DESDE} WHERE b.id = $1`, [id])).rows[0];
  const textoOpcional = (max: number) => z.string().trim().max(max).nullable().transform((v) => v || null);
  const SlugProducto = z.string().regex(/^[a-z0-9][a-z0-9-]*$/).max(160);
  // Las variables que se pueden usar en los textos ({descuento}…): una desconocida es un error de tipeo.
  const variablesConocidas = (t: string | null | undefined) => !t || [...t.matchAll(/\{(\w+)\}/g)].every((m) => m[1]! in VARIABLES_BANNER);
  const MENSAJE_VARIABLES = `Variable desconocida. Las que hay: ${Object.keys(VARIABLES_BANNER).map((k) => `{${k}}`).join(", ")}.`;
  const CamposBanner = {
    alt: z.string().trim().min(2, "Describí qué se ve en el banner").max(160),
    enlace: Ruta.nullable(),
    orden: z.number().int().min(-1000).max(1000),
    activo: z.boolean(),
    desde: z.iso.datetime({ offset: true }).nullable(),
    hasta: z.iso.datetime({ offset: true }).nullable(),
    titulo: textoOpcional(90),
    texto: textoOpcional(220),
    etiqueta: textoOpcional(40),
    botones: z.array(BotonBanner).max(2, "Hasta 2 botones"),
    fondo: z.enum(FONDOS_BANNER),
    alineacion: z.enum(ALINEACIONES_BANNER),
    producto: SlugProducto.nullable(),
    productoAuto: z.enum(PRODUCTO_AUTO).nullable(),
    ocultarSinProducto: z.boolean(),
  };
  type Campos = { [K in keyof typeof CamposBanner]?: z.infer<(typeof CamposBanner)[K]> };
  const revisar = (b: Campos, ctx: z.RefinementCtx) => {
    for (const k of ["alt", "titulo", "texto", "etiqueta"] as const) if (!variablesConocidas(b[k])) ctx.addIssue({ code: "custom", path: [k], message: MENSAJE_VARIABLES });
    (b.botones ?? []).forEach((x, i) => { if (!variablesConocidas(x.texto)) ctx.addIssue({ code: "custom", path: ["botones", i, "texto"], message: MENSAJE_VARIABLES }); });
    if (b.producto && b.productoAuto) ctx.addIssue({ code: "custom", path: ["producto"], message: "Elegí un producto o uno automático, no los dos." });
    if (b.desde && b.hasta && new Date(b.hasta) <= new Date(b.desde)) ctx.addIssue({ code: "custom", path: ["hasta"], message: "La fecha de fin tiene que ser posterior al inicio" });
  };
  const Banner = z.object({
    ...CamposBanner,
    enlace: CamposBanner.enlace.default(null).transform((v) => v || null),
    orden: CamposBanner.orden.default(0), activo: CamposBanner.activo.default(true),
    desde: CamposBanner.desde.default(null), hasta: CamposBanner.hasta.default(null),
    titulo: CamposBanner.titulo.default(null), texto: CamposBanner.texto.default(null), etiqueta: CamposBanner.etiqueta.default(null),
    botones: CamposBanner.botones.default([]), fondo: CamposBanner.fondo.default("marca"), alineacion: CamposBanner.alineacion.default("izquierda"),
    producto: CamposBanner.producto.default(null), productoAuto: CamposBanner.productoAuto.default(null), ocultarSinProducto: CamposBanner.ocultarSinProducto.default(false),
  }).strict().superRefine(revisar);
  // Para editar: todo opcional y SIN valores por defecto (un cambio de orden no tiene que apagar el banner).
  const CambiosBanner = z.object(Object.fromEntries(Object.entries(CamposBanner).map(([k, v]) => [k, v.optional()])) as { [K in keyof typeof CamposBanner]: z.ZodOptional<(typeof CamposBanner)[K]> })
    .strict().superRefine(revisar);
  const COLUMNA: Record<string, string> = {
    alt: "alt", enlace: "enlace", orden: "orden", activo: "activo", desde: "desde", hasta: "hasta", titulo: "titulo", texto: "texto", etiqueta: "etiqueta",
    botones: "botones", fondo: "fondo", alineacion: "alineacion", producto: "producto_id", productoAuto: "producto_auto", ocultarSinProducto: "ocultar_sin_producto",
  };
  /** El producto elegido por su slug → su id (sólo adentro de la base). */
  const idDeProducto = async (slug: string | null | undefined) => {
    if (!slug) return null;
    const r = await pool.query<{ id: number }>("SELECT id FROM tienda.productos WHERE slug = $1 AND eliminado_en IS NULL", [slug]);
    if (!r.rows[0]) throw new ErrorHttp(400, "producto", "No existe ese producto.");
    return r.rows[0].id;
  };
  const valorDe = async (k: string, v: unknown) => (k === "botones" ? JSON.stringify(v) : k === "producto" ? idDeProducto(v as string | null) : k === "enlace" ? v || null : v);

  /** La vista previa: el banner como lo ve la tienda (aunque esté apagado), o por qué no sale. */
  const vistas = async (ids: number[]) => {
    const vars = await variablesDeBanners(pool);
    const { rows } = await pool.query<FilaBanner>(`SELECT ${COLUMNAS_BANNER} FROM tienda.banners WHERE id = ANY($1::int[])`, [ids]);
    const salida: Record<number, { banner: BannerPublico | null; motivo: string | null }> = {};
    for (const b of rows) salida[b.id] = await armarBanner(pool, deps.descuentos, b, vars);
    return { vistas: salida, variables: vars };
  };

  api.get("/v1/admin/banners", async (req) => {
    await exigir(pool, req);
    const { rows } = await pool.query(`SELECT ${COLS} ${DESDE} ORDER BY b.orden, b.id`);
    return { banners: rows, ...(await vistas(rows.map((r) => r.id))) };
  });

  // Para la vista previa mientras se edita: la tarjeta del producto elegido o del automático.
  api.get("/v1/admin/banners/producto", {
    schema: { querystring: z.object({ producto: SlugProducto.optional(), auto: z.enum(PRODUCTO_AUTO).optional() }).strict() },
  }, async (req) => {
    await exigir(pool, req);
    const id = req.query.producto ? await idDeProducto(req.query.producto) : null;
    return { producto: await productoDeBanner(pool, deps.descuentos, { producto_id: id, producto_auto: id ? null : req.query.auto ?? null }) };
  });

  api.post("/v1/admin/banners", { schema: { body: Banner } }, async (req) => {
    const a = await exigir(pool, req, "operador");
    const b = req.body;
    const n = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM tienda.banners");
    if (n.rows[0]!.n >= 30) throw new ErrorHttp(409, "tope", "Hay 30 banners: borrá alguno viejo antes de crear otro.");
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO tienda.banners (alt, enlace, orden, activo, desde, hasta, titulo, texto, etiqueta, botones, fondo, alineacion, producto_id, producto_auto, ocultar_sin_producto)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id`,
      [b.alt, b.enlace, b.orden, b.activo, b.desde, b.hasta, b.titulo, b.texto, b.etiqueta, JSON.stringify(b.botones), b.fondo, b.alineacion,
        await idDeProducto(b.producto), b.productoAuto, b.ocultarSinProducto],
    );
    await auditar(pool, a, "crear_banner", "banner", rows[0]!.id, b, ip(req));
    await invalidar([]);
    return { banner: await leerBanner(rows[0]!.id) };
  });

  // Vuelve a agregar los sugeridos que falten (apagados, para revisarlos y prenderlos).
  api.post("/v1/admin/banners/sugeridos", async (req) => {
    const a = await exigir(pool, req, "operador");
    let creados = 0;
    for (const [i, s] of BANNERS_SUGERIDOS.entries()) {
      const r = await pool.query(
        `INSERT INTO tienda.banners (sugerido, orden, activo, alt, titulo, texto, etiqueta, botones, fondo, alineacion, producto_auto, ocultar_sin_producto)
         VALUES ($1, $2, false, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT (sugerido) DO NOTHING`,
        [s.sugerido, 100 + i, s.alt, s.titulo, s.texto, s.etiqueta, JSON.stringify(s.botones), s.fondo, s.alineacion, s.productoAuto, s.ocultarSinProducto]);
      creados += r.rowCount ?? 0;
    }
    if (creados) await auditar(pool, a, "banners_sugeridos", "banner", null, { creados }, ip(req));
    return { creados };
  });

  api.patch("/v1/admin/banners/:id", { schema: { params: z.object({ id: Id }), body: CambiosBanner } }, async (req) => {
    const a = await exigir(pool, req, "operador");
    const sets: string[] = [];
    const params: unknown[] = [req.params.id];
    for (const [k, v] of Object.entries(req.body)) {
      if (v === undefined) continue;
      params.push(await valorDe(k, v));
      sets.push(`${COLUMNA[k]} = $${params.length}`);
    }
    if (!sets.length) throw new ErrorHttp(400, "nada", "Nada para cambiar.");
    try {
      const r = await pool.query(`UPDATE tienda.banners SET ${sets.join(", ")}, actualizado_en = now() WHERE id = $1`, params);
      if (!r.rowCount) throw new ErrorHttp(404, "no_encontrado", "No existe ese banner.");
      await auditar(pool, a, "editar_banner", "banner", req.params.id, req.body, ip(req));
      await invalidar([]);
      return { banner: await leerBanner(req.params.id), ...(await vistas([req.params.id])) };
    } catch (e) {
      const c = (e as { code?: string; constraint?: string });
      if (c.code === "23514" && c.constraint === "banners_un_producto") throw new ErrorHttp(400, "producto", "Elegí un producto o uno automático, no los dos.");
      if (c.code === "23514") throw new ErrorHttp(400, "fechas", "Revisá las fechas: el fin tiene que ser posterior al inicio.");
      throw e;
    }
  });

  api.delete("/v1/admin/banners/:id", { schema: { params: z.object({ id: Id }) } }, async (req) => {
    const a = await exigir(pool, req, "operador");
    const { rows } = await pool.query<{ foto: string | null; foto_movil: string | null }>("DELETE FROM tienda.banners WHERE id = $1 RETURNING foto, foto_movil", [req.params.id]);
    if (!rows[0]) throw new ErrorHttp(404, "no_encontrado", "No existe ese banner.");
    await auditar(pool, a, "borrar_banner", "banner", req.params.id, null, ip(req));
    await invalidar([]);
    // Los archivos se borran después de regenerar el inicio (así no se ve una foto rota).
    for (const clave of [rows[0].foto, rows[0].foto_movil]) {
      if (clave && deps.banners) for (const w of [800, 1600, 2400]) await deps.banners.borrar(`${clave}-${w}.webp`).catch(() => {});
    }
    return { ok: true };
  });

  // La foto del banner: para compu (`tipo=escritorio`, apaisada) o para celular (`tipo=movil`, vertical).
  await app.register(async (sub) => {
    const TIPOS = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/avif"];
    sub.addContentTypeParser(TIPOS, { parseAs: "buffer", bodyLimit: 26 * 1024 * 1024 }, (_r, cuerpo, hecho) => hecho(null, cuerpo));
    sub.withTypeProvider<ZodTypeProvider>().post("/v1/admin/banners/:id/foto", {
      bodyLimit: 26 * 1024 * 1024,
      schema: { params: z.object({ id: Id }), querystring: z.object({ tipo: z.enum(["escritorio", "movil"]) }).strict() },
    }, async (req) => {
      const a = await exigir(pool, req, "operador");
      if (!deps.banners) throw new ErrorHttp(503, "sin_almacen", "No hay almacén de fotos configurado (FOTOS_DIR o R2).");
      const ex = await pool.query<{ foto: string | null; foto_movil: string | null }>("SELECT foto, foto_movil FROM tienda.banners WHERE id = $1", [req.params.id]);
      if (!ex.rows[0]) throw new ErrorHttp(404, "no_encontrado", "No existe ese banner.");
      let proc;
      try { proc = await procesarBanner(req.body as Buffer); } catch (e) {
        throw new ErrorHttp(400, "foto_invalida", e instanceof FotoInvalida ? e.message : "No se pudo procesar la imagen.");
      }
      // Sin el id del banner: la dirección de la foto es pública.
      const clave = claveNueva("b");
      try {
        for (const t of proc.tamanos) await deps.banners.guardar(`${clave}-${t.ancho}.webp`, t.datos, "image/webp");
      } catch (e) {
        for (const w of [800, 1600, 2400]) await deps.banners.borrar(`${clave}-${w}.webp`).catch(() => {});
        throw e;
      }
      const movil = req.query.tipo === "movil";
      await pool.query(
        movil
          ? "UPDATE tienda.banners SET foto_movil = $2, movil_ancho = $3, movil_alto = $4, actualizado_en = now() WHERE id = $1"
          : "UPDATE tienda.banners SET foto = $2, foto_ancho = $3, foto_alto = $4, actualizado_en = now() WHERE id = $1",
        [req.params.id, clave, proc.ancho, proc.alto],
      );
      await auditar(pool, a, "foto_banner", "banner", req.params.id, { tipo: req.query.tipo }, ip(req));
      await invalidar([]);
      const vieja = movil ? ex.rows[0].foto_movil : ex.rows[0].foto;
      if (vieja) for (const w of [800, 1600, 2400]) await deps.banners.borrar(`${vieja}-${w}.webp`).catch(() => {});
      return { clave, ancho: proc.ancho, alto: proc.alto };
    });
  });

  // Sacar la foto de celular (vuelve a usar la de compu).
  api.delete("/v1/admin/banners/:id/foto-movil", { schema: { params: z.object({ id: Id }) } }, async (req) => {
    const a = await exigir(pool, req, "operador");
    const { rows } = await pool.query<{ vieja: string | null }>(
      "UPDATE tienda.banners b SET foto_movil = NULL, movil_ancho = NULL, movil_alto = NULL, actualizado_en = now() FROM (SELECT id, foto_movil AS vieja FROM tienda.banners WHERE id = $1) x WHERE b.id = x.id RETURNING x.vieja",
      [req.params.id],
    );
    if (!rows[0]) throw new ErrorHttp(404, "no_encontrado", "No existe ese banner.");
    await auditar(pool, a, "foto_banner", "banner", req.params.id, { tipo: "movil", borrada: true }, ip(req));
    await invalidar([]);
    if (rows[0].vieja && deps.banners) for (const w of [800, 1600, 2400]) await deps.banners.borrar(`${rows[0].vieja}-${w}.webp`).catch(() => {});
    return { ok: true };
  });

  // Sacar la foto (las dos: la de celular sin la de compu no se usa): queda un banner de texto sobre el fondo de color.
  api.delete("/v1/admin/banners/:id/foto", { schema: { params: z.object({ id: Id }) } }, async (req) => {
    const a = await exigir(pool, req, "operador");
    const ex = await pool.query<{ titulo: string | null }>("SELECT titulo FROM tienda.banners WHERE id = $1", [req.params.id]);
    if (!ex.rows[0]) throw new ErrorHttp(404, "no_encontrado", "No existe ese banner.");
    if (!ex.rows[0].titulo) throw new ErrorHttp(409, "sin_titulo", "Un banner sin título necesita la foto: escribí un título antes de sacarla.");
    const { rows } = await pool.query<{ foto: string | null; movil: string | null }>(
      `UPDATE tienda.banners b SET foto = NULL, foto_ancho = NULL, foto_alto = NULL, foto_movil = NULL, movil_ancho = NULL, movil_alto = NULL, actualizado_en = now()
         FROM (SELECT id, foto, foto_movil AS movil FROM tienda.banners WHERE id = $1 FOR UPDATE) x WHERE b.id = x.id AND b.titulo IS NOT NULL RETURNING x.foto, x.movil`,
      [req.params.id],
    );
    if (!rows[0]) throw new ErrorHttp(409, "sin_titulo", "Un banner sin título necesita la foto: escribí un título antes de sacarla.");
    await auditar(pool, a, "foto_banner", "banner", req.params.id, { tipo: "escritorio", borrada: true }, ip(req));
    await invalidar([]);
    for (const vieja of [rows[0].foto, rows[0].movil]) {
      if (vieja && deps.banners) for (const w of [800, 1600, 2400]) await deps.banners.borrar(`${vieja}-${w}.webp`).catch(() => {});
    }
    return { banner: await leerBanner(req.params.id), ...(await vistas([req.params.id])) };
  });
}
