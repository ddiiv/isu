/*
 * Prueba de carga básica: cuánto aguanta cada superficie antes de degradarse,
 * y que la tienda NO se coma las conexiones de la base compartida con Stocker.
 *
 *   API_URL=… WEB_URL=… DATABASE_URL=… node tests/carga/carga.mjs
 *
 * Ojo: en producción, lo público lo sirve Cloudflare desde su caché; esto mide
 * el peor caso (todo llega al origen).
 */
import autocannon from "autocannon";
import pg from "pg";

const API = process.env.API_URL ?? "http://127.0.0.1:4000";
const WEB = process.env.WEB_URL ?? "http://127.0.0.1:3000";
const DB = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:5433/stocker_test";
const SEGUNDOS = Number(process.env.SEGUNDOS ?? 15);

const pool = new pg.Pool({ connectionString: DB, max: 1 });
let maxConexiones = 0;
const vigia = setInterval(async () => {
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = 'isu-tienda'");
  maxConexiones = Math.max(maxConexiones, rows[0].n);
}, 250);

async function correr(nombre, url, conexiones, extra = {}) {
  const r = await autocannon({ url, connections: conexiones, duration: SEGUNDOS, ...extra });
  const fila = {
    prueba: nombre,
    "pedidos/s": Math.round(r.requests.average),
    "p50 ms": r.latency.p50,
    "p99 ms": r.latency.p99,
    "no-2xx": r.non2xx,
    errores: r.errors + r.timeouts,
  };
  console.table([fila]);
  return fila;
}

// El límite por IP frenaría la prueba (todo sale de 127.0.0.1): se prueba el origen sin ese freno
// levantando la API con LIMITE_PEDIDOS_POR_MINUTO alto, y el freno en sí se prueba aparte.
// Con INTERNO_TOKEN se prueba como la pide el servidor de la tienda (sin el freno por IP).
const interno = process.env.INTERNO_TOKEN ? { headers: { "x-isu-interno": process.env.INTERNO_TOKEN } } : {};
const unSlug = (await (await fetch(`${API}/v1/productos-slugs`, interno)).json())[0]?.slug;
const filas = [];
filas.push(await correr("API /v1/config", `${API}/v1/config`, 100, interno));
filas.push(await correr("API /v1/categorias/mujer", `${API}/v1/categorias/mujer`, 100, interno));
filas.push(await correr("API /v1/productos?categoria=mujer", `${API}/v1/productos?categoria=mujer`, 100, interno));
if (unSlug) filas.push(await correr("API /v1/productos/:slug", `${API}/v1/productos/${unSlug}`, 100, interno));
// La búsqueda no tiene caché de memoria: es la que más le pide a la base compartida.
filas.push(await correr("API /v1/buscar?q=remera (sin caché)", `${API}/v1/buscar?q=remera`, 50, interno));
filas.push(await correr("Tienda / (HTML)", `${WEB}/`, 50));
filas.push(await correr("Tienda /mujer/remeras-y-tops", `${WEB}/mujer/remeras-y-tops`, 50));
if (unSlug) filas.push(await correr("Tienda /producto/:slug", `${WEB}/producto/${unSlug}`, 50));
clearInterval(vigia);
await pool.end();

console.log(`\nConexiones máximas de la tienda a la base de Stocker durante la carga: ${maxConexiones}`);
const malas = filas.filter((f) => f.errores > 0 || f["no-2xx"] > 0);
if (malas.length) { console.log("✗ hubo errores o respuestas no-2xx"); process.exit(1); }
console.log("✓ sin errores ni respuestas no-2xx");
