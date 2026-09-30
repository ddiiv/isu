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

// ── 9. Catálogo (etapa 1) ─────────────────────────────────────────────
const catalogo = await (await pedir(`${API}/v1/productos-slugs`)).json().catch(() => []);
const unSlug = catalogo[0]?.slug;
chk("catálogo", "hay productos publicados para auditar", !!unSlug);
if (unSlug) {
  const ficha = await (await pedir(`${API}/v1/productos/${unSlug}`)).text();
  chk("catálogo", "la ficha no expone ids ni campos internos de Stocker", !/stocker_?id|stockerId|stock_en|en_stocker|"visible"|costo|precioMayorista/i.test(ficha));
  chk("catálogo", "el stock nunca viaja exacto (tope 10)", JSON.parse(ficha).variantes.every((v) => v.stock <= 10));
}
for (const slug of ["..%2F..%2Fetc%2Fpasswd", "a'%20OR%201=1--", "%3Cscript%3E", "A".repeat(81), "mujer%00"]) {
  const r = await pedir(`${API}/v1/productos/${slug}`);
  chk("catálogo", `ficha con slug malicioso (${slug.slice(0, 20)}) → 400/404`, r.status === 400 || r.status === 404, String(r.status));
}
for (const q of ["' OR 1=1 --", "a:* | b:* & !c", "\\\\", "%_%", "<script>alert(1)</script>", "));SELECT pg_sleep(5);--", "🙂🙂🙂"]) {
  const t0 = Date.now();
  const r = await pedir(`${API}/v1/buscar?q=${encodeURIComponent(q)}`);
  chk("catálogo", `búsqueda «${q.slice(0, 18)}» no rompe ni demora`, r.status < 500 && Date.now() - t0 < 2000, `${r.status} ${Date.now() - t0}ms`);
}
for (const qs of ["categoria=mujer&categoria=hombre", "categoria[]=mujer", "categoria=mujer&sub=a&extra=1", "nuevos=-1", "nuevos=99999", "categoria=mujer&nuevos=5"]) {
  const r = await pedir(`${API}/v1/productos?${qs}`);
  chk("catálogo", `parámetros raros (${qs}) → 400/404`, r.status === 400 || r.status === 404, String(r.status));
}
for (const ruta of ["/fotos/../.env", "/fotos/p/1/..%2f..%2f.env", "/fotos/p/1/abcdefgh-800.webp%00.png", "/fotos/%2e%2e/%2e%2e/etc/passwd"]) {
  const r = await pedir(API + ruta);
  chk("catálogo", `fotos: ${ruta} no sale de su carpeta`, r.status === 404 || r.status === 400, String(r.status));
}

// La web: lo que escribe el usuario vuelve escapado.
{
  const q = '"><img src=x onerror=alert(1)><script>alert(2)</script>';
  const cuerpo = await (await pedir(`${WEB}/buscar?q=${encodeURIComponent(q)}`)).text();
  chk("catálogo", "búsqueda de la web: el texto vuelve escapado (sin XSS reflejado)", !cuerpo.includes("<script>alert(2)") && !cuerpo.includes("<img src=x onerror"));
  const r = await pedir(`${WEB}/producto/%3Cscript%3Ealert(1)%3C%2Fscript%3E`);
  chk("catálogo", "ficha con slug de script → 404 sin reflejarlo", r.status === 404 && !(await r.text()).includes("<script>alert(1)"), String(r.status));
}

// Ruta de revalidación (la llama el worker): sin la credencial no existe.
{
  const cuerpo = JSON.stringify({ etiquetas: ["catalogo"] });
  const post = (auth, body = cuerpo) => pedir(`${WEB}/api/revalidar`, { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) }, body });
  chk("revalidar", "GET → 404", (await pedir(`${WEB}/api/revalidar`)).status === 404);
  chk("revalidar", "POST sin credencial → 404", (await post()).status === 404);
  chk("revalidar", "POST con credencial inventada → 404", (await post("Bearer " + "x".repeat(40))).status === 404);
  chk("revalidar", "POST con credencial vacía → 404", (await post("Bearer ")).status === 404);
  const token = process.env.REVALIDAR_TOKEN;
  if (token) {
    chk("revalidar", "con credencial: etiqueta inventada → 400", (await post(`Bearer ${token}`, JSON.stringify({ etiquetas: ["producto:../../x"] }))).status === 400);
    chk("revalidar", "con credencial: campos de más → 400", (await post(`Bearer ${token}`, JSON.stringify({ etiquetas: ["catalogo"], path: "/" }))).status === 400);
    chk("revalidar", "con credencial: JSON roto → 400", (await post(`Bearer ${token}`, "{")).status === 400);
    chk("revalidar", "con credencial: pedido válido → 200", (await post(`Bearer ${token}`)).status === 200);
  }
}

// Ningún secreto del servidor viaja al navegador (HTML y JavaScript).
{
  const secretos = ["STOCKER_TOKEN", "INTERNO_TOKEN", "REVALIDAR_TOKEN", "R2_SECRET_ACCESS_KEY", "PAGOS_TOKEN", "MP_ACCESS_TOKEN", "MP_WEBHOOK_SECRET"].map((k) => process.env[k]).filter((v) => v && v.length >= 20);
  const paginas = ["/", "/mujer", unSlug ? `/producto/${unSlug}` : "/", "/checkout", "/cuenta", "/carrito"];
  let texto = "";
  for (const p of paginas) {
    const h = await (await pedir(WEB + p)).text();
    texto += h;
    for (const m of [...h.matchAll(/\/_next\/static\/chunks\/[^"]+\.js/g)].slice(0, 15)) texto += await (await pedir(WEB + m[0])).text();
  }
  chk("secretos", `ningún secreto en HTML/JS (${secretos.length} revisados)`, secretos.length > 0 && secretos.every((s) => !texto.includes(s)));
  chk("secretos", "no aparece la URL interna de la API ni de Stocker", !/railway\.internal|127\.0\.0\.1:3900|STOCKER_API_URL/.test(texto));
}

// ── 10. Etapa 2: cuentas, pedidos y pagos ─────────────────────────────
{
  const G = "etapa 2";
  const ORIGEN = new URL(WEB).origin;
  const bff = (ruta, init = {}) => pedir(`${WEB}/api/t/${ruta}`, init);
  const jsonH = (extra = {}) => ({ "content-type": "application/json", origin: ORIGEN, "x-isu": "1", ...extra });

  // CSRF: sin la cabecera propia o desde otro sitio, nada que cambie algo pasa.
  chk(G, "BFF: POST sin x-isu → 403", (await bff("carrito", { method: "POST", headers: { "content-type": "application/json", origin: ORIGEN }, body: "{}" })).status === 403);
  chk(G, "BFF: POST desde otro origen → 403", (await bff("cuenta/ingresar", { method: "POST", headers: jsonH({ origin: "https://evil.example" }), body: "{}" })).status === 403);
  chk(G, "BFF: POST sin Origin → 403", (await bff("pedidos", { method: "POST", headers: { "content-type": "application/json", "x-isu": "1" }, body: "{}" })).status === 403);
  chk(G, "BFF: formulario (text/plain) → 415", (await bff("carrito", { method: "POST", headers: { ...jsonH(), "content-type": "text/plain" }, body: "a=b" })).status === 415);
  // Lista cerrada: lo que no está, no existe (aunque exista en la API).
  for (const r of ["pagos/registrar", "interno/vencer", "pagos/mercadopago/aviso", "../v1/pagos/registrar", "%2e%2e/v1/config", "cuenta/../pagos/registrar", "productos"]) {
    const x = await bff(r, { method: "POST", headers: jsonH(), body: "{}" });
    chk(G, `BFF: /api/t/${r} no existe`, x.status === 404, String(x.status));
  }
  chk(G, "BFF: PUT/DELETE → 404", (await bff("cuenta", { method: "DELETE", headers: jsonH() })).status === 404);

  // Sesión: cookie httpOnly/SameSite y el token no llega al JavaScript.
  const correo = `audit-${Date.now()}@test.com`;
  const reg = await bff("cuenta/registro", { method: "POST", headers: jsonH(), body: JSON.stringify({ email: correo, contrasena: "clave-de-auditoria-1", nombre: "Audit", apellido: "Hack" }) });
  const cookie = reg.headers.get("set-cookie") ?? "";
  chk(G, "registro por la tienda: cookie de sesión HttpOnly + SameSite=Lax", reg.status === 201 && /HttpOnly/i.test(cookie) && /SameSite=Lax/i.test(cookie), `${reg.status} ${cookie.slice(0, 60)}`);
  chk(G, "el token de sesión no viaja en el cuerpo", !("token" in (await reg.json().catch(() => ({})))));
  const galleta = cookie.split(";")[0];
  chk(G, "con la cookie se ve la cuenta; con una inventada, no", (await bff("cuenta", { headers: { cookie: galleta } })).status === 200
    && (await bff("cuenta", { headers: { cookie: `${galleta.split("=")[0]}=${"x".repeat(43)}` } })).status === 401);

  // Fuerza bruta de ingreso: el freno por email corta.
  let frenado = false;
  for (let i = 0; i < 20 && !frenado; i++) {
    const r = await pedir(`${API}/v1/cuenta/ingresar`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: correo, contrasena: `mala-${i}` }) });
    if (r.status === 429) frenado = true;
  }
  chk(G, "20 contraseñas equivocadas seguidas → 429", frenado);

  // Pedidos ajenos (IDOR): sin sesión ni enlace, ningún número existe.
  let ajenos = 0;
  for (const n of ["ISU-1001", "ISU-1002", "ISU-1050"]) if ((await bff(`pedidos/${n}`)).status !== 404) ajenos++;
  chk(G, "no se puede espiar un pedido ajeno por número", ajenos === 0);
  chk(G, "ni con un acceso inventado", (await bff("pedidos/ISU-1001", { headers: { "x-isu-acceso": "a".repeat(32) } })).status === 404);

  // Precio y cantidades: los pone la tienda.
  const car = (items) => pedir(`${API}/v1/carrito`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items }) });
  chk(G, "un precio mandado por el cliente → 400", (await car([{ sku: "X", cantidad: 1, precio: 1 }])).status === 400);
  for (const cantidad of [-1, 0, 1.5, 1e9, "1"]) chk(G, `cantidad ${JSON.stringify(cantidad)} → 400`, (await car([{ sku: "X", cantidad }])).status === 400);
  chk(G, "carrito de 31 líneas → 400", (await car(Array.from({ length: 31 }, (_, i) => ({ sku: `S${i}`, cantidad: 1 })))).status === 400);

  // Pagos: registrar exige su credencial; el aviso de Mercado Pago exige firma; lo interno no existe afuera.
  const reg2 = (auth) => pedir(`${API}/v1/pagos/registrar`, { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify({ pedido: "ISU-1001", medio: "transferencia", monto: 1, referencia: "HACK-1", quien: "hacker" }) });
  chk(G, "registrar pago sin credencial → 401", (await reg2()).status === 401);
  chk(G, "registrar pago con credencial inventada → 401", (await reg2(`Bearer ${"x".repeat(40)}`)).status === 401);
  if (process.env.INTERNO_TOKEN) chk(G, "registrar pago con la credencial INTERNA (otra) → 401", (await reg2(`Bearer ${process.env.INTERNO_TOKEN}`)).status === 401);
  const aviso = await pedir(`${API}/v1/pagos/mercadopago/aviso?type=payment&data.id=123456`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "payment", data: { id: "123456" } }) });
  chk(G, "aviso de Mercado Pago sin firma → 401 (o 503 si MP no está configurado)", [401, 503].includes(aviso.status), String(aviso.status));
  const falsa = await pedir(`${API}/v1/pagos/mercadopago/aviso?type=payment&data.id=123456`, { method: "POST", headers: { "content-type": "application/json", "x-signature": `ts=${Math.floor(Date.now() / 1000)},v1=${"0".repeat(64)}`, "x-request-id": "x" }, body: "{}" });
  chk(G, "aviso con firma falsa → 401", [401, 503].includes(falsa.status), String(falsa.status));
  for (const r of ["/v1/interno/vencer", "/v1/interno/conciliar-mp"]) {
    chk(G, `${r} sin credencial interna → 404`, (await pedir(API + r, { method: "POST" })).status === 404);
    chk(G, `${r} con x-isu-interno inventado → 404`, (await pedir(API + r, { method: "POST", headers: { "x-isu-interno": "x".repeat(40) } })).status === 404);
  }
  // Comprobantes: sólo imagen/PDF; el tipo se mira en el contenido.
  chk(G, "comprobante SVG por la tienda → 415", (await bff("pedidos/ISU-1001/comprobante", { method: "POST", headers: { origin: ORIGEN, "x-isu": "1", "content-type": "image/svg+xml" }, body: "<svg/>" })).status === 415);
  chk(G, "comprobante de 7 MB → 413", (await bff("pedidos/ISU-1001/comprobante", { method: "POST", headers: { origin: ORIGEN, "x-isu": "1", "content-type": "application/pdf" }, body: Buffer.alloc(7 * 1024 * 1024) })).status === 413);
  // Arrepentimiento: no sirve para mandarle mails a cualquiera ni para ver si un pedido existe.
  const arr = await pedir(`${API}/v1/arrepentimiento`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ numero: "ISU-1001", email: "victima@test.com", nombre: "Nadie" }) });
  const arrJ = await arr.json().catch(() => ({}));
  chk(G, "arrepentimiento con email ajeno: código genérico, sin cancelar nada", arr.status === 201 && !/cancelad/.test(arrJ.mensaje ?? ""), `${arr.status}`);
}

// ── 7b. Etapa 3: backoffice, guías de talles, outfits, mayorista ─────
{
  const G = "backoffice";
  const tokenFalso = "a".repeat(43);
  const rutas = [
    ["GET", "resumen"], ["GET", "pedidos"], ["GET", "pedidos/ISU-1001"], ["GET", "productos"], ["GET", "productos/1"], ["GET", "ajustes"],
    ["GET", "usuarios"], ["GET", "auditoria"], ["GET", "guias-talles"], ["GET", "clientes"], ["GET", "pedidos/ISU-1001/comprobantes/1"],
    ["PATCH", "productos/1"], ["POST", "productos/masivo"], ["PUT", "ajustes"], ["POST", "usuarios"], ["POST", "guias-talles"],
    ["DELETE", "fotos/1"], ["POST", "pedidos/ISU-1001/pago"], ["POST", "clientes/sincronizar"], ["POST", "sincronizar-catalogo"],
  ];
  let abiertas = 0, conFalso = 0;
  for (const [m, r] of rutas) {
    const cuerpo = m === "GET" || m === "DELETE" ? undefined : "{}";
    const a = await pedir(`${API}/v1/admin/${r}`, { method: m, headers: cuerpo ? { "content-type": "application/json" } : {}, body: cuerpo });
    if (![400, 401].includes(a.status) || (a.status === 400 && m === "GET")) abiertas++;
    const b = await pedir(`${API}/v1/admin/${r}`, { method: m, headers: { "x-isu-admin": tokenFalso, ...(cuerpo ? { "content-type": "application/json" } : {}) }, body: cuerpo });
    if (b.status !== 401 && b.status !== 400) conFalso++;
  }
  chk(G, `API: ${rutas.length} rutas del backoffice sin sesión → 401`, abiertas === 0, String(abiertas));
  chk(G, "API: con un token de sesión inventado → 401", conFalso === 0, String(conFalso));
  chk(G, "API: una foto sin sesión no se procesa (401 antes de leerla)", (await pedir(`${API}/v1/admin/productos/1/fotos?tipo=exhibicion`, { method: "POST", headers: { "content-type": "image/jpeg" }, body: Buffer.alloc(1024) })).status === 401);
  chk(G, "API: 2FA sin el primer paso → 401", (await pedir(`${API}/v1/admin/2fa`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ codigo: "123456" }) })).status === 401);
  chk(G, "API: configurar 2FA sin el primer paso → 401", (await pedir(`${API}/v1/admin/2fa/configurar`, { method: "POST" })).status === 401);

  // Fuerza bruta: el freno por email corta antes de la décima.
  let frenado = false;
  const victima = `nadie-${Date.now()}@isuwaya.test`;
  for (let i = 0; i < 12 && !frenado; i++) {
    const r = await pedir(`${API}/v1/admin/ingresar`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: victima, contrasena: `mala-${i}` }) });
    if (r.status === 429) frenado = true;
  }
  chk(G, "API: 12 contraseñas de backoffice equivocadas → 429", frenado);

  // BFF del backoffice (/api/a): mismo origen, sin atajos de ruta.
  const A = (ruta, o = {}) => pedir(`${ADMIN}/api/a/${ruta}`, o);
  chk(G, "BFF: sin cookie, /yo → 204 y /usuarios → 401", (await A("yo")).status === 204 && (await A("usuarios")).status === 401);
  for (const ruta of ["..%2F..%2Fv1%2Fconfig", "%2e%2e/%2e%2e/readyz", "productos%2F1", "a/b/c/d/e/f/g", "productos/1;DROP"]) {
    const r = await A(ruta);
    chk(G, `BFF: ruta rara "${ruta}" → 404/401 sin salir de /v1/admin`, [401, 404].includes(r.status), String(r.status));
  }
  const ingresar = (headers) => A("ingresar", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ email: "x@x.com", contrasena: "x" }) });
  chk(G, "BFF: POST sin Origin → 403", (await ingresar({ "x-isu": "1" })).status === 403);
  chk(G, "BFF: POST desde otro sitio → 403", (await ingresar({ "x-isu": "1", origin: "https://evil.example" })).status === 403);
  chk(G, "BFF: POST sin x-isu → 403", (await ingresar({ origin: ADMIN })).status === 403);
  const mal = await ingresar({ "x-isu": "1", origin: ADMIN });
  chk(G, "BFF: ingreso fallido no deja cookie", [401, 429].includes(mal.status) && !mal.headers.get("set-cookie"), String(mal.status));
  chk(G, "BFF: JSON de 300 KB → 413", (await A("productos/1", { method: "PATCH", headers: { origin: ADMIN, "x-isu": "1", "content-type": "application/json" }, body: JSON.stringify({ descripcion: "a".repeat(300_000) }) })).status === 413);
  chk(G, "BFF: foto SVG → 415", (await A("productos/1/fotos", { method: "POST", headers: { origin: ADMIN, "x-isu": "1", "content-type": "image/svg+xml" }, body: "<svg/>" })).status === 415);
  chk(G, "BFF: PUT/DELETE en rutas de la tienda siguen cerrados", (await pedir(`${WEB}/api/t/cuenta`, { method: "DELETE" })).status === 404);

  // Mayorista: el destino lo fija la variable, no el visitante (sin redirección abierta).
  const may = await pedir(`${WEB}/mayorista?url=https://evil.example&next=//evil.example`);
  const destino = may.headers.get("location") ?? "";
  chk("tienda", "/mayorista redirige (302) y no a donde diga la URL", may.status === 302 && /^https?:\/\//.test(destino) && !destino.includes("evil"), destino);

  // Outfits: entrada validada (no hay forma de pedirle trabajo ilimitado).
  const out = (b) => pedir(`${API}/v1/outfits`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
  const base = { para: "mujer", talle: "M", presupuesto: 5_000_000 };
  chk("tienda", "outfits: pedido válido → 200", (await out(base)).status === 200);
  for (const [nombre, b] of [
    ["para inventado", { ...base, para: "admin" }], ["presupuesto negativo", { ...base, presupuesto: -1 }],
    ["parte inventada", { ...base, partes: ["zapatos"] }], ["medida inventada", { ...base, medidas: { __proto__x: 1, peso: 80 } }],
    ["medida absurda", { ...base, medidas: { pecho: 1e9 } }], ["10.000 excluidos", { ...base, reemplazar: { parte: "arriba", fijos: [], excluir: Array.from({ length: 10_000 }, (_, i) => i + 1) } }],
    ["campo extra", { ...base, precio: 1 }], ["sin talle ni medidas", { para: "mujer", presupuesto: 5_000_000 }],
  ]) chk("tienda", `outfits: ${nombre} → 400`, (await out(b)).status === 400);
  chk("tienda", "outfits: la respuesta no se cachea", /no-store/.test((await out(base)).headers.get("cache-control") ?? ""));
}

// ── 8. Límite de pedidos (no se esquiva falsificando la IP) ───────────
let bloqueado = false;
for (let i = 0; i < 400 && !bloqueado; i++) {
  const r = await pedir(`${API}/v1/config`, { headers: { "x-forwarded-for": `9.9.${i % 250}.${i % 7}` } });
  if (r.status === 429) bloqueado = true;
}
chk("límite", "ráfaga con X-Forwarded-For inventado termina en 429", bloqueado);
bloqueado = false;
for (let i = 0; i < 400 && !bloqueado; i++) {
  const r = await pedir(`${API}/v1/config`, { headers: { "x-isu-interno": `falso-${"x".repeat(40)}-${i}` } });
  if (r.status === 429) bloqueado = true;
}
chk("límite", "una credencial interna falsa no exime del límite", bloqueado);

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
