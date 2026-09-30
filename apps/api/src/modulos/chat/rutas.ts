import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Redis } from "ioredis";
import { z } from "zod";
import { ConsultaPedidoChat, MensajeChat, RespuestaChat, VotoChat } from "@isu/shared";
import type { Entorno } from "../../entorno.js";
import { frenar } from "../../lib/frenos.js";
import { ipDe } from "../../lib/cliente.js";
import type { Asistente } from "./motor.js";

/*
 * Asistente de la tienda:
 *   POST /v1/chat          una consulta → una respuesta
 *   POST /v1/chat/pedido   cómo viene un pedido (número + email)
 *   POST /v1/chat/voto     "¿te sirvió?" de una pregunta frecuente
 * Nada se cachea ni guarda la conversación. Freno propio por IP.
 */
export async function rutasChat(app: FastifyInstance, deps: { redis: Redis; env: Entorno; asistente: Asistente }) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const ip = (req: Parameters<typeof ipDe>[0]) => ipDe(req, deps.env.INTERNO_TOKEN);
  const sinCache = { "cache-control": "no-store" };

  api.post("/v1/chat", { schema: { body: MensajeChat, response: { 200: RespuestaChat } } }, async (req, reply) => {
    await frenar(deps.redis, "chat-ip", ip(req), 60, 600);
    reply.headers(sinCache);
    return deps.asistente.responder(req.body, ip(req));
  });

  api.post("/v1/chat/pedido", { schema: { body: ConsultaPedidoChat, response: { 200: RespuestaChat } } }, async (req, reply) => {
    reply.headers(sinCache);
    return deps.asistente.pedido(req.body.numero, req.body.email, ip(req));
  });

  api.post("/v1/chat/voto", { schema: { body: VotoChat, response: { 204: z.null() } } }, async (req, reply) => {
    await deps.asistente.votar(req.body.faqId, req.body.util, ip(req));
    return reply.code(204).send(null);
  });
}
