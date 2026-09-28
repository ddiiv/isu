import { crearPool } from "./conexion.js";
import { migrar } from "./migrar.js";

/* `pnpm db:migrar` — lo corre también el arranque de la API en Railway (pre-deploy). */
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Falta DATABASE_URL (la misma base de Stocker).");
  process.exit(1);
}
const pool = crearPool({ url, ssl: process.env.DB_SSL === "true", max: 1, nombreApp: "isu-migraciones" });
try {
  const r = await migrar(pool);
  console.warn(`migraciones: ${r.aplicadas.length} aplicadas, ${r.yaEstaban.length} ya estaban`);
  for (const a of r.aplicadas) console.warn(`  + ${a}`);
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
