import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type pg from "pg";
import type { Redis } from "ioredis";
import { z } from "zod";
import { Email, ItemSuelto, MAX_LINEAS_CARRITO, MAX_UNIDADES_POR_ARTICULO } from "@isu/shared";
import type { Entorno } from "../../entorno.js";
import { frenar } from "../../lib/frenos.js";
import { ipDe } from "../../lib/cliente.js";
import { tokenNuevo } from "../../lib/cripto.js";
import { leerTiendaCerrada } from "../../lib/tienda.js";

/*
 * Recordatorio de carritos abandonados (sólo por mail, sólo con consentimiento):
 *
 *   POST /v1/carrito-recordatorio         {email, items, acepto: true}  anota (o actualiza) el carrito de ese mail
 *   POST /v1/carrito-recordatorio/baja    {token}                       «No quiero más recordatorios» del mail
 *
 * Las dos contestan 204 exista o no el mail o el token: no se puede usar esto para
 * averiguar quién tiene un carrito anotado. Quien se dio de baja no se vuelve a anotar
 * aunque reenvíen su carrito (el registro de baja se conserva 90 días: lo purga el worker).
 * El worker manda el mail a las 2 horas (apps/worker/src/correo/carritos.ts): uno solo por mail cada 90 días.
 */
const Anotar = z.object({
  email: Email,
  items: z.array(ItemSuelto).min(1).max(MAX_LINEAS_CARRITO),
  // El consentimiento, literal: sin el tilde no se guarda nada.
  acepto: z.literal(true, { error: "Tenés que marcar el tilde para recibir el recordatorio" }),
}).strict();
const Baja = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43,64}$/) }).strict();

export async function rutasCarritos(app: FastifyInstance, deps: { pool: pg.Pool; redis: Redis; env: Entorno }) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const { pool } = deps;
  const sinCache = { "cache-control": "no-store" };

  api.post("/v1/carrito-recordatorio", { schema: { body: Anotar } }, async (req, reply) => {
    reply.headers(sinCache);
    // Por IP (una oficina comparte IP: con margen) y por mail (que nadie le llene la casilla a otra persona).
    await frenar(deps.redis, "carrito-rec-ip", ipDe(req, deps.env.INTERNO_TOKEN), 30, 3600);
    await frenar(deps.redis, "carrito-rec-email", req.body.email, 20, 3600);
    // Con la tienda apagada no se anota nada (y la persona no se entera de la diferencia).
    if ((await leerTiendaCerrada(pool)).activa) return reply.code(204).send();

    // Sólo SKU que existen, uno por línea, ordenados: así «mismo carrito» se compara con un igual.
    const pedidos = new Map<string, number>();
    for (const i of req.body.items) pedidos.set(i.sku, Math.min(MAX_UNIDADES_POR_ARTICULO, (pedidos.get(i.sku) ?? 0) + i.cantidad));
    const { rows } = await pool.query<{ sku: string }>("SELECT sku FROM tienda.variantes WHERE sku = ANY($1::text[]) AND activo", [[...pedidos.keys()]]);
    const items = rows.map((r) => ({ sku: r.sku, cantidad: pedidos.get(r.sku)! })).sort((a, b) => (a.sku < b.sku ? -1 : 1));
    if (!items.length) return reply.code(204).send();

    /*
     * Un mail, un registro. Quien tiene baja no se toca. Quien ya recibió el recordatorio no vuelve a
     * recibir otro (ni se le guardan items) hasta que pasen 90 días desde ese mail: así nadie puede usar
     * esto para llenarle la casilla a otra persona.
     */
    await pool.query(
      `INSERT INTO tienda.carritos_abandonados AS c (email, items, baja_token) VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (email) DO UPDATE
          SET items = EXCLUDED.items, actualizado_en = now(), convertido_en = NULL, recordado_en = NULL
        WHERE c.baja_en IS NULL AND (c.recordado_en IS NULL OR c.recordado_en < now() - interval '90 days')`,
      [req.body.email, JSON.stringify(items), tokenNuevo(32)],
    );
    return reply.code(204).send();
  });

  api.post("/v1/carrito-recordatorio/baja", { schema: { body: Baja } }, async (req, reply) => {
    reply.headers(sinCache);
    await frenar(deps.redis, "carrito-baja-ip", ipDe(req, deps.env.INTERNO_TOKEN), 30, 3600);
    // Búsqueda por el índice único del token (256 bits al azar: no se adivina ni por tiempos de respuesta).
    // La baja se anota aunque ya estuviera (no mueve la fecha) y los items se borran.
    await pool.query(
      "UPDATE tienda.carritos_abandonados SET baja_en = COALESCE(baja_en, now()), items = '[]'::jsonb WHERE baja_token = $1",
      [req.body.token],
    );
    return reply.code(204).send();
  });
}
