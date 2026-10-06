import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type pg from "pg";
import type { Redis } from "ioredis";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { FotoInvalida, procesarBanner, type Almacen } from "@isu/almacen";
import type { Entorno } from "../../entorno.js";
import type { CacheCorta } from "../../lib/cache.js";
import type { Colas } from "../../lib/colas.js";
import { ErrorHttp } from "../../lib/errores.js";
import { ipDe } from "../../lib/cliente.js";
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
  pool: pg.Pool; redis: Redis; env: Entorno; cache: CacheCorta; colas: Colas; canalInvalidar: string; banners: Almacen | null;
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
  const COLS = `id, alt, enlace, foto, foto_ancho AS "fotoAncho", foto_alto AS "fotoAlto", foto_movil AS "fotoMovil", movil_ancho AS "movilAncho",
    movil_alto AS "movilAlto", orden, activo, desde, hasta, creado_en AS "creadoEn"`;
  const Banner = z.object({
    alt: z.string().trim().min(2, "Describí qué se ve en la foto").max(160),
    enlace: Ruta.nullable().default(null).transform((v) => v || null),
    orden: z.number().int().min(-1000).max(1000).default(0),
    activo: z.boolean().default(true),
    desde: z.iso.datetime({ offset: true }).nullable().default(null),
    hasta: z.iso.datetime({ offset: true }).nullable().default(null),
  }).strict().refine((b) => !b.desde || !b.hasta || new Date(b.hasta) > new Date(b.desde), { message: "La fecha de fin tiene que ser posterior al inicio", path: ["hasta"] });
  // Para editar: todo opcional y SIN valores por defecto (un cambio de orden no tiene que apagar el banner).
  const CambiosBanner = z.object({
    alt: z.string().trim().min(2).max(160).optional(),
    enlace: Ruta.nullable().optional(),
    orden: z.number().int().min(-1000).max(1000).optional(),
    activo: z.boolean().optional(),
    desde: z.iso.datetime({ offset: true }).nullable().optional(),
    hasta: z.iso.datetime({ offset: true }).nullable().optional(),
  }).strict();

  api.get("/v1/admin/banners", async (req) => {
    await exigir(pool, req);
    const { rows } = await pool.query(`SELECT ${COLS} FROM tienda.banners ORDER BY orden, id`);
    return { banners: rows };
  });

  api.post("/v1/admin/banners", { schema: { body: Banner } }, async (req) => {
    const a = await exigir(pool, req, "operador");
    const b = req.body;
    const n = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM tienda.banners");
    if (n.rows[0]!.n >= 20) throw new ErrorHttp(409, "tope", "Hay 20 banners: borrá alguno viejo antes de crear otro.");
    const { rows } = await pool.query(
      `INSERT INTO tienda.banners (alt, enlace, orden, activo, desde, hasta) VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLS}`,
      [b.alt, b.enlace, b.orden, b.activo, b.desde, b.hasta],
    );
    await auditar(pool, a, "crear_banner", "banner", rows[0].id, b, ip(req));
    return { banner: rows[0] };
  });

  api.patch("/v1/admin/banners/:id", { schema: { params: z.object({ id: Id }), body: CambiosBanner } }, async (req) => {
    const a = await exigir(pool, req, "operador");
    const mapa: Record<string, string> = { alt: "alt", enlace: "enlace", orden: "orden", activo: "activo", desde: "desde", hasta: "hasta" };
    const sets: string[] = [];
    const params: unknown[] = [req.params.id];
    for (const [k, v] of Object.entries(req.body)) {
      if (v === undefined) continue;
      params.push(k === "enlace" ? v || null : v);
      sets.push(`${mapa[k]} = $${params.length}`);
    }
    if (!sets.length) throw new ErrorHttp(400, "nada", "Nada para cambiar.");
    try {
      const { rows } = await pool.query(`UPDATE tienda.banners SET ${sets.join(", ")}, actualizado_en = now() WHERE id = $1 RETURNING ${COLS}`, params);
      if (!rows[0]) throw new ErrorHttp(404, "no_encontrado", "No existe ese banner.");
      await auditar(pool, a, "editar_banner", "banner", req.params.id, req.body, ip(req));
      await invalidar([]);
      return { banner: rows[0] };
    } catch (e) {
      if ((e as { code?: string }).code === "23514") throw new ErrorHttp(400, "fechas", "Revisá las fechas: el fin tiene que ser posterior al inicio.");
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
      const clave = `b/${req.params.id}/${randomBytes(8).toString("hex")}`;
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
}
