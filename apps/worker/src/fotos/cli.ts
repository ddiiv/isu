import { parseArgs } from "node:util";
import { crearPool } from "@isu/db";
import { almacenDesdeEntorno } from "./almacen.js";
import { importarCarpeta } from "./importar.js";
import { Redis } from "ioredis";
import { crearInvalidador } from "../stocker/invalidar.js";

/*
 * pnpm fotos:importar <carpeta> [--reemplazar]
 *
 * Ver importar.ts para la forma de la carpeta. Con --reemplazar, las fotos
 * que ya tenía cada producto de la carpeta se borran antes de subir las nuevas.
 */
const { values, positionals } = parseArgs({ allowPositionals: true, options: { reemplazar: { type: "boolean", default: false } } });
const carpeta = positionals[0];
if (!carpeta || !process.env.DATABASE_URL) {
  console.error("Uso: pnpm fotos:importar <carpeta> [--reemplazar]   (necesita DATABASE_URL y FOTOS_DIR o R2_*)");
  process.exit(2);
}
const pool = crearPool({ url: process.env.DATABASE_URL, ssl: process.env.DB_SSL === "true", max: 2, nombreApp: "isu-tienda-fotos" });
try {
  const r = await importarCarpeta(pool, almacenDesdeEntorno(), carpeta, { reemplazar: values.reemplazar, log: (s) => console.warn(s) });
  console.warn(`\n${r.subidas} fotos subidas · ${r.omitidas.length} omitidas`);
  // Que la tienda muestre las fotos nuevas ya (y no las páginas guardadas con las anteriores).
  if (process.env.REDIS_URL && r.productos.length) {
    const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true, family: 0 });
    redis.on("error", () => {});
    try {
      await crearInvalidador({ redis, webUrl: process.env.WEB_INTERNAL_URL, token: process.env.REVALIDAR_TOKEN, log: { warn: () => {} } })(r.productos);
      console.warn(`páginas regeneradas: ${r.productos.length}`);
    } finally { redis.disconnect(); }
  }
  process.exitCode = r.omitidas.length ? 1 : 0;
} finally {
  await pool.end();
}
