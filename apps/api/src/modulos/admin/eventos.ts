import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type pg from "pg";
import type { Redis } from "ioredis";
import { z } from "zod";
import type { Entorno } from "../../entorno.js";
import type { CacheCorta } from "../../lib/cache.js";
import type { Colas } from "../../lib/colas.js";
import { ErrorHttp } from "../../lib/errores.js";
import { ipDe } from "../../lib/cliente.js";
import { auditar, exigir } from "./sesion.js";

/*
 * Backoffice de eventos de temporada (0032): Navidad hoy; Cupido, Halloween… después, con sólo agregar la fila.
 *
 *   · Un evento agrupa descuentos, cupones/promociones y banners. Esas filas valen sólo mientras el evento esté vigente
 *     (activo y dentro de sus fechas): se prende todo junto y, al apagarlo, vuelve todo a la normalidad.
 *   · Un solo evento activo a la vez: al prender uno, se apaga el que estaba.
 *   · Nada de esto toca datos de clientes. Igual, todas las rutas piden sesión del backoffice con doble factor.
 */
const Id = z.coerce.number().int().positive().max(2_147_483_647);
const Clave = z.string().regex(/^[a-z][a-z0-9-]{1,29}$/);
const Fecha = z.iso.datetime({ offset: true }).nullable();

const Cambios = z.object({ activo: z.boolean(), desde: Fecha.default(null), hasta: Fecha.default(null) }).strict()
  .refine((d) => !d.desde || !d.hasta || new Date(d.hasta) > new Date(d.desde), { message: "La fecha de fin tiene que ser posterior al inicio", path: ["hasta"] });
// Cada lista es la completa de ese tipo; la que no se manda queda como está (no se «suelta» sin querer).
const Vinculos = z.object({
  descuentos: z.array(Id).max(500).optional(),
  cupones: z.array(Id).max(500).optional(),
  banners: z.array(Id).max(100).optional(),
}).strict();

// Lo que se puede atar a un evento. Los relámpagos no: ya duran 48 h como máximo y tienen su propia pantalla.
const TABLAS = {
  descuentos: { tabla: "tienda.descuentos", filtro: "AND NOT relampago" },
  cupones: { tabla: "tienda.cupones", filtro: "" },
  banners: { tabla: "tienda.banners", filtro: "" },
} as const;

/** El trigger de la base (0033) rechaza un descuento que pasa del tope del evento: se lo decimos al usuario. */
export function topeDelEvento(err: unknown) {
  const e = err as { code?: string; constraint?: string; message?: string };
  return e.code === "23514" && e.constraint === "descuentos_tope_evento" ? new ErrorHttp(400, "tope_evento", e.message ?? "El descuento pasa del tope del evento.") : err;
}

export interface DepsEventosAdmin { pool: pg.Pool; env: Entorno; redis: Redis; colas: Colas; cache: CacheCorta; canalInvalidar: string }

export async function rutasEventosAdmin(app: FastifyInstance, deps: DepsEventosAdmin) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const { pool } = deps;
  const ip = (req: FastifyRequest) => ipDe(req, deps.env.INTERNO_TOKEN);

  /** Cambió lo que ve la tienda: caché de esta réplica, de las demás, y las páginas. */
  async function invalidar() {
    deps.cache.limpiar();
    await deps.redis.publish(deps.canalInvalidar, JSON.stringify({ etiquetas: ["catalogo"] })).catch(() => 0);
    await deps.colas.stocker("invalidar", { slugs: [] });
  }

  api.get("/v1/admin/eventos", async (req) => {
    await exigir(pool, req);
    const [ev, descuentos, cupones, banners] = await Promise.all([
      pool.query(
        `SELECT e.id, e.clave, e.nombre, e.activo, e.desde, e.hasta, e.descuento_max AS "descuentoMax", e.actualizado_por AS "actualizadoPor", e.actualizado_en AS "actualizadoEn",
                tienda.evento_vigente(e.id) AS vigente,
                (SELECT count(*)::int FROM tienda.descuentos WHERE evento_id = e.id) AS descuentos,
                (SELECT count(*)::int FROM tienda.cupones WHERE evento_id = e.id) AS cupones,
                (SELECT count(*)::int FROM tienda.banners WHERE evento_id = e.id) AS banners
           FROM tienda.eventos e ORDER BY e.id`),
      pool.query(`SELECT d.id, d.nombre, d.porcentaje, d.activo, e.clave AS evento FROM tienda.descuentos d LEFT JOIN tienda.eventos e ON e.id = d.evento_id WHERE NOT d.relampago ORDER BY d.id DESC`),
      pool.query(`SELECT c.id, c.nombre, c.codigo, c.automatico, c.activo, e.clave AS evento FROM tienda.cupones c LEFT JOIN tienda.eventos e ON e.id = c.evento_id ORDER BY c.id DESC`),
      pool.query(`SELECT b.id, COALESCE(b.titulo, b.alt) AS nombre, b.activo, e.clave AS evento FROM tienda.banners b LEFT JOIN tienda.eventos e ON e.id = b.evento_id ORDER BY b.orden, b.id`),
    ]);
    return { eventos: ev.rows, disponibles: { descuentos: descuentos.rows, cupones: cupones.rows, banners: banners.rows } };
  });

  // Prender, apagar o fechar un evento. Prender uno apaga el que estaba activo (hay uno solo a la vez).
  api.put("/v1/admin/eventos/:clave", { schema: { params: z.object({ clave: Clave }), body: Cambios } }, async (req) => {
    const a = await exigir(pool, req, "operador");
    const cli = await pool.connect();
    try {
      await cli.query("BEGIN");
      const e = (await cli.query<{ id: number }>("SELECT id FROM tienda.eventos WHERE clave = $1 FOR UPDATE", [req.params.clave])).rows[0];
      if (!e) throw new ErrorHttp(404, "no_encontrado", "No existe ese evento.");
      if (req.body.activo) await cli.query("UPDATE tienda.eventos SET activo = false, actualizado_por = $2, actualizado_en = now() WHERE activo AND id <> $1", [e.id, a.email]);
      await cli.query(
        "UPDATE tienda.eventos SET activo = $2, desde = $3, hasta = $4, actualizado_por = $5, actualizado_en = now() WHERE id = $1",
        [e.id, req.body.activo, req.body.desde, req.body.hasta, a.email]);
      await auditar(cli, a, req.body.activo ? "prender_evento" : "apagar_evento", "evento", req.params.clave, req.body, ip(req));
      await cli.query("COMMIT");
    } catch (err) {
      await cli.query("ROLLBACK").catch(() => {});
      throw err;
    } finally { cli.release(); }
    await invalidar();
    return { ok: true };
  });

  // Qué descuentos, cupones y banners son de este evento: la lista completa (lo que no está, se suelta).
  api.put("/v1/admin/eventos/:clave/vinculos", { schema: { params: z.object({ clave: Clave }), body: Vinculos } }, async (req) => {
    const a = await exigir(pool, req, "operador");
    const cli = await pool.connect();
    try {
      await cli.query("BEGIN");
      const e = (await cli.query<{ id: number }>("SELECT id FROM tienda.eventos WHERE clave = $1 FOR UPDATE", [req.params.clave])).rows[0];
      if (!e) throw new ErrorHttp(404, "no_encontrado", "No existe ese evento.");
      for (const k of ["descuentos", "cupones", "banners"] as const) {
        const { tabla, filtro } = TABLAS[k];
        if (req.body[k] === undefined) continue;
        const ids = [...new Set(req.body[k])];
        await cli.query(`UPDATE ${tabla} SET evento_id = NULL WHERE evento_id = $1 AND NOT (id = ANY($2::int[]))`, [e.id, ids]);
        const r = await cli.query(`UPDATE ${tabla} SET evento_id = $1 WHERE id = ANY($2::int[]) ${filtro}`, [e.id, ids]);
        if (r.rowCount !== ids.length) throw new ErrorHttp(400, "vinculos", `Alguno de los ${k} elegidos no existe o no se puede atar a un evento.`);
      }
      await auditar(cli, a, "vincular_evento", "evento", req.params.clave, req.body, ip(req));
      await cli.query("COMMIT");
    } catch (err) {
      await cli.query("ROLLBACK").catch(() => {});
      throw topeDelEvento(err);
    } finally { cli.release(); }
    await invalidar();
    return { ok: true };
  });
}
