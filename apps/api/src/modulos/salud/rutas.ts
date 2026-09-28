import type { FastifyInstance } from "fastify";
import type pg from "pg";
import type { Redis } from "ioredis";

/*
 * /healthz  el proceso está vivo. Es el chequeo de Railway: si la base se
 *           cae un momento, NO hay que reiniciar la API por eso.
 * /readyz   puede atender: base y Redis responden. Para el balanceador y
 *           para mirar a mano.
 */
export async function rutasSalud(app: FastifyInstance, deps: { pool: pg.Pool; redis: Redis }) {
  app.get("/healthz", { config: { rateLimit: false } }, async () => ({ ok: true }));

  app.get("/readyz", { config: { rateLimit: false } }, async (_req, reply) => {
    const conPlazo = <T>(p: Promise<T>) =>
      Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("plazo")), 2000))]);
    const [db, cache] = await Promise.allSettled([
      conPlazo(deps.pool.query("SELECT 1")),
      conPlazo(deps.redis.ping()),
    ]);
    const estado = { db: db.status === "fulfilled", redis: cache.status === "fulfilled" };
    return reply.code(estado.db && estado.redis ? 200 : 503).send({ ok: estado.db && estado.redis, ...estado });
  });
}
