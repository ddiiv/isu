import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type pg from "pg";
import { ConfigRuleta, ListaPremios } from "@isu/shared";
import type { Entorno } from "../../entorno.js";
import { ipDe } from "../../lib/cliente.js";
import { detallePremio } from "../../lib/ruleta.js";
import { auditar, exigir } from "./sesion.js";

/*
 * Backoffice de la ruleta: cuándo aparece, cada cuánto, cuánto dura el cupón, y los premios con su probabilidad.
 * Sólo agregados (cuántos giros, qué salió): no muestra qué cuenta ganó qué.
 */
export async function rutasRuletaAdmin(app: FastifyInstance, deps: { pool: pg.Pool; env: Entorno }) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const { pool } = deps;
  const ip = (req: FastifyRequest) => ipDe(req, deps.env.INTERNO_TOKEN);

  api.get("/v1/admin/ruleta", async (req) => {
    await exigir(pool, req);
    const [c, p, giros, vigente] = await Promise.all([
      pool.query<{ manual: boolean; con_eventos: boolean; cada_dias: number; vence_dias: number }>("SELECT manual, con_eventos, cada_dias, vence_dias FROM tienda.ruleta WHERE id = 1"),
      pool.query<{ id: number; etiqueta: string; tipo: "porcentaje" | "monto" | "envio_gratis" | "segunda_unidad" | "nada"; valor: number; minimo: number; peso: number; activo: boolean; giros: number }>(
        `SELECT p.id, p.etiqueta, p.tipo, p.valor, p.minimo, p.peso, p.activo, (SELECT count(*)::int FROM tienda.ruleta_giros g WHERE g.premio_id = p.id) AS giros
           FROM tienda.ruleta_premios p ORDER BY p.orden, p.id`),
      pool.query<{ total: number; semana: number }>("SELECT count(*)::int AS total, count(*) FILTER (WHERE creado_en > now() - interval '7 days')::int AS semana FROM tienda.ruleta_giros"),
      pool.query<{ nombre: string }>("SELECT nombre FROM tienda.eventos WHERE tienda.evento_vigente(id) LIMIT 1"),
    ]);
    const suma = p.rows.filter((x) => x.activo).reduce((s, x) => s + x.peso, 0);
    const cfg = c.rows[0]!;
    return {
      config: { manual: cfg.manual, conEventos: cfg.con_eventos, cadaDias: cfg.cada_dias, venceDias: cfg.vence_dias },
      // ¿Está abierta ahora? (a mano, o sola por el evento vigente)
      abierta: cfg.manual || (cfg.con_eventos && !!vigente.rows[0]),
      evento: vigente.rows[0]?.nombre ?? null,
      premios: p.rows.map((x) => ({ id: x.id, etiqueta: x.etiqueta, tipo: x.tipo, valor: x.valor, minimo: x.minimo, peso: x.peso, activo: x.activo, giros: x.giros, detalle: detallePremio(x), probabilidad: x.activo && suma > 0 ? Math.round((x.peso / suma) * 1000) / 10 : 0 })),
      giros: giros.rows[0],
    };
  });

  api.put("/v1/admin/ruleta", { schema: { body: ConfigRuleta } }, async (req) => {
    const a = await exigir(pool, req, "operador");
    const b = req.body;
    await pool.query("UPDATE tienda.ruleta SET manual = $1, con_eventos = $2, cada_dias = $3, vence_dias = $4, actualizado_por = $5, actualizado_en = now() WHERE id = 1", [b.manual, b.conEventos, b.cadaDias, b.venceDias, a.email]);
    await auditar(pool, a, "configurar_ruleta", "ruleta", null, b, ip(req));
    return { ok: true };
  });

  // La lista completa de premios (lo que no está, se borra; los giros viejos quedan con su etiqueta).
  api.put("/v1/admin/ruleta/premios", { schema: { body: ListaPremios } }, async (req) => {
    const a = await exigir(pool, req, "operador");
    const cli = await pool.connect();
    try {
      await cli.query("BEGIN");
      const ids: number[] = [];
      for (const [orden, p] of req.body.premios.entries()) {
        // Con id: se actualiza; si ese id ya no existe (o no trae), se crea uno nuevo.
        let r = p.id ? await cli.query<{ id: number }>("UPDATE tienda.ruleta_premios SET etiqueta=$2, tipo=$3, valor=$4, minimo=$5, peso=$6, activo=$7, orden=$8 WHERE id = $1 RETURNING id", [p.id, p.etiqueta, p.tipo, p.valor, p.minimo, p.peso, p.activo, orden]) : null;
        r ??= await cli.query<{ id: number }>("INSERT INTO tienda.ruleta_premios (etiqueta, tipo, valor, minimo, peso, activo, orden) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id", [p.etiqueta, p.tipo, p.valor, p.minimo, p.peso, p.activo, orden]);
        if (!r.rows[0]) r = await cli.query<{ id: number }>("INSERT INTO tienda.ruleta_premios (etiqueta, tipo, valor, minimo, peso, activo, orden) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id", [p.etiqueta, p.tipo, p.valor, p.minimo, p.peso, p.activo, orden]);
        ids.push(r.rows[0]!.id);
      }
      await cli.query("DELETE FROM tienda.ruleta_premios WHERE NOT (id = ANY($1::int[]))", [ids]);
      await auditar(cli, a, "premios_ruleta", "ruleta", null, req.body, ip(req));
      await cli.query("COMMIT");
    } catch (e) {
      await cli.query("ROLLBACK").catch(() => {});
      throw e;
    } finally { cli.release(); }
    return { ok: true };
  });
}
