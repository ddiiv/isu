import { Redis } from "ioredis";
import { crearPool, migrar } from "@isu/db";
import { leerEntorno } from "./entorno.js";
import { construirApp } from "./app.js";

/*
 * Arranque en Railway.
 *
 * Las migraciones corren acá, con candado: si hay varias réplicas, una migra
 * y las demás esperan. Sólo tocan el esquema `tienda` de la base de Stocker.
 */
const env = leerEntorno();
const pool = crearPool({ url: env.DATABASE_URL, ssl: env.DB_SSL, max: env.DB_POOL_MAX });
const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 2,
  enableOfflineQueue: false,
  lazyConnect: false,
  // Railway: la red privada resuelve por IPv6.
  family: 0,
});
redis.on("error", (e) => console.error("[redis]", e.message));

const r = await migrar(pool);
const app = await construirApp({ env, pool, redis });
if (r.aplicadas.length) app.log.info({ aplicadas: r.aplicadas }, "migraciones aplicadas");

await app.listen({ port: env.PORT, host: env.HOST });

/*
 * Apagado ordenado: Railway manda SIGTERM en cada deploy. Se deja de aceptar
 * pedidos, se terminan los que están en vuelo y se cierran base y Redis.
 */
let cerrando = false;
async function apagar(senal: string) {
  if (cerrando) return;
  cerrando = true;
  app.log.info(`${senal}: cerrando`);
  const plazo = setTimeout(() => process.exit(0), 10_000);
  plazo.unref();
  await app.close();
  await Promise.allSettled([pool.end(), redis.quit()]);
  process.exit(0);
}
process.on("SIGTERM", () => void apagar("SIGTERM"));
process.on("SIGINT", () => void apagar("SIGINT"));
