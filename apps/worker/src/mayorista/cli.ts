import { parseArgs } from "node:util";
import { Redis } from "ioredis";
import { crearPool } from "@isu/db";
import { almacenDesdeEntorno } from "../fotos/almacen.js";
import { crearInvalidador } from "../stocker/invalidar.js";
import { aplicar, conCache, descargadorDe, informe, leerCatalogo, planificar, URL_MAYORISTA } from "./importar.js";

/*
 * pnpm mayorista:importar                 muestra qué haría (no escribe nada)
 * pnpm mayorista:importar --aplicar       lo hace
 *   --url https://…                       otro sitio mayorista (por defecto el de producción)
 *   --reemplazar                          borra las fotos que ya tenían esos productos y las vuelve a traer
 *   --cache <carpeta>                     guarda las fotos bajadas ahí (otra corrida no las vuelve a pedir)
 *
 * Necesita DATABASE_URL y FOTOS_DIR o R2_* (como el worker). Correrlo
 * DESPUÉS de que el worker haya traído el catálogo de Stocker: engancha
 * con esos productos.
 */
const { values } = parseArgs({
  options: {
    aplicar: { type: "boolean", default: false },
    reemplazar: { type: "boolean", default: false },
    url: { type: "string", default: process.env.MAYORISTA_CATALOGO_URL || URL_MAYORISTA },
    cache: { type: "string" },
  },
});
const salir = (msg: string): never => { console.error(`\n✗ ${msg}\n`); process.exit(2); };
if (!process.env.DATABASE_URL) {
  salir("Falta DATABASE_URL (la misma base que usan la api y el worker).\n  En Railway: corrélo en la consola del servicio worker (ahí ya está), o con\n  `railway run --service worker pnpm mayorista:importar` desde tu compu.");
}
if (!/^https?:\/\//.test(values.url)) salir("--url tiene que ser http(s)://…");

// A qué base se conecta (sin la contraseña), para que se vea si es la equivocada.
let destino = "";
try {
  const u = new URL(process.env.DATABASE_URL!);
  destino = `${u.hostname}:${u.port || 5432}${u.pathname}`;
} catch {
  salir("DATABASE_URL no es una dirección válida (tiene que ser postgres://usuario:clave@host:puerto/base).\n  Si en Railway ves ${{Postgres.DATABASE_URL}} sin reemplazar, la variable no está resuelta en esta consola.");
}
const local = /^(localhost|127\.0\.0\.1|\[?::1\]?)$/.test(destino.split(":")[0]!);
console.warn(`Base: ${destino}`);

// Las fotos se guardan donde las guarda la tienda (R2 en producción): si falta, avisar antes de bajar nada.
let almacen: ReturnType<typeof almacenDesdeEntorno> | null = null;
if (values.aplicar) {
  try { almacen = almacenDesdeEntorno(); } catch (e) {
    salir(`No hay dónde guardar las fotos: ${(e as Error).message}\n  Hacen falta las mismas variables R2_* (o FOTOS_DIR) que tiene el worker.`);
  }
}

const pool = crearPool({ url: process.env.DATABASE_URL!, ssl: process.env.DB_SSL === "true", max: 2, nombreApp: "isu-tienda-mayorista" });
try {
  await pool.query("SELECT 1");
} catch (e) {
  const err = e as { code?: string; message: string; errors?: Array<{ code?: string }> };
  const codigo = err.code ?? err.errors?.[0]?.code;
  await pool.end().catch(() => {});
  if (codigo === "ECONNREFUSED" && local) {
    salir(`No hay ninguna base en ${destino}: DATABASE_URL apunta a esta misma máquina.\n  Esto pasa si se corre en una consola sin las variables del servicio (por ejemplo un contenedor\n  armado a mano o \`docker run\` sin --env-file). Correlo:\n    · en Railway → servicio worker → consola (ahí DATABASE_URL ya es la de producción), o\n    · desde tu compu: \`railway run --service worker pnpm mayorista:importar\`\n      (si la base sólo tiene red privada, usá DATABASE_PUBLIC_URL: DATABASE_URL=$DATABASE_PUBLIC_URL pnpm mayorista:importar).`);
  }
  if (codigo === "ENOTFOUND" || codigo === "EAI_AGAIN") {
    salir(`No se encuentra el servidor ${destino}.\n  Si es *.railway.internal, esa dirección sólo existe dentro de Railway: desde tu compu usá DATABASE_PUBLIC_URL.`);
  }
  if (codigo === "28P01" || codigo === "28000") salir(`La base rechazó el usuario o la contraseña de DATABASE_URL (${destino}).`);
  salir(`No me pude conectar a la base ${destino}: ${err.message || codigo}`);
}
{
  const t = await pool.query<{ n: number | null }>("SELECT (SELECT count(*) FROM tienda.productos WHERE en_stocker)::int AS n").catch(() => ({ rows: [{ n: null }] }));
  const n = t.rows[0]?.n;
  if (n === null || n === undefined) {
    await pool.end();
    salir("La base no tiene las tablas de la tienda: desplegá la api primero (al arrancar aplica las migraciones).");
  }
  if (n === 0) {
    await pool.end();
    salir("La tienda todavía no tiene productos de Stocker: la importación engancha con ellos, así que no hay nada a qué ponerle fotos.\n  Mirá el log del worker: tiene que decir que sincronizó el catálogo (si dice \"sin locales online\" o da 401,\n  revisá en Stocker la credencial STOCKER_TOKEN y que haya locales que abastecen online).\n  También podés forzarlo desde el backoffice: Productos → «Traer cambios de Stocker».");
  }
  console.warn(`Productos de Stocker en la tienda: ${n}`);
}
try {
  console.warn(`Leyendo el catálogo de ${values.url} …`);
  const cat = await leerCatalogo(values.url);
  const plan = await planificar(pool, cat, { reemplazar: values.reemplazar });
  console.warn(informe(plan));
  if (!values.aplicar) {
    console.warn("\nNo se escribió nada. Para hacerlo: --aplicar");
  } else {
    console.warn("\nAplicando…");
    const bajar = descargadorDe(values.url);
    const r = await aplicar(pool, almacen!, plan, values.cache ? conCache(bajar, values.cache) : bajar, { reemplazar: values.reemplazar, log: (s) => console.warn(s) });
    console.warn(`\n${r.productos} productos · ${r.fotosSubidas} fotos subidas · ${r.fotosOmitidas.length} omitidas`);
    if (r.ocultados.length) console.warn(`ocultos (sin fotos): ${r.ocultados.join(", ")}`);
    if (r.mostrados.length) console.warn(`visibles (ya tienen fotos): ${r.mostrados.join(", ")}`);
    if (process.env.REDIS_URL && r.slugs.length) {
      const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true, family: 0 });
      redis.on("error", () => {});
      try {
        await crearInvalidador({ redis, webUrl: process.env.WEB_INTERNAL_URL, token: process.env.REVALIDAR_TOKEN, log: { warn: () => {} } })(r.slugs);
        console.warn(`páginas regeneradas: ${r.slugs.length}`);
      } finally { redis.disconnect(); }
    }
    process.exitCode = r.fotosOmitidas.length ? 1 : 0;
  }
} finally {
  await pool.end();
}
