import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { RuletaEstado, RuletaResultado } from "@isu/shared";
import { noAutorizado } from "../../lib/errores.js";
import { frenar } from "../../lib/frenos.js";
import { estadoRuleta, girar } from "../../lib/ruleta.js";
import { sesionDe, type DepsCuentas } from "./rutas.js";

/*
 * La ruleta, vista por la cuenta. SIEMPRE se identifica quién consulta (la sesión de la cuenta) y sólo se trabaja con
 * SU cuenta: ninguna ruta recibe un id de cliente. Sin sesión (o con la de otro sistema, como el backoffice): 401.
 */
export async function rutasRuleta(app: FastifyInstance, deps: Pick<DepsCuentas, "pool" | "redis" | "env">) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const noCache = { "cache-control": "no-store" };

  api.get("/v1/cuenta/ruleta", { schema: { response: { 200: RuletaEstado } } }, async (req, reply) => {
    const s = await sesionDe(req, deps);
    if (!s) throw noAutorizado();
    reply.headers(noCache);
    return estadoRuleta(deps.pool, s.clienteId);
  });

  api.post("/v1/cuenta/ruleta/girar", { schema: { response: { 200: RuletaResultado } } }, async (req, reply) => {
    const s = await sesionDe(req, deps);
    if (!s) throw noAutorizado();
    // Aunque la regla de la semana ya frena, un freno corto evita que alguien la golpee en bucle.
    await frenar(deps.redis, "ruleta", String(s.clienteId), 10, 600);
    reply.headers(noCache);
    return girar(deps.pool, s.clienteId);
  });
}
