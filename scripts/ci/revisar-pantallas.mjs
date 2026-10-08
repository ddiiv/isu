/*
 * pnpm revisar:pantallas [tienda|admin|todo]   (etapa 12)
 *
 * Revisión pantalla por pantalla de la tienda y el backoffice, en compu y en
 * celular, con los servicios levantados y los datos de muestra
 * (scripts/ci/levantar-e2e.sh). Por cada pantalla busca:
 *   · errores de JavaScript y de consola, y pedidos que fallan;
 *   · algo que se sale de costado (desborde horizontal);
 *   · imágenes rotas y textos «undefined», «NaN» o «[object Object]»;
 *   · botones y links sin nombre, y campos sin etiqueta;
 *   · que haya un solo h1 y un título;
 *   · links internos que dan error.
 * Guarda una captura de cada una y la lista de hallazgos en
 * registros/revision/ (o REVISION_DIR). Termina con error si encontró algo.
 *
 * Direcciones: WEB_URL, ADMIN_URL y API_URL (por defecto, las de local).
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const RAIZ = process.env.RAIZ ?? process.cwd();
const require = createRequire(path.join(RAIZ, "package.json"));
const { chromium, devices } = require("@playwright/test");
const QUE = process.argv[2] ?? "todo";
const OUT = process.env.REVISION_DIR ?? path.join(RAIZ, "registros", "revision");
mkdirSync(OUT, { recursive: true });
const W = process.env.WEB_URL ?? "http://localhost:3000", A = process.env.ADMIN_URL ?? "http://localhost:3001", API = process.env.API_URL ?? "http://127.0.0.1:4000";
const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const hallazgos = [];
const internos = new Map(); // href → pantalla donde aparece
const nota = (pantalla, tipo, detalle) => hallazgos.push({ pantalla, tipo, detalle: String(detalle).slice(0, 300) });

async function revisar(p, url, nombre, { esperado404 = false, antes, despues, permitir = [] } = {}) {
  const errores = [];
  const onErr = (e) => errores.push(["js", e.message]);
  // (los pedidos que fallan ya los cuenta onResp, que sabe cuáles se esperan)
  const onCons = (m) => { if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) errores.push(["consola", m.text()]); };
  const onResp = (r) => {
    const u = r.url();
    if (r.status() >= 400 && !u.includes("/_next/") && !(esperado404 && r.status() === 404 && r.request().resourceType() === "document") && !permitir.some((x) => x.test(u))) errores.push(["http", `${r.status()} ${r.request().method()} ${u}`]);
  };
  const onFail = (r) => { const f = r.failure()?.errorText ?? ""; if (!/ERR_ABORTED|NS_BINDING_ABORTED/.test(f)) errores.push(["red", `${f} ${r.url()}`]); };
  p.on("pageerror", onErr); p.on("console", onCons); p.on("response", onResp); p.on("requestfailed", onFail);
  try {
    const r = await p.goto(url, { waitUntil: "load", timeout: 45_000 });
    if (!esperado404 && r && r.status() >= 400) errores.push(["http", `${r.status()} documento`]);
    await p.waitForSelector("html[data-hidratado]", { state: "attached", timeout: 15_000 }).catch(() => {});
    if (antes) await antes(p);
    await p.waitForTimeout(1200);
    const info = await p.evaluate(() => {
      const d = document.documentElement;
      const anchoDe = (el) => el.getBoundingClientRect();
      const desborda = [];
      if (d.scrollWidth > window.innerWidth + 1) {
        for (const el of document.querySelectorAll("body *")) {
          const r = anchoDe(el);
          if (r.right > window.innerWidth + 1 && r.width > 0 && getComputedStyle(el).position !== "fixed") {
            let x = el, oculto = false;
            while ((x = x.parentElement)) { const o = getComputedStyle(x).overflowX; if (o === "hidden" || o === "auto" || o === "scroll" || o === "clip") { oculto = true; break; } }
            if (!oculto) desborda.push(`${el.tagName.toLowerCase()}.${(el.className?.toString?.() ?? "").split(" ").slice(0, 3).join(".")} →${Math.round(r.right)}`);
          }
        }
      }
      const rotas = [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.getAttribute("src")).map((i) => i.currentSrc || i.src);
      const texto = document.body.innerText;
      const raros = [...texto.matchAll(/(^|[\s(:$])(undefined|NaN|\[object Object\]|null)(?=[\s).,]|$)/g)].map((m) => m[2]);
      const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
      const sinNombre = [...document.querySelectorAll("button, a[href], [role=button]")].filter(visible).filter((el) => {
        // textContent también: lo que está dentro de un acordeón cerrado no tiene innerText, pero sí nombre.
        const n = (el.getAttribute("aria-label") || el.getAttribute("title") || el.innerText || el.textContent || el.querySelector("img[alt]")?.getAttribute("alt") || "").trim();
        const lb = el.getAttribute("aria-labelledby");
        return !n && !lb;
      }).map((el) => el.outerHTML.slice(0, 140));
      const campos = [...document.querySelectorAll("input:not([type=hidden]), select, textarea")].filter(visible).filter((el) => {
        if (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.closest("label")) return false;
        return !(el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`));
      }).map((el) => el.outerHTML.slice(0, 140));
      const hrefs = [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")).filter((h) => h && h.startsWith("/") && !h.startsWith("//"));
      const h1 = document.querySelectorAll("h1").length;
      return { desborda: desborda.slice(0, 5), rotas, raros, sinNombre: sinNombre.slice(0, 5), campos: campos.slice(0, 5), hrefs, h1, titulo: document.title };
    });
    for (const [t, d] of errores) nota(nombre, t, d);
    if (info.desborda.length) nota(nombre, "desborde", info.desborda.join(" | "));
    for (const x of info.rotas) nota(nombre, "imagen rota", x);
    if (info.raros.length) nota(nombre, "texto raro", info.raros.join(","));
    for (const x of info.sinNombre) nota(nombre, "sin nombre", x);
    for (const x of info.campos) nota(nombre, "campo sin etiqueta", x);
    if (info.h1 !== 1) nota(nombre, "h1", `${info.h1} h1`);
    if (!info.titulo) nota(nombre, "título", "sin <title>");
    for (const h of info.hrefs) if (!internos.has(h)) internos.set(h, nombre);
    if (despues) await despues(p, (t, d) => nota(nombre, t, d));
    await p.screenshot({ path: `${OUT}/${nombre.replace(/[^a-z0-9-]+/gi, "_")}.png`, fullPage: true }).catch(() => {});
  } catch (e) {
    nota(nombre, "falla", e.message.split("\n")[0]);
  } finally {
    p.off("pageerror", onErr); p.off("console", onCons); p.off("response", onResp); p.off("requestfailed", onFail);
  }
}

const get = async (u) => (await fetch(API + u)).json();
const config = await get("/v1/config");
const cats = await get("/v1/categorias");
const mujer = (await get("/v1/productos?categoria=mujer")).productos.map((x) => x.slug);
const hombre = (await get("/v1/productos?categoria=hombre")).productos.map((x) => x.slug);
const ninos = (await get("/v1/productos?categoria=ninos")).productos.map((x) => x.slug);
const productos = [...new Set([...hombre, ...mujer, ...ninos])];

const PAGINAS = [
  ["/", "inicio"],
  ...cats.flatMap((c) => [[`/${c.slug}`, `cat-${c.slug}`], ...c.hijas.slice(0, 2).map((h) => [`/${c.slug}/${h.slug}`, `sub-${c.slug}-${h.slug}`])]),
  ...productos.slice(0, 6).map((s) => [`/producto/${s}`, `ficha-${s}`]),
  ["/producto/pack-x3-remera-basica-cuello-redondo", "pack-x3"],
  ["/packs", "packs"], ...config.packsEn.map((c) => [`/packs/${c}`, `packs-${c}`]),
  ["/liquidacion", "liquidacion"], ...config.liquidacionEn.map((c) => [`/liquidacion/${c}`, `liquidacion-${c}`]),
  ["/nuevos", "nuevos"], ["/destacados", "destacados"], ["/outfits", "outfits"],
  ["/buscar?q=remera", "buscar"], ["/buscar?q=zzzzqq", "buscar-vacio"],
  ["/carrito", "carrito-vacio"], ["/checkout", "checkout-vacio"],
  ["/cuenta", "cuenta"], ["/cuenta/restablecer?t=" + "x".repeat(40), "restablecer"],
  ["/arrepentimiento", "arrepentimiento"], ["/locales", "locales"],
  ["/terminos", "terminos"], ["/privacidad", "privacidad"], ["/devoluciones", "devoluciones"],
  ["/pedido/ISU-999999", "pedido-ajeno"], ["/seguimiento/ISU-999999?t=" + "x".repeat(24), "seguimiento-malo"], ["/opinar/ISU-999999?t=" + "A".repeat(24), "opinar-malo"],
];

async function tienda(ctx, sufijo) {
  const p = await ctx.newPage();
  for (const [ruta, nombre] of PAGINAS) {
    const permitir = nombre === "cuenta" ? [/\/api\/t\/cuenta$/] : nombre.startsWith("pedido") || nombre.startsWith("seguimiento") || nombre.startsWith("opinar") ? [/\/api\/t\/(pedidos|seguimiento|opinar)\//] : [];
    await revisar(p, W + ruta, `${sufijo}-${nombre}`, { permitir });
  }
  await revisar(p, `${W}/no-existe-esta-pagina`, `${sufijo}-404`, { esperado404: true });
  // Con algo en el carrito: el cajón, la página del carrito y el checkout.
  await revisar(p, `${W}/producto/${hombre[0]}`, `${sufijo}-ficha-agregar`, {
    despues: async (pg, n) => {
      const t = pg.locator("fieldset", { hasText: "Talle" }).getByRole("button", { disabled: false }).first();
      if (await t.count()) await t.click();
      await pg.getByRole("button", { name: "Agregar al carrito" }).click();
      await pg.getByRole("dialog").waitFor({ timeout: 8000 }).catch(() => n("falla", "no abrió el carrito"));
      await pg.waitForTimeout(1500);
      await pg.screenshot({ path: `${OUT}/${sufijo}-cajon.png` });
    },
  });
  await revisar(p, `${W}/carrito`, `${sufijo}-carrito`);
  await revisar(p, `${W}/checkout`, `${sufijo}-checkout`, {
    despues: async (pg) => { await pg.getByText("Retiro en el local").click().catch(() => {}); await pg.waitForTimeout(800); await pg.screenshot({ path: `${OUT}/${sufijo}-checkout-retiro.png`, fullPage: true }); },
  });
  // Menú del celular y el asistente.
  if (sufijo === "c") {
    await revisar(p, `${W}/`, `${sufijo}-menu`, {
      despues: async (pg, n) => {
        await pg.getByRole("button", { name: /Menú|Abrir menú/ }).first().click().catch((e) => n("falla", `menú: ${e.message.split("\n")[0]}`));
        await pg.waitForTimeout(600); await pg.screenshot({ path: `${OUT}/c-menu-abierto.png` });
      },
    });
  }
  await revisar(p, `${W}/`, `${sufijo}-asistente`, {
    despues: async (pg, n) => {
      await pg.getByRole("button", { name: /asistente|ayuda|chat/i }).last().click().catch((e) => n("falla", `asistente: ${e.message.split("\n")[0]}`));
      await pg.waitForTimeout(800); await pg.screenshot({ path: `${OUT}/${sufijo}-asistente-abierto.png` });
    },
  });
  await p.close();
}

async function sesionAdmin() {
  const { codigo } = await import(pathToFileURL(path.join(RAIZ, "apps/api/dist/lib/totp.js")).href);
  const EMAIL = `e2e-revision-${Date.now()}@isuwaya.test`;
  const clave = /provisoria: (\S+)/.exec(spawnSync("node", ["--env-file-if-exists=.env", "apps/api/dist/cli/crear-admin.js", EMAIL, "Revisión"], { cwd: RAIZ, encoding: "utf8" }).stderr)[1];
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  const ad = await ctx.newPage();
  await ad.goto(`${A}/`);
  await ad.getByLabel("Email").fill(EMAIL); await ad.getByLabel("Contraseña").fill(clave); await ad.getByRole("button", { name: "Continuar" }).click();
  await ad.getByText("No puedo escanear").click();
  const secreto = (await ad.locator("code").innerText()).replace(/\s/g, "");
  await ad.getByLabel("Código de 6 números").fill(codigo(secreto, Math.floor(Date.now() / 30_000)));
  await ad.getByRole("button", { name: "Ingresar" }).click();
  await ad.getByLabel("Contraseña provisoria").fill(clave);
  await ad.getByRole("textbox", { name: /^Contraseña nueva/ }).fill("frase larga para la revisión de pantallas");
  await ad.getByLabel("Repetí la contraseña nueva").fill("frase larga para la revisión de pantallas");
  await ad.getByRole("button", { name: "Guardar" }).click();
  await ad.getByText("Para atender").waitFor();
  await ad.close();
  return ctx;
}

async function admin(ctx, sufijo) {
  const p = await ctx.newPage();
  const RUTAS = ["/", "/pedidos", "/envios", "/transferencias", "/productos", "/categorias", "/guias-talles", "/descuentos", "/cupones", "/resenas", "/portada", "/clientes", "/asistente", "/redirecciones", "/ajustes", "/usuarios", "/auditoria"];
  for (const r of RUTAS) await revisar(p, A + r, `${sufijo}-adm${r.replace(/\//g, "-") || "-panel"}`);
  // Portada: el editor de un banner, con la vista previa (etapa 12).
  await revisar(p, `${A}/portada`, `${sufijo}-adm-portada-editor`, {
    antes: async (pg) => { await pg.getByRole("button", { name: "Editar" }).first().click().catch(() => {}); await pg.waitForTimeout(1500); },
  });
  // Detalles: el primer producto, la primera guía y el primer pedido.
  await p.goto(`${A}/productos`); await p.waitForTimeout(1500);
  const prod = await p.locator('a[href^="/productos/"]').first().getAttribute("href").catch(() => null);
  if (prod) await revisar(p, A + prod, `${sufijo}-adm-producto`);
  await p.goto(`${A}/guias-talles`); await p.waitForTimeout(1500);
  const guia = await p.locator('a[href^="/guias-talles/"]').first().getAttribute("href").catch(() => null);
  if (guia) await revisar(p, A + guia, `${sufijo}-adm-guia`);
  await p.goto(`${A}/pedidos`); await p.waitForTimeout(1500);
  const ped = await p.locator('a[href^="/pedidos/ISU"]').first().getAttribute("href").catch(() => null);
  if (ped) await revisar(p, A + ped, `${sufijo}-adm-pedido`);
  await p.close();
}

if (QUE !== "admin") {
  await tienda(await b.newContext({ viewport: { width: 1440, height: 900 } }), "d");
  await tienda(await b.newContext({ ...devices["Pixel 7"] }), "c");
  // Links internos rotos (de todas las pantallas de la tienda).
  for (const [h, donde] of internos) {
    if (/^\/(api|_next)\//.test(h) || h.startsWith("/#")) continue;
    const r = await fetch(W + h.split("#")[0], { redirect: "manual" }).catch(() => null);
    if (!r || r.status >= 400) nota(donde, "link roto", `${h} → ${r?.status ?? "sin respuesta"}`);
  }
}
if (QUE !== "tienda") {
  const ctx = await sesionAdmin();
  await admin(ctx, "d");
  const cel = await b.newContext({ ...devices["Pixel 7"], storageState: await ctx.storageState() });
  await admin(cel, "c");
}
writeFileSync(path.join(OUT, "hallazgos.json"), JSON.stringify(hallazgos, null, 1));
const porTipo = {};
for (const h of hallazgos) (porTipo[h.tipo] ??= []).push(`${h.pantalla}: ${h.detalle}`);
const salida = [];
for (const [t, l] of Object.entries(porTipo)) { salida.push(`\n## ${t} (${l.length})`); for (const x of [...new Set(l)].slice(0, 40)) salida.push(` · ${x}`); }
salida.push(`\n${hallazgos.length ? `${hallazgos.length} hallazgos` : "Todo bien: ninguna pantalla con errores"} · capturas en ${OUT}`);
process.stdout.write(`${salida.join("\n")}\n`);
await b.close();
process.exit(hallazgos.length ? 1 : 0);
