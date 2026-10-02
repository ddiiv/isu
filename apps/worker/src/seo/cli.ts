import { parseArgs } from "node:util";
import { Redis } from "ioredis";
import { crearPool } from "@isu/db";
import { crearInvalidador } from "../stocker/invalidar.js";
import { guardar, pedirWeb, proponer } from "./tienda-anterior.js";

/*
 * pnpm seo:tienda-anterior https://www.isuwaya.com            muestra qué agregaría (no escribe nada)
 * pnpm seo:tienda-anterior https://www.isuwaya.com --aplicar  lo agrega
 *
 * Correlo ANTES de apuntar el dominio a la tienda nueva (después, el sitemap
 * viejo ya no existe). Sólo agrega lo que falta: lo que ya está —incluido lo
 * editado en el backoffice— no se toca.
 */
const { values, positionals } = parseArgs({ allowPositionals: true, options: { aplicar: { type: "boolean", default: false } } });
const base = positionals[0]?.replace(/\/+$/, "");
const salir = (m: string): never => { console.error(`\n✗ ${m}\n`); process.exit(2); };
if (!base || !/^https?:\/\//.test(base)) salir("Uso: pnpm seo:tienda-anterior https://www.tu-tienda-anterior.com [--aplicar]");
if (!process.env.DATABASE_URL) salir("Falta DATABASE_URL (la misma base que usan la api y el worker). En Railway: corrélo en la consola del worker.");

const pool = crearPool({ url: process.env.DATABASE_URL!, ssl: process.env.DB_SSL === "true", max: 2, nombreApp: "isu-tienda-redirecciones" });
try {
  console.warn(`Leyendo ${base}/sitemap.xml …`);
  const p = await proponer(pool, base!, pedirWeb, { pausaMs: 400, log: (s) => console.warn(s) });
  if (!p.length) console.warn("\nNo falta nada: todas las direcciones de la tienda anterior ya tienen su redirección.");
  else if (!values.aplicar) console.warn(`\n${p.length} redirecciones nuevas. No se escribió nada. Para agregarlas: --aplicar`);
  else {
    console.warn(`\n${await guardar(pool, p)} redirecciones agregadas.`);
    // Avisarle a la tienda para que las use ya (si no, en menos de 5 minutos).
    if (process.env.REDIS_URL) {
      const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true, family: 0 });
      redis.on("error", () => {});
      try { await crearInvalidador({ redis, webUrl: process.env.WEB_INTERNAL_URL, token: process.env.REVALIDAR_TOKEN, log: { warn: () => {} } })([]); } finally { redis.disconnect(); }
    }
  }
} catch (e) {
  salir((e as Error).message);
} finally {
  await pool.end();
}
