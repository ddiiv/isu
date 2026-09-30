import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type pg from "pg";
import type { Redis } from "ioredis";
import { z } from "zod";
import { Faq, MensajeChat } from "@isu/shared";
import type { Entorno } from "../../entorno.js";
import type { CacheCorta } from "../../lib/cache.js";
import { ErrorHttp } from "../../lib/errores.js";
import { ipDe } from "../../lib/cliente.js";
import type { Asistente } from "../chat/motor.js";
import { mejores, raices } from "../chat/texto.js";
import { auditar, exigir } from "./sesion.js";

/*
 * Backoffice del asistente: preguntas frecuentes, lo que no supo responder,
 * qué se consulta y un "probá una pregunta" que muestra por qué eligió cada
 * respuesta. Cada cambio limpia la caché del asistente en todas las réplicas.
 */
const Id = z.coerce.number().int().positive().max(2_147_483_647);

export async function rutasChatAdmin(app: FastifyInstance, deps: {
  pool: pg.Pool; redis: Redis; env: Entorno; cache: CacheCorta; canalInvalidar: string; asistente: Asistente; iaDisponible: boolean;
}) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const { pool } = deps;
  const ip = (req: FastifyRequest) => ipDe(req, deps.env.INTERNO_TOKEN);
  const refrescar = async () => {
    deps.cache.limpiar();
    await deps.redis.publish(deps.canalInvalidar, JSON.stringify({ etiquetas: ["chat"] })).catch(() => 0);
  };
  const aFila = (f: z.infer<typeof Faq>) => [f.pregunta, f.respuesta, f.palabras, f.tema, f.enlaceTexto, f.enlaceUrl, f.orden, f.activo];
  const COLUMNAS = `id, pregunta, respuesta, palabras, tema, enlace_texto AS "enlaceTexto", enlace_url AS "enlaceUrl", orden, activo, veces, util, no_util AS "noUtil",
                    actualizado_por AS "actualizadoPor", actualizado_en AS "actualizadoEn"`;

  api.get("/v1/admin/chat/faq", async (req) => {
    await exigir(pool, req);
    return { faqs: (await pool.query(`SELECT ${COLUMNAS} FROM tienda.faq ORDER BY orden, id`)).rows };
  });

  api.post("/v1/admin/chat/faq", { schema: { body: Faq } }, async (req, reply) => {
    const a = await exigir(pool, req, "operador");
    const { rows } = await pool.query(
      `INSERT INTO tienda.faq (pregunta, respuesta, palabras, tema, enlace_texto, enlace_url, orden, activo, actualizado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${COLUMNAS}`, [...aFila(req.body), a.email]);
    await auditar(pool, a, "crear_faq", "faq", rows[0].id, req.body, ip(req));
    await refrescar();
    return reply.code(201).send({ faq: rows[0] });
  });

  api.put("/v1/admin/chat/faq/:id", { schema: { params: z.object({ id: Id }), body: Faq } }, async (req) => {
    const a = await exigir(pool, req, "operador");
    const { rows } = await pool.query(
      `UPDATE tienda.faq SET pregunta=$2, respuesta=$3, palabras=$4, tema=$5, enlace_texto=$6, enlace_url=$7, orden=$8, activo=$9, actualizado_por=$10, actualizado_en=now()
        WHERE id = $1 RETURNING ${COLUMNAS}`, [req.params.id, ...aFila(req.body), a.email]);
    if (!rows[0]) throw new ErrorHttp(404, "no_encontrado", "No existe esa pregunta.");
    await auditar(pool, a, "editar_faq", "faq", req.params.id, req.body, ip(req));
    await refrescar();
    return { faq: rows[0] };
  });

  api.delete("/v1/admin/chat/faq/:id", { schema: { params: z.object({ id: Id }) } }, async (req) => {
    const a = await exigir(pool, req, "operador");
    const r = await pool.query("DELETE FROM tienda.faq WHERE id = $1 RETURNING pregunta", [req.params.id]);
    if (!r.rowCount) throw new ErrorHttp(404, "no_encontrado", "No existe esa pregunta.");
    await auditar(pool, a, "borrar_faq", "faq", req.params.id, { pregunta: r.rows[0].pregunta }, ip(req));
    await refrescar();
    return { ok: true };
  });

  // Probar: la respuesta que daría y los puntajes de las preguntas más cercanas (no cuenta en estadísticas de votos).
  api.post("/v1/admin/chat/probar", { schema: { body: MensajeChat.pick({ mensaje: true }) } }, async (req) => {
    await exigir(pool, req);
    const b = await deps.asistente.base();
    const cons = raices(req.body.mensaje);
    const respuesta = await deps.asistente.responder({ mensaje: req.body.mensaje }, `admin:${ip(req)}`, { prueba: true })
      .catch((e: Error) => ({ error: e.message }));
    return {
      palabras: cons,
      cercanas: mejores(cons, b.faqs, 5).map((x) => ({ id: x.f.id, pregunta: x.f.pregunta, puntaje: Math.round(x.puntaje * 100) / 100 })),
      respuesta,
    };
  });

  api.get("/v1/admin/chat/sin-respuesta", { schema: { querystring: z.object({ todas: z.enum(["1"]).optional() }).strict() } }, async (req) => {
    await exigir(pool, req);
    const { rows } = await pool.query(
      `SELECT id, ejemplo, veces, resuelta, primero, ultimo FROM tienda.chat_sin_respuesta
        ${req.query.todas ? "" : "WHERE NOT resuelta"} ORDER BY resuelta, veces DESC, ultimo DESC LIMIT 200`);
    return { preguntas: rows };
  });

  api.post("/v1/admin/chat/sin-respuesta/:id/resuelta", { schema: { params: z.object({ id: Id }) } }, async (req) => {
    const a = await exigir(pool, req, "operador");
    const r = await pool.query("UPDATE tienda.chat_sin_respuesta SET resuelta = true WHERE id = $1", [req.params.id]);
    if (!r.rowCount) throw new ErrorHttp(404, "no_encontrado", "No existe.");
    await auditar(pool, a, "resolver_consulta_chat", "chat", req.params.id, null, ip(req));
    return { ok: true };
  });

  api.get("/v1/admin/chat/resumen", { schema: { querystring: z.object({ dias: z.coerce.number().int().min(1).max(365).default(30) }).strict() } }, async (req) => {
    await exigir(pool, req);
    await deps.asistente.guardarContadores();
    const [temas, total, sin] = await Promise.all([
      pool.query("SELECT tema, sum(veces)::int AS veces FROM tienda.chat_temas WHERE dia > current_date - $1::int GROUP BY tema ORDER BY veces DESC", [req.query.dias]),
      pool.query("SELECT COALESCE(sum(veces), 0)::int AS n FROM tienda.chat_temas WHERE dia > current_date - $1::int", [req.query.dias]),
      pool.query("SELECT count(*)::int AS n FROM tienda.chat_sin_respuesta WHERE NOT resuelta"),
    ]);
    return { dias: req.query.dias, consultas: total.rows[0].n, temas: temas.rows, sinResponder: sin.rows[0].n, iaDisponible: deps.iaDisponible };
  });
}
