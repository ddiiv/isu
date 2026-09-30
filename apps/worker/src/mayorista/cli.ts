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
if (!process.env.DATABASE_URL) {
  console.error("Falta DATABASE_URL.");
  process.exit(2);
}
if (!/^https?:\/\//.test(values.url)) {
  console.error("--url tiene que ser http(s)://…");
  process.exit(2);
}
const pool = crearPool({ url: process.env.DATABASE_URL, ssl: process.env.DB_SSL === "true", max: 2, nombreApp: "isu-tienda-mayorista" });
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
    const r = await aplicar(pool, almacenDesdeEntorno(), plan, values.cache ? conCache(bajar, values.cache) : bajar, { reemplazar: values.reemplazar, log: (s) => console.warn(s) });
    console.warn(`\n${r.productos} productos · ${r.fotosSubidas} fotos subidas · ${r.fotosOmitidas.length} omitidas`);
    if (r.ocultados.length) console.warn(`ocultos (sin fotos): ${r.ocultados.join(", ")}`);
    if (r.mostrados.length) console.warn(`visibles (ya tienen fotos): ${r.mostrados.join(", ")}`);
    if (process.env.REDIS_URL && r.slugs.length) {
      const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
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
