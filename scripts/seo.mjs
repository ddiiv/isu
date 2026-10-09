/*
 * Chequeo de SEO de la tienda, desde afuera (como la ve Google):
 *
 *   pnpm seo https://www.isuwaya.com
 *   pnpm seo https://www.isuwaya.com --viejas https://tienda-anterior.com   (o un archivo con una dirección por línea)
 *
 * Revisa robots.txt, el sitemap, una muestra de páginas (título,
 * descripción, canónica, noindex, h1, datos estructurados, fotos sin texto
 * alternativo), el feed de Google Shopping y, con --viejas, que cada
 * dirección de la tienda anterior redirija con 301 a una página que existe.
 * No cambia nada.
 */
import { readFileSync, existsSync } from "node:fs";

const args = process.argv.slice(2);
const tienda = args.find((a) => /^https?:\/\//.test(a) && args[args.indexOf(a) - 1] !== "--viejas")?.replace(/\/+$/, "");
const viejas = args.includes("--viejas") ? args[args.indexOf("--viejas") + 1] : null;
if (!tienda) {
  console.error("Uso: pnpm seo https://www.tu-tienda.com.ar [--viejas https://tienda-anterior.com | archivo.txt]");
  process.exit(2);
}
const MUESTRA = 25;
const decir = (t) => process.stdout.write(`${t}\n`);
const resultados = [];
const bien = (t) => { resultados.push(true); decir(`  ✓ ${t}`); };
const mal = (t, qué) => { resultados.push(false); decir(`  ✗ ${t}${qué ? `\n      → ${qué.replace(/\n/g, "\n        ")}` : ""}`); };
const ojo = (t, qué) => decir(`  ! ${t}${qué ? `\n      → ${qué.replace(/\n/g, "\n        ")}` : ""}`);
const pedir = async (url, o = {}) => {
  try {
    const r = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(20_000), headers: { "user-agent": "Mozilla/5.0 (compatible; isu-seo/1.0; +chequeo)" }, ...o });
    return { r, texto: o.method === "HEAD" ? "" : await r.text() };
  } catch (e) {
    return { r: null, texto: "", error: e.name === "TimeoutError" ? "no contestó en 20 s" : e.cause?.code ?? e.message };
  }
};
const host = new URL(tienda).host;
const entidades = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;|&#39;|&apos;/g, "'");
const meta = (html, nombre) => {
  for (const [etiqueta] of html.matchAll(/<meta\s[^>]*>/gi)) {
    const attr = Object.fromEntries([...etiqueta.matchAll(/([a-z:-]+)="([^"]*)"/gi)].map((m) => [m[1].toLowerCase(), m[2]]));
    if (attr.name === nombre || attr.property === nombre) return entidades(attr.content ?? "") || null;
  }
  return null;
};

// ── robots.txt ──
decir(`\nTienda: ${tienda}\n\nrobots.txt y sitemap`);
const robots = await pedir(`${tienda}/robots.txt`);
if (robots.r?.status !== 200) mal(`robots.txt responde ${robots.r?.status ?? robots.error}`, "Google lo pide antes que nada: tiene que dar 200.");
else {
  if (/^\s*disallow:\s*\/\s*$/im.test(robots.texto)) mal("robots.txt bloquea TODO el sitio (Disallow: /)", "¿Es un entorno de prueba? En producción la tienda tiene que poder indexarse.");
  else bien("robots.txt permite indexar");
  const sm = robots.texto.match(/^sitemap:\s*(\S+)/im)?.[1];
  if (!sm) mal("robots.txt no declara el sitemap");
  else if (new URL(sm).host !== host) mal(`robots.txt apunta el sitemap a otro dominio (${sm})`, "NEXT_PUBLIC_SITE_URL del servicio web tiene que ser este dominio. Redeploy después de cambiarla.");
  else bien(`sitemap declarado: ${sm}`);
}

// ── sitemap ──
const sitemap = await pedir(`${tienda}/sitemap.xml`);
let urls = [];
if (sitemap.r?.status !== 200) mal(`sitemap.xml responde ${sitemap.r?.status ?? sitemap.error}`);
else {
  urls = [...sitemap.texto.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => entidades(m[1]));
  const fotos = (sitemap.texto.match(/<image:loc>/g) ?? []).length;
  const ajenas = urls.filter((u) => new URL(u).host !== host);
  const productos = urls.filter((u) => u.includes("/producto/"));
  if (ajenas.length) mal(`${ajenas.length} direcciones del sitemap son de otro dominio (ej. ${ajenas[0]})`, "NEXT_PUBLIC_SITE_URL no coincide con el dominio real: Google las ignoraría.");
  else bien(`sitemap con ${urls.length} direcciones (${productos.length} productos, ${fotos} fotos)`);
  if (!productos.length) ojo("el sitemap no tiene productos", "¿La API está conectada y hay productos publicados? (pnpm diagnostico)");
}

// ── Muestra de páginas ──
decir("\nPáginas (muestra)");
// Las rutas del sitemap, pedidas a esta tienda (si el sitemap tiene otro dominio ya se avisó arriba).
const enTienda = (u) => { const x = new URL(u); return `${tienda}${x.pathname}${x.search}`; };
const elegidas = [...new Set([`${tienda}/`, ...urls.filter((u) => !u.includes("/producto/")).slice(0, 10).map(enTienda), ...urls.filter((u) => u.includes("/producto/")).slice(0, MUESTRA - 10).map(enTienda)])];
const titulos = new Map(), descripciones = new Map();
const problemas = { dominio: [], titulo: [], descripcion: [], canonica: [], noindex: [], h1: [], ld: [], alt: [], estado: [] };
let fichasConVariantes = 0, fichasConPrecio = 0, fichas = 0;
for (const u of elegidas) {
  const { r, texto: html, error } = await pedir(u);
  const ruta = new URL(u).pathname;
  if (!r || r.status !== 200) { problemas.estado.push(`${ruta} → ${r?.status ?? error}`); continue; }
  const titulo = entidades(html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() ?? "");
  const desc = meta(html, "description");
  const canon = html.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i)?.[1];
  if (!titulo || titulo.length < 10 || titulo.length > 70) problemas.titulo.push(`${ruta}: «${titulo}» (${titulo.length})`);
  if (!desc || desc.length < 50 || desc.length > 170) problemas.descripcion.push(`${ruta}: ${desc ? `${desc.length} caracteres` : "no tiene"}`);
  if (titulo) titulos.set(titulo, [...(titulos.get(titulo) ?? []), ruta]);
  if (desc) descripciones.set(desc, [...(descripciones.get(desc) ?? []), ruta]);
  if (!canon) problemas.canonica.push(`${ruta}: sin canónica`);
  else {
    const c = new URL(canon, u);
    if (c.host !== host) problemas.dominio.push(`${ruta}: canónica ${canon}`);
    else if (c.pathname.replace(/\/$/, "") !== ruta.replace(/\/$/, "")) problemas.canonica.push(`${ruta}: canónica ${canon}`);
  }
  if (/<meta[^>]+name="robots"[^>]+noindex/i.test(html)) problemas.noindex.push(ruta);
  const h1 = (html.match(/<h1[\s>]/gi) ?? []).length;
  if (h1 !== 1) problemas.h1.push(`${ruta}: ${h1} h1`);
  const sinAlt = (html.match(/<img(?![^>]*\balt=)[^>]*>/gi) ?? []).length;
  if (sinAlt) problemas.alt.push(`${ruta}: ${sinAlt}`);
  const bloques = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const datos = [];
  for (const b of bloques) { try { const d = JSON.parse(b); datos.push(...(Array.isArray(d) ? d : [d])); } catch { problemas.ld.push(`${ruta}: JSON-LD inválido`); } }
  if (ruta.startsWith("/producto/")) {
    fichas++;
    const prod = datos.find((d) => d["@type"] === "ProductGroup" || d["@type"] === "Product");
    if (!prod) problemas.ld.push(`${ruta}: sin datos de producto`);
    else {
      if (prod["@type"] === "ProductGroup" && prod.hasVariant?.length) fichasConVariantes++;
      const ofertas = prod.hasVariant ? prod.hasVariant.map((v) => v.offers) : [prod.offers];
      if (ofertas.every((o) => o?.price && o?.priceCurrency && o?.availability)) fichasConPrecio++;
      else problemas.ld.push(`${ruta}: variantes sin precio o disponibilidad`);
      if (!prod.image?.length) problemas.ld.push(`${ruta}: sin fotos en los datos (Google no la muestra en Shopping)`);
    }
    if (!datos.some((d) => d["@type"] === "BreadcrumbList")) problemas.ld.push(`${ruta}: sin migas de pan`);
  }
  if (ruta === "/" && !datos.some((d) => d["@type"] === "WebSite")) problemas.ld.push("/: sin WebSite (el nombre del sitio en Google)");
}
const informar = (lista, ok, titulo, qué, grave = true) => {
  if (!lista.length) return bien(ok);
  (grave ? mal : ojo)(`${titulo}: ${lista.length}`, `${lista.slice(0, 5).join("\n")}${lista.length > 5 ? `\n… y ${lista.length - 5} más` : ""}${qué ? `\n${qué}` : ""}`);
};
informar(problemas.estado, `las ${elegidas.length} páginas de la muestra cargan`, "páginas que no cargan (200)", "Mirá el log del servicio web.");
informar(problemas.noindex, "ninguna página de la muestra dice noindex", "páginas del sitemap con noindex", "Google no las va a indexar: no deberían estar en el sitemap.");
informar(problemas.dominio, "las canónicas son de este dominio", "canónicas con otro dominio", "NEXT_PUBLIC_SITE_URL del servicio web tiene que ser el dominio por el que se entra. Redeploy después de cambiarla.");
informar(problemas.canonica, "cada página tiene su canónica y apunta a sí misma", "canónicas que apuntan a otra dirección", "Si apunta a otro dominio, revisá NEXT_PUBLIC_SITE_URL.");
informar(problemas.titulo, "títulos de 10 a 70 caracteres", "títulos muy cortos o muy largos", "Google corta en ~60. Se editan en el backoffice (Productos y Categorías → Título para Google).", false);
informar(problemas.descripcion, "descripciones de 50 a 170 caracteres", "descripciones que faltan o se cortan", null, false);
const repetidos = [...titulos].filter(([, rs]) => rs.length > 1).map(([t, rs]) => `«${t}»: ${rs.join(", ")}`);
informar(repetidos, "ningún título repetido", "títulos repetidos", "Dos páginas con el mismo título compiten entre sí.", false);
const descRep = [...descripciones].filter(([, rs]) => rs.length > 1).map(([, rs]) => rs.join(", "));
informar(descRep, "ninguna descripción repetida", "descripciones repetidas", null, false);
informar(problemas.h1, "un solo h1 por página", "páginas sin h1 o con más de uno", null, false);
informar(problemas.alt, "todas las fotos tienen texto alternativo", "páginas con fotos sin texto alternativo", null, false);
informar(problemas.ld, "datos estructurados completos", "problemas en los datos estructurados", "Probalo en https://search.google.com/test/rich-results");
if (fichas) decir(`    (${fichas} fichas: ${fichasConVariantes} con variantes por talle/color, ${fichasConPrecio} con precio y stock en todas)`);

// ── La marca en Google (etapa 13): lo que se ve al buscar «Isuwaya» ──
decir("\nLa marca en Google (al buscar el nombre de la tienda)");
{
  const inicio = await pedir(`${tienda}/`);
  const html = inicio.texto;
  const titulo = entidades(html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() ?? "");
  const desc = meta(html, "description") ?? "";
  const marca = titulo.split(/\s[·|–—-]\s/)[0];
  if (titulo && desc.startsWith(marca)) bien(`inicio: «${titulo}»\n      ${desc}`);
  else ojo(`inicio: «${titulo}»`, `La descripción no arranca con la marca: ${desc || "no tiene"}`);
  const datos = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => { try { return [JSON.parse(m[1])].flat(); } catch { return []; } });
  const org = datos.find((d) => ["OnlineStore", "Organization", "ClothingStore"].includes(d["@type"]));
  if (org?.logo && org?.sameAs?.length) bien(`datos de la marca: logo, ${org.sameAs.length} red(es)${org.department?.url ? ", tienda mayorista" : ""}${org.contactPoint ? ", contacto" : ""}`);
  else mal("faltan los datos de la marca en el inicio (logo y redes)", "Google los usa para el panel de la marca.");
  // Los accesos: las categorías de arriba y las páginas fijas, enlazadas desde el inicio (el pie) y en el sitemap.
  const fijas = ["/nosotros", "/contacto", "/venta-por-mayor", "/locales"];
  const NO = new Set(["/nuevos", "/destacados", "/packs", "/outfits", "/liquidacion", "/devoluciones", "/terminos", "/privacidad", "/arrepentimiento", ...fijas]);
  const categorias = urls.map((u) => new URL(u).pathname).filter((r) => /^\/[a-z0-9-]+$/.test(r) && !NO.has(r));
  const accesos = [...new Set([...categorias.slice(0, 4), ...fijas])];
  const enlazadas = new Set([...html.matchAll(/href="(\/[^"#?]*)"/g)].map((m) => m[1]));
  const enSitemap = new Set(urls.map((u) => new URL(u).pathname));
  const faltan = [];
  for (const r of accesos) {
    const { r: res, texto } = await pedir(`${tienda}${r}`);
    const t = entidades(texto.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() ?? "");
    const d = meta(texto, "description");
    const problemas = [
      res?.status !== 200 ? `responde ${res?.status ?? "nada"}` : null,
      /<meta[^>]+name="robots"[^>]+noindex/i.test(texto) ? "noindex" : null,
      !d ? "sin descripción" : null,
      !enlazadas.has(r) ? "no está enlazada desde el inicio" : null,
      !enSitemap.has(r) ? "no está en el sitemap" : null,
    ].filter(Boolean);
    if (problemas.length) faltan.push(`${r}: ${problemas.join(", ")}`);
    else decir(`    ${r} · «${t}» — ${d}`);
  }
  if (faltan.length) mal(`accesos con problemas: ${faltan.length}`, faltan.join("\n"));
  else bien(`${accesos.length} páginas listas para aparecer como accesos debajo del resultado (las elige Google)`);
  // Venta por mayor: el botón lleva a la tienda mayorista.
  const vpm = await pedir(`${tienda}/venta-por-mayor`);
  const may = await pedir(`${tienda}/mayorista`);
  const destino = may.r?.headers.get("location") ?? "";
  if (/href="\/mayorista"/.test(vpm.texto) && may.r?.status === 302 && /^https?:\/\//.test(destino)) bien(`Venta por mayor: el botón lleva a la tienda mayorista (${destino})`);
  else mal("Venta por mayor: el botón no lleva a la tienda mayorista", `/mayorista respondió ${may.r?.status ?? may.error} ${destino}`);
}

// ── Feed de Google Shopping ──
decir("\nGoogle Shopping");
const feed = await pedir(`${tienda}/feed/google.xml`);
if (feed.r?.status !== 200) mal(`/feed/google.xml responde ${feed.r?.status ?? feed.error}`);
else {
  const items = (feed.texto.match(/<item>/g) ?? []).length;
  const grupos = new Set([...feed.texto.matchAll(/<g:item_group_id>([^<]+)</g)].map((m) => m[1])).size;
  const sinFoto = (feed.texto.match(/<item>(?:(?!<g:image_link>)[\s\S])*?<\/item>/g) ?? []).length;
  const ajenos = [...feed.texto.matchAll(/<link>([^<]+)<\/link>/g)].map((m) => entidades(m[1])).filter((l) => l.startsWith("http") && new URL(l).host !== host);
  if (!items) ojo("el feed no tiene productos", "¿Hay productos publicados con fotos?");
  else if (ajenos.length > 1) mal(`el feed apunta a otro dominio (${ajenos[1]})`, "Revisá NEXT_PUBLIC_SITE_URL.");
  else bien(`feed con ${items} variantes de ${grupos} productos${sinFoto ? ` (${sinFoto} sin foto)` : ""}`);
}

// ── Direcciones de la tienda anterior ──
if (viejas) {
  decir("\nDirecciones de la tienda anterior");
  let lista = [];
  if (/^https?:\/\//.test(viejas)) {
    const s = await pedir(`${viejas.replace(/\/+$/, "")}/sitemap.xml`);
    lista = [...s.texto.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => entidades(m[1]));
    if (!lista.length) mal(`no pude leer ${viejas}/sitemap.xml (${s.r?.status ?? s.error})`, "Si la tienda anterior ya no existe, pasá un archivo con una dirección por línea.");
  } else if (existsSync(viejas)) lista = readFileSync(viejas, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
  else mal(`no existe el archivo ${viejas}`);
  const rotas = [], buenas = [];
  for (const v of lista) {
    const { pathname, search } = new URL(v, "https://x.invalid");
    if (pathname === "/") continue;
    let url = `${tienda}${pathname}${search}`, saltos = 0;
    const primero = await pedir(url);
    const estado = primero.r?.status;
    if (estado === 200) { buenas.push(pathname); continue; } // existe igual en la tienda nueva
    if (estado !== 301 && estado !== 308) { rotas.push(`${pathname} → ${estado ?? primero.error}`); continue; }
    let r = primero.r;
    while (r && (r.status === 301 || r.status === 308) && saltos < 4) {
      url = new URL(r.headers.get("location"), url).href; saltos++;
      r = (await pedir(url)).r;
    }
    if (r?.status === 200 && new URL(url).host === host) buenas.push(pathname);
    else rotas.push(`${pathname} → ${url} (${r?.status ?? "sin respuesta"}${saltos > 1 ? `, ${saltos} saltos` : ""})`);
  }
  if (lista.length) informar(rotas, `las ${buenas.length} direcciones viejas llegan a una página de la tienda nueva`, "direcciones viejas que no llegan a una página",
    "Agregalas en el backoffice → Redirecciones, o corré `pnpm seo:tienda-anterior <tienda anterior> --aplicar` en la consola del worker.");
}

const fallas = resultados.filter((x) => !x).length;
decir(fallas ? `\n${fallas} problema${fallas === 1 ? "" : "s"} para revisar (arriba, con qué hacer).\n` : "\nTodo bien para Google.\n");
process.exitCode = fallas ? 1 : 0;
