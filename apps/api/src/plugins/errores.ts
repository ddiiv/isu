import type { FastifyError, FastifyInstance } from "fastify";
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";
import { ErrorHttp } from "../lib/errores.js";

/*
 * Todas las respuestas de error tienen la misma forma:
 *   { error: "codigo", mensaje: "texto para mostrar", idPedido?: "..." }
 *
 * Un 500 NUNCA devuelve el mensaje real, el SQL ni el stack: van al log con
 * el idPedido, y el cliente recibe ese id para que soporte lo encuentre.
 */
export function errores(app: FastifyInstance) {
  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).send({
        error: "validacion",
        mensaje: "Hay datos inválidos en el pedido.",
        detalles: err.validation.map((v) => ({ campo: v.instancePath.replace(/^\//, "").replaceAll("/", "."), motivo: v.message })),
      });
    }
    if (err instanceof ErrorHttp) {
      return reply.code(err.status).send({ error: err.codigo, mensaje: err.message });
    }
    const status = err.statusCode ?? 500;
    if (status === 429 || status === 503) return reply.code(status).send(err);
    if (status < 500) {
      const codigos: Record<number, [string, string]> = {
        400: ["pedido_invalido", "El pedido no se pudo interpretar."],
        404: ["no_encontrado", "No existe."],
        405: ["metodo_no_permitido", "Método no permitido."],
        413: ["demasiado_grande", "El pedido es demasiado grande."],
        415: ["tipo_no_soportado", "Tipo de contenido no soportado."],
      };
      const [error, mensaje] = codigos[status] ?? ["pedido_invalido", "El pedido no se pudo procesar."];
      return reply.code(status).send({ error, mensaje });
    }
    req.log.error({ err }, "error interno");
    return reply.code(500).send({
      error: "interno",
      mensaje: "Algo salió mal de nuestro lado. Ya quedó registrado.",
      idPedido: req.id,
    });
  });

  app.setNotFoundHandler((_req, reply) => {
    reply.code(404).send({ error: "no_encontrado", mensaje: "No existe." });
  });
}
