/*
 * Diagnóstico de una instalación, desde afuera (como la ve un cliente):
 *
 *   pnpm diagnostico https://www.tu-tienda.com.ar [https://admin.tu-tienda.com.ar]
 *
 * Revisa que las páginas carguen, que lleguen los archivos del navegador
 * (sin ellos la página se ve pero los botones no hacen nada), que la tienda
 * llegue a la API, a la base y a Redis, que haya productos y que el dominio
 * configurado coincida. Para cada falla dice qué revisar. No cambia nada.
 */
const [tienda, admin] = process.argv.slice(2).map((u) => u?.replace(/\/+$/, ""));
if (!tienda || !/^https?:\/\//.test(tienda)) {
  console.error("Uso: pnpm diagnostico https://www.tu-tienda.com.ar [https://admin.tu-tienda.com.ar]");
  process.exit(2);
}
const resultados = [];
const decir = (t) => process.stdout.write(`${t}\n`);
const bien = (t) => { resultados.push(true); decir(`  ✓ ${t}`); };
const mal = (t, qué) => { resultados.push(false); decir(`  ✗ ${t}\n      → ${qué.replace(/\n/g, "\n        ")}`); };
const ojo = (t, qué) => decir(`  ! ${t}${qué ? `\n      → ${qué}` : ""}`);
const pedir = async (url, o = {}) => {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(o.plazo ?? 20_000), ...o });
    return { r, ms: Date.now() - t0, texto: o.sinCuerpo ? "" : await r.text() };
  } catch (e) {
    return { r: null, ms: Date.now() - t0, error: e.name === "TimeoutError" ? `no contestó en ${(o.plazo ?? 20_000) / 1000} s` : e.cause?.code ?? e.message };
  }
};

async function estaticos(base, html, nombre) {
  const rutas = [...new Set([...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]))];
  if (!rutas.length) return mal(`${nombre}: la página no trae los scripts de Next`, "La respuesta no parece la tienda (¿otra app en ese dominio, o una página de error del proxy?).");
  const fallas = [];
  for (const ruta of rutas.slice(0, 25)) {
    const { r, error } = await pedir(base + ruta, { plazo: 15_000 });
    const tipo = r?.headers.get("content-type") ?? "";
    const esperado = ruta.endsWith(".css") ? /text\/css/ : /javascript/;
    if (!r || r.status !== 200 || !esperado.test(tipo)) fallas.push(`${ruta} → ${r ? `${r.status} ${tipo}` : error}`);
  }
  if (!fallas.length) return bien(`${nombre}: llegan los ${rutas.length} archivos del navegador (JS y CSS)`);
  mal(`${nombre}: ${fallas.length} de ${rutas.length} archivos del navegador no llegan — por eso hay pantallas en blanco y botones que no responden`,
    `${fallas.slice(0, 3).join("\n")}\n` +
    "Causas habituales:\n" +
    "  · el build no copió los estáticos: el comando de arranque tiene que ser `pnpm --filter @isu/web start`\n" +
    "    (o admin) y el build `pnpm --filter @isu/web... build` (corre `postbuild`, que los copia);\n" +
    "  · Cloudflare (u otro caché) guardó páginas de un deploy anterior: purgá la caché (Caching → Purge Everything)\n" +
    "    y cacheá sólo /_next/static/*, nunca el HTML;\n" +
    "  · dos réplicas con builds distintos: redeploy de todas.");
}

decir(`\nTienda: ${tienda}`);
const inicio = await pedir(`${tienda}/`);
if (!inicio.r) {
  mal("la tienda no contesta", `${inicio.error}. Revisá que el servicio web esté corriendo y el dominio apunte a él.`);
} else if (inicio.r.status >= 300 && inicio.r.status < 400) {
  ojo(`/ redirige a ${inicio.r.headers.get("location")}`, "Si es otro dominio, corré el diagnóstico contra ese.");
} else if (inicio.r.status !== 200) {
  mal(`/ responde ${inicio.r.status}`, "Mirá el log del servicio web en Railway.");
} else {
  bien(`inicio carga (${inicio.ms} ms)`);
  await estaticos(tienda, inicio.texto, "tienda");
  if (!inicio.r.headers.get("content-security-policy")) ojo("sin cabecera Content-Security-Policy", "¿Algo delante de la tienda la está sacando?");
}

// ── Conexiones del servidor de la tienda ──
const s = await pedir(`${tienda}/api/salud`);
let salud = null;
try { salud = JSON.parse(s.texto); } catch { /* */ }
if (!s.r || s.r.status === 404 || !salud) {
  ojo("la tienda no tiene /api/salud", "Es una versión anterior a este diagnóstico: desplegá la última y volvé a correrlo para ver API, base y Redis.");
} else {
  if (salud.api.ok) bien(`la tienda llega a la API (${salud.api.ms} ms)`);
  else mal(`la tienda NO llega a la API (${salud.api.error ?? `responde ${salud.api.estado ?? "mal"}`})`,
    "En el servicio web, API_URL tiene que ser la dirección interna de la api, con puerto:\n" +
    "http://<servicio-api>.railway.internal:<PORT de la api> (sin barra al final). Sin esto no anda el carrito,\n" +
    "ni la cuenta, ni «Armá tu outfit», ni el asistente: se quedan cargando o dan error.");
  if (salud.base === true) bien("la API llega a la base"); else if (salud.base === false) mal("la API NO llega a la base", "Revisá DATABASE_URL en el servicio api.");
  if (salud.redis === true) bien("la API llega a Redis"); else if (salud.redis === false) mal("la API NO llega a Redis", "Revisá REDIS_URL en el servicio api.");
  if (salud.productos > 0) bien(`hay ${salud.productos} productos publicados`);
  else if (salud.productos === 0) ojo("no hay productos publicados todavía",
    "La tienda anda igual, pero vacía. Los productos los trae el worker desde Stocker (mirá su log: STOCKER_TOKEN,\nlocales que abastecen online) y después las fotos: `pnpm mayorista:importar --aplicar` en la consola del worker.");
  if (!salud.credencialInterna) mal("falta INTERNO_TOKEN en el servicio web", "Tiene que ser el mismo que en la api: sin él, la API frena a la propia tienda por exceso de pedidos.");
  if (salud.coincide) bien(`el dominio configurado coincide (${salud.sitioConfigurado})`);
  else ojo(`entraste por ${salud.entraste}, pero NEXT_PUBLIC_SITE_URL dice ${salud.sitioConfigurado}`,
    "La tienda anda igual por cualquiera de los dos, pero los enlaces de los mails, la vuelta de Mercado Pago,\n        el sitemap y Google usan el configurado. Cuando tengas el dominio definitivo, ponelo ahí y redeploy del web.");
}

// ── El navegador → la tienda → la API (lo que usan carrito, outfits, cuenta…) ──
{
  const origen = new URL(tienda).origin;
  const { r, texto, error, ms } = await pedir(`${tienda}/api/t/carrito`, {
    method: "POST", headers: { "content-type": "application/json", "x-isu": "1", origin: origen },
    body: JSON.stringify({ items: [{ sku: "DIAGNOSTICO-NO-EXISTE", cantidad: 1 }] }),
  });
  if (!r) mal("el carrito no contesta", error);
  else if (r.status === 200) bien(`el carrito cotiza (${ms} ms)`);
  else if (r.status === 403) mal("la tienda rechaza los pedidos del navegador (403 «Pedido no permitido»)",
    "Es la verificación de origen de una versión anterior: pasa cuando entrás por un dominio distinto de\nNEXT_PUBLIC_SITE_URL. Desplegá esta versión (acepta el dominio por el que entrás) o corregí la variable.");
  else if (r.status === 503) mal("el carrito no llega a la API (503)", "Ver arriba: API_URL del servicio web.");
  else if (r.status === 429) ojo("el carrito respondió 429 (límite de pedidos)", "Normal si corriste el diagnóstico varias veces seguidas.");
  else mal(`el carrito responde ${r.status}`, texto.slice(0, 200));
}

// ── Páginas que tienen que cargar rápido ──
{
  const lentas = [], rotas = [];
  for (const ruta of ["/hombre", "/mujer", "/ninos", "/nuevos", "/outfits", "/buscar?q=remera", "/carrito", "/checkout", "/cuenta", "/locales", "/devoluciones"]) {
    const { r, ms, error } = await pedir(tienda + ruta, { plazo: 25_000, sinCuerpo: true });
    if (!r || r.status >= 500) rotas.push(`${ruta} → ${r ? r.status : error}`);
    else if (ms > 5000) lentas.push(`${ruta} (${(ms / 1000).toFixed(1)} s)`);
  }
  if (rotas.length) mal(`${rotas.length} páginas no cargan`, `${rotas.join("\n")}\nMirá el log del servicio web.`);
  else if (lentas.length) ojo(`páginas lentas: ${lentas.join(", ")}`, "Suele ser la API lejos o lenta (API_URL por internet en vez de la red interna).");
  else bien("las páginas principales cargan en menos de 5 s");
}

if (admin) {
  decir(`\nBackoffice: ${admin}`);
  const a = await pedir(`${admin}/ingresar`);
  if (!a.r) mal("el backoffice no contesta", a.error);
  else if (a.r.status !== 200) ojo(`/ingresar responde ${a.r.status}`, a.r.status === 302 || a.r.status === 403 ? "¿Cloudflare Access? Corré el diagnóstico desde una sesión que tenga acceso, o probalo a mano." : "Mirá el log del servicio admin.");
  else { bien(`ingresar carga (${a.ms} ms)`); await estaticos(admin, a.texto, "backoffice"); }
}

const fallas = resultados.filter((x) => !x).length;
decir(fallas ? `\n${fallas} problema${fallas === 1 ? "" : "s"} para revisar (arriba, con qué hacer).\n` : "\nTodo bien.\n");
process.exitCode = fallas ? 1 : 0;
