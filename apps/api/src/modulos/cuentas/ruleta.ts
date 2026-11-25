import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { RuletaEstado, RuletaResultado } from "@isu/shared";
import { ipDe } from "../../lib/cliente.js";
import { noAutorizado } from "../../lib/errores.js";
import { frenar } from "../../lib/frenos.js";
import { estadoRuleta, girar } from "../../lib/ruleta.js";
import { sesionDe, type DepsCuentas } from "./rutas.js";

/*
 * La ruleta, vista por quien la usa. Siempre se sabe QUIÉN consulta:
 *   · con cuenta: la sesión (/v1/cuenta/ruleta…); ninguna ruta recibe un id de cliente, y sin sesión da 401;
 *   · sin cuenta (invitado): el identificador al azar que guarda su navegador (/v1/ruleta…). Sólo ve y usa lo suyo: el estado y
 *     los cupones de ESE identificador. El sorteo y los límites (uno por dispositivo y por semana, y un tope por conexión) son del servidor.
 */
const DISPOSITIVO = z.string().regex(/^[A-Za-z0-9_-]{32,64}$/);

export async function rutasRuleta(app: FastifyInstance, deps: Pick<DepsCuentas, "pool" | "redis" | "env">) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const noCache = { "cache-control": "no-store" };
  const ip = (req: FastifyRequest) => ipDe(req, deps.env.INTERNO_TOKEN);
  const invitado = (req: FastifyRequest, dispositivo: string) => ({ dispositivo, ip: ip(req), sal: deps.env.INTERNO_TOKEN ?? "isu-ruleta" });

  // ── Con cuenta ──
  api.get("/v1/cuenta/ruleta", { schema: { response: { 200: RuletaEstado } } }, async (req, reply) => {
    const s = await sesionDe(req, deps);
    if (!s) throw noAutorizado();
    reply.headers(noCache);
    return estadoRuleta(deps.pool, { clienteId: s.clienteId });
  });

  api.post("/v1/cuenta/ruleta/girar", { schema: { response: { 200: RuletaResultado } } }, async (req, reply) => {
    const s = await sesionDe(req, deps);
    if (!s) throw noAutorizado();
    // Aunque la regla de la semana ya frena, un freno corto evita que alguien la golpee en bucle.
    await frenar(deps.redis, "ruleta", String(s.clienteId), 10, 600);
    reply.headers(noCache);
    return girar(deps.pool, { clienteId: s.clienteId });
  });

  // ── Sin cuenta ──
  api.get("/v1/ruleta", { schema: { querystring: z.object({ d: DISPOSITIVO }).strict(), response: { 200: RuletaEstado } } }, async (req, reply) => {
    await frenar(deps.redis, "ruleta-estado", ip(req), 120, 600);
    reply.headers(noCache);
    return estadoRuleta(deps.pool, invitado(req, req.query.d));
  });

  api.post("/v1/ruleta/girar", { schema: { body: z.object({ dispositivo: DISPOSITIVO }).strict(), response: { 200: RuletaResultado } } }, async (req, reply) => {
    await frenar(deps.redis, "ruleta-invitado", ip(req), 20, 600);
    reply.headers(noCache);
    return girar(deps.pool, invitado(req, req.body.dispositivo));
  });
}
