import { parseArgs } from "node:util";
import { Redis } from "ioredis";
import { crearPool } from "@isu/db";
import { almacenDeBanners } from "@isu/almacen";
import { almacenDesdeEntorno } from "./almacen.js";
import { pasarFotosSinIds } from "./sin-ids.js";
import { crearInvalidador } from "../stocker/invalidar.js";

/*
 * pnpm fotos:sin-ids [--borrar-viejas]
 *
 * Una sola vez, después de subir esta versión: las fotos y banners que ya
 * estaban pasan a direcciones sin el id del producto (ver sin-ids.ts). Sin
 * --borrar-viejas, los archivos viejos quedan en el bucket (no se rompe nada
 * que Google ya tenga guardado); se pueden borrar más adelante con la opción.
 */
const { values } = parseArgs({ options: { "borrar-viejas": { type: "boolean", default: false } } });
if (!process.env.DATABASE_URL) {
  console.error("Uso: pnpm fotos:sin-ids [--borrar-viejas]   (necesita DATABASE_URL y FOTOS_DIR o R2_*)");
  process.exit(2);
}
const pool = crearPool({ url: process.env.DATABASE_URL, ssl: process.env.DB_SSL === "true", max: 2, nombreApp: "isu-tienda-fotos" });
try {
  const r = await pasarFotosSinIds(pool, { fotos: almacenDesdeEntorno(), banners: almacenDeBanners() }, { borrarViejas: values["borrar-viejas"], log: (s) => console.warn(s) });
  console.warn(`\n${r.fotos} fotos y ${r.banners} banners con dirección nueva · ${r.faltantes.length} sin archivos (quedan como estaban)`);
  // Que la tienda muestre las direcciones nuevas ya.
  if (process.env.REDIS_URL && (r.productos.length || r.banners)) {
    const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true, family: 0 });
    redis.on("error", () => {});
    try {
      await crearInvalidador({ redis, webUrl: process.env.WEB_INTERNAL_URL, token: process.env.REVALIDAR_TOKEN, log: { warn: () => {} } })(r.productos);
      console.warn(`páginas regeneradas: ${r.productos.length}`);
    } finally { redis.disconnect(); }
  }
} finally {
  await pool.end();
}
