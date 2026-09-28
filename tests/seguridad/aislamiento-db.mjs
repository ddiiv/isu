/*
 * ¿Qué puede hacer la tienda en la base de Stocker si alguien consiguiera
 * ejecutar SQL con su usuario? Nada fuera de su esquema.
 *
 * Crea el rol con infra/sql/rol-tienda.sql (hace falta un superusuario, sólo
 * en la base de PRUEBA), migra como tienda_app y prueba lo que no debe poder.
 *   ADMIN_DATABASE_URL=postgres://postgres@127.0.0.1:5433/stocker_test node tests/seguridad/aislamiento-db.mjs
 */
import { readFile } from "node:fs/promises";
import pg from "pg";
import { crearPool, migrar } from "../../packages/db/dist/index.js";

const ADMIN = process.env.ADMIN_DATABASE_URL ?? "postgres://postgres@127.0.0.1:5433/stocker_test";
const CLAVE = "clave-de-prueba-aislamiento-" + Math.random().toString(36).slice(2);
const admin = new pg.Client({ connectionString: ADMIN });
await admin.connect();

await admin.query("DROP SCHEMA IF EXISTS tienda CASCADE");
await admin.query("DROP OWNED BY tienda_app").catch(() => {});
await admin.query("DROP ROLE IF EXISTS tienda_app");
// eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta fija del repo
const sql = (await readFile(new URL("../../infra/sql/rol-tienda.sql", import.meta.url), "utf8")).replace("CAMBIAR-por-una-clave-larga", CLAVE);
await admin.query(sql);

const u = new URL(ADMIN);
u.username = "tienda_app";
u.password = CLAVE;
const pool = crearPool({ url: u.toString(), max: 2 });

const resultados = [];
const chk = (nombre, ok, detalle = "") => { resultados.push(ok); console.log(`${ok ? "  ✓" : "  ✗"} ${nombre}${detalle ? `  [${detalle}]` : ""}`); };
const falla = async (q) => pool.query(q).then(() => "permitido", (e) => e.code);

const r = await migrar(pool);
chk("tienda_app migra su esquema", r.aplicadas.length >= 3, `${r.aplicadas.length} migraciones`);
chk("y usa sus tablas", (await pool.query("SELECT count(*)::int AS n FROM tienda.categorias")).rows[0].n > 0);

const { rows: tablas } = await admin.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename LIMIT 5");
chk("la base de prueba tiene tablas de Stocker", tablas.length > 0, tablas.map((t) => t.tablename).join(", "));
for (const { tablename } of tablas) {
  const t = `public."${tablename}"`;
  chk(`no puede LEER ${t}`, (await falla(`SELECT * FROM ${t} LIMIT 1`)) === "42501");
  chk(`no puede BORRAR ${t}`, (await falla(`DELETE FROM ${t}`)) === "42501");
}
chk("no puede crear tablas en public", (await falla("CREATE TABLE public.x_hack (id int)")) === "42501");
chk("no puede crear roles", (await falla("CREATE ROLE hacker LOGIN")) === "42501");
chk("no puede leer contraseñas de roles", (await falla("SELECT rolpassword FROM pg_authid")) === "42501");
chk("no puede leer archivos del servidor", ["42501"].includes(await falla("SELECT pg_read_file('/etc/passwd')")));
chk("no puede ejecutar comandos (COPY PROGRAM)", ["42501"].includes(await falla("COPY (SELECT 1) TO PROGRAM 'id'")));
const lenta = await falla("SELECT pg_sleep(12)");
chk("una consulta colgada se corta sola (statement_timeout)", lenta === "57014", lenta);

await pool.end();
// Dejar la base de prueba como estaba para los demás tests (esquema de nuevo del superusuario).
await admin.query("DROP SCHEMA tienda CASCADE");
await admin.query("DROP OWNED BY tienda_app");
await admin.query("DROP ROLE tienda_app");
await admin.end();

const ok = resultados.filter(Boolean).length;
console.log(`\n${ok}/${resultados.length}`);
process.exit(ok === resultados.length ? 0 : 1);
