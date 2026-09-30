/*
 * Borra los contadores de los frenos anti-abuso (isu:freno:*) del Redis del
 * .env. Sólo para correr las pruebas en navegador varias veces seguidas en
 * local: todas salen de la misma IP y, si no, el freno las corta (bien).
 */
import { Redis } from "ioredis";
if (process.env.NODE_ENV === "production") { console.error("No en producción."); process.exit(1); }
const r = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: 1 });
let cursor = "0", n = 0;
do {
  const [c, claves] = await r.scan(cursor, "MATCH", "isu:freno:*", "COUNT", 500);
  cursor = c;
  if (claves.length) n += await r.del(...claves);
} while (cursor !== "0");
console.warn(`frenos limpiados: ${n}`);
await r.quit();
