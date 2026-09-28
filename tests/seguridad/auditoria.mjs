/*
 * Auditoría de seguridad de la etapa (rol "hacker").
 *
 * Ataca los servicios levantados como lo haría alguien de afuera y falla si
 * algo responde distinto de lo esperado. Se corre al cerrar cada etapa y en
 * CI contra staging:
 *   API_URL=… WEB_URL=… ADMIN_URL=… node tests/seguridad/auditoria.mjs
 */
import net from "node:net";

const API = process.env.API_URL ?? "http://127.0.0.1:4000";
const WEB = process.env.WEB_URL ?? "http://127.0.0.1:3000";
const ADMIN = process.env.ADMIN_URL ?? "http://127.0.0.1:3001";

const resultados = [];
const chk = (grupo, nombre, ok, detalle = "") => resultados.push({ grupo, nombre, ok: !!ok, detalle });
const pedir = (url, opciones = {}) => fetch(url, { redirect: "manual", ...opciones });

// ── 1. Cabeceras en las tres superficies ─────────────────────────────
for (const [nombre, url] of [["api", `${API}/v1/config`], ["web", `${WEB}/`], ["admin", `${ADMIN}/`]]) {
  const h = (await pedir(url)).headers;
  const csp = h.get("content-security-policy") ?? "";
  chk("cabeceras", `${nombre}: CSP con frame-ancestors 'none'`, /frame-ancestors 'none'/.test(csp), csp.slice(0, 80));
  chk("cabeceras", `${nombre}: CSP sin unsafe-eval`, !/unsafe-eval/.test(csp));
  chk("cabeceras", `${nombre}: nosniff`, h.get("x-content-type-options") === "nosniff");
  chk("cabeceras", `${nombre}: sin x-powered-by`, !h.get("x-powered-by"));
  chk("cabeceras", `${nombre}: server sin versión`, !/\d/.test(h.get("server") ?? ""), h.get("server") ?? "");
}
chk("cabeceras", "admin: fuera de buscadores (X-Robots-Tag)", /noindex/.test((await pedir(`${ADMIN}/`)).headers.get("x-robots-tag") ?? ""));
chk("cabeceras", "admin: no se cachea", /no-store/.test((await pedir(`${ADMIN}/`)).headers.get("cache-control") ?? ""));

// ── 2. Archivos que nunca tienen que servirse ─────────────────────────
for (const base of [WEB, ADMIN, API]) {
  for (const ruta of ["/.env", "/.env.local", "/.git/config", "/package.json", "/next.config.ts", "/.next/server/app/page.js", "/../../etc/passwd", "/%2e%2e/%2e%2e/etc/passwd", "/server.js"]) {
    const r = await pedir(base + ruta);
    const cuerpo = await r.text();
    chk("exposición", `${base.replace(/^https?:\/\//, "")}${ruta} no expone nada`, r.status >= 400 || !/DATABASE_URL|\[core\]|"dependencies"|root:x:0/.test(cuerpo), String(r.status));
  }
}

// ── 3. Mapas de código fuente en el navegador ─────────────────────────
const html = await (await pedir(`${WEB}/`)).text();
const chunks = [...html.matchAll(/\/_next\/static\/chunks\/[^"]+\.js/g)].slice(0, 6).map((m) => m[0]);
let conMapa = 0;
for (const c of chunks) {
  const js = await (await pedir(WEB + c)).text();
  if (/sourceMappingURL=/.test(js)) conMapa++;
  if ((await pedir(WEB + c + ".map")).status === 200) conMapa++;
}
chk("exposición", `sin source maps públicos (${chunks.length} chunks revisados)`, chunks.length > 0 && conMapa === 0);

// ── 4. Métodos HTTP ───────────────────────────────────────────────────
for (const [base, metodo] of [[API, "TRACE"], [API, "DELETE"], [WEB, "PUT"], [WEB, "DELETE"]]) {
  const r = await pedir(`${base}/`, { method: metodo }).catch((e) => ({ status: `error ${e.cause?.code ?? e.message}` }));
  chk("métodos", `${metodo} ${base.replace(/^https?:\/\//, "")}/ no es 2xx`, typeof r.status !== "number" || r.status >= 400, String(r.status));
}

// ── 5. Inyección en la API ────────────────────────────────────────────
const cargas = [
  "' OR '1'='1", "1; DROP TABLE tienda.categorias; --", "hombre' UNION SELECT password FROM users--",
  "{\"$gt\":\"\"}", "../../../../etc/passwd", "%00", "<img src=x onerror=alert(1)>", "${7*7}", "{{7*7}}",
  "hombre%0d%0aSet-Cookie:%20x=1", "\u202Eslug", "a".repeat(5000),
];
for (const carga of cargas) {
  const r = await pedir(`${API}/v1/categorias/${encodeURIComponent(carga)}`);
  const cuerpo = await r.text();
  chk("inyección", `slug malicioso → 400/404 sin detalles (${carga.slice(0, 24)})`,
    [400, 404, 414].includes(r.status) && !/syntax|SQL|pg_|stack|at \//i.test(cuerpo) && !r.headers.get("set-cookie"), String(r.status));
}
const cats = await (await pedir(`${API}/v1/categorias`)).json();
chk("inyección", "la tabla de categorías sigue intacta", Array.isArray(cats) && cats.length === 3);

// ── 6. Cuerpos hostiles ───────────────────────────────────────────────
const profundo = "[".repeat(20000) + "]".repeat(20000);
for (const [nombre, cuerpo, tipo, esperado] of [
  ["JSON anidado 20.000 niveles", profundo, "application/json", [400, 404, 413]],
  ["prototype pollution", '{"__proto__":{"admin":true}}', "application/json", [400, 404]],
  ["constructor.prototype", '{"constructor":{"prototype":{"admin":true}}}', "application/json", [400, 404]],
  ["1 MB de cuerpo", JSON.stringify({ x: "a".repeat(1_000_000) }), "application/json", [404, 413]],
  ["XML", "<?xml version='1.0'?><!DOCTYPE x [<!ENTITY e SYSTEM 'file:///etc/passwd'>]><x>&e;</x>", "application/xml", [404, 415]],
]) {
  const r = await pedir(`${API}/v1/config`, { method: "POST", headers: { "content-type": tipo }, body: cuerpo }).catch((e) => ({ status: `error ${e.message}` }));
  chk("cuerpos", `${nombre} → rechazado`, esperado.includes(r.status), String(r.status));
}
chk("cuerpos", "la API sigue viva después", (await pedir(`${API}/healthz`)).status === 200);

// Cabecera gigante (Node corta en 16 KB) → 431, sin tumbar el proceso.
const grande = await new Promise((ok) => {
  const u = new URL(API);
  const s = net.connect(Number(u.port), u.hostname, () => {
    s.write(`GET /healthz HTTP/1.1\r\nHost: x\r\nX-Relleno: ${"a".repeat(64 * 1024)}\r\n\r\n`);
  });
  let datos = "";
  s.on("data", (d) => { datos += d; s.end(); });
  s.on("close", () => ok(datos.split("\r\n")[0]));
  s.on("error", () => ok("conexión cortada"));
});
chk("cuerpos", "cabecera de 64 KB → 431 o corte", /431|400|cortada/.test(grande), grande);

// ── 7. CORS ────────────────────────────────────────────────────────────
for (const origen of ["https://evil.example", "null", "https://isuwaya.com.evil.example", "http://127.0.0.1:3000.evil.example"]) {
  const r = await pedir(`${API}/v1/config`, { method: "OPTIONS", headers: { origin: origen, "access-control-request-method": "POST" } });
  chk("cors", `preflight desde ${origen} sin permiso`, !r.headers.get("access-control-allow-origin"));
}

// ── 8. Límite de pedidos (no se esquiva falsificando la IP) ───────────
let bloqueado = false;
for (let i = 0; i < 400 && !bloqueado; i++) {
  const r = await pedir(`${API}/v1/config`, { headers: { "x-forwarded-for": `9.9.${i % 250}.${i % 7}` } });
  if (r.status === 429) bloqueado = true;
}
chk("límite", "ráfaga con X-Forwarded-For inventado termina en 429", bloqueado);

// ── Informe ────────────────────────────────────────────────────────────
const fallas = resultados.filter((r) => !r.ok);
const grupos = [...new Set(resultados.map((r) => r.grupo))];
for (const g of grupos) {
  const del = resultados.filter((r) => r.grupo === g);
  console.log(`\n${g.toUpperCase()}  ${del.filter((r) => r.ok).length}/${del.length}`);
  for (const r of del.filter((x) => !x.ok)) console.log(`  ✗ ${r.nombre}  [${r.detalle}]`);
}
console.log(`\nTOTAL ${resultados.length - fallas.length}/${resultados.length}`);
process.exit(fallas.length ? 1 : 0);
