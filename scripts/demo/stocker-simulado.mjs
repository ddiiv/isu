/*
 * Stocker simulado: las rutas que usa la tienda, con el catálogo de muestra.
 * Catálogo, stock y aviso con las formas del contrato v1 de Stocker
 * (skuAgrupador, precioMinorista, publicable, generadoEn, desconocidos y
 * NOTIFY stock_cambio '<negocio>:<variante>'). Los pedidos, todavía con las
 * formas anteriores (tanda 2).
 *
 *   GET  /api/integraciones/tienda/catalogo
 *   GET  /api/integraciones/tienda/stock?skus=A,B
 *   POST /api/integraciones/tienda/pedidos (+ /:n, /:n/pagado, /:n/cancelar) y PUT …/clientes
 *   POST /__vender   {"sku":"…","cantidad":1}   simula una venta en el local
 *                    (baja el stock y avisa por NOTIFY, como el Stocker real)
 *   GET  /           "Envíos del día" simulado: los pedidos pagados con su
 *                    transporte y seguimiento, con un botón Despachar que avisa
 *                    a la tienda por NOTIFY stocker_tienda_envios (etapa 4).
 *
 * Uso: STOCKER_TOKEN=… DATABASE_URL=… node scripts/demo/stocker-simulado.mjs
 *      (con DEMO_MAYORISTA=<catalogo.json> sirve el catálogo del sitio mayorista)
 */
import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import pg from "pg";
import { readFileSync } from "node:fs";
import { catalogoDemo, catalogoDesdeMayorista } from "./catalogo.mjs";

const PUERTO = Number(process.env.STOCKER_SIMULADO_PUERTO ?? 3900);
const TOKEN = process.env.STOCKER_TOKEN ?? "";
const NEGOCIO = 1;
if (TOKEN.length < 20) {
  console.error("Falta STOCKER_TOKEN (20+ caracteres), el mismo que usa el worker.");
  process.exit(2);
}
// DEMO_MAYORISTA=<archivo.json>: el catálogo del sitio mayorista en vez del de muestra.
const catalogo = process.env.DEMO_MAYORISTA ? catalogoDesdeMayorista(JSON.parse(readFileSync(process.env.DEMO_MAYORISTA, "utf8"))) : catalogoDemo();
const porSku = new Map(catalogo.flatMap((p) => p.variantes.map((v) => [v.sku, v])));
const pool = process.env.DATABASE_URL ? new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 }) : null;
const pedidos = new Map();
// Un aviso por variante, como el Stocker real (NOTIFY stock_cambio, '<negocio>:<variante>').
const avisar = async (skus) => {
  if (!pool) return;
  for (const sku of new Set(skus)) { const v = porSku.get(sku); if (v) await pool.query("SELECT pg_notify('stock_cambio', $1)", [`${NEGOCIO}:${v.id}`]); }
};
const leerJson = async (req) => { let b = ""; for await (const c of req) { b += c; if (b.length > 100_000) break; } try { return JSON.parse(b || "{}"); } catch { return {}; } };
const resumen = (p) => ({
  id: p.id, pedido: p.pedido, estado: p.estado, pagoPendiente: p.pagoPendiente, envioTipo: p.envio?.tipo ?? null, envioId: p.envio?.seguimiento ?? null,
  estadoEnvio: p.despachadoEn ? "despachado" : null, despachadoEn: p.despachadoEn ?? null, canceladoEn: p.canceladoEn ?? null, motivo: p.motivo ?? null,
});
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const local = (req) => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "");

const autorizado = (req) => {
  const h = String(req.headers.authorization ?? "");
  const a = Buffer.from(h), b = Buffer.from(`Bearer ${TOKEN}`);
  return a.length === b.length && timingSafeEqual(a, b);
};
const json = (res, status, cuerpo) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(cuerpo));
};

http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === "/__vender" && req.method === "POST") {
    // Sólo desde la misma máquina.
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "")) return json(res, 403, {});
    let cuerpo = "";
    for await (const c of req) { cuerpo += c; if (cuerpo.length > 1000) return json(res, 413, {}); }
    const { sku, cantidad = 1 } = JSON.parse(cuerpo || "{}");
    const v = porSku.get(sku);
    if (!v) return json(res, 404, { message: "SKU inexistente" });
    v.cantidad = Math.max(0, v.cantidad - Number(cantidad));
    await avisar([sku]);
    return json(res, 200, { sku, cantidad: v.cantidad });
  }
  // ── Envíos del día (simulado, sólo desde la misma máquina) ──
  if (url.pathname === "/" && req.method === "GET" && local(req)) {
    const filas = [...pedidos.values()].filter((p) => p.estado === "aceptado").reverse().map((p) => `<tr><td>${esc(p.pedido)}</td><td>${p.pagoPendiente ? "sin pagar" : "pagado"}</td><td>${esc(p.envio?.tipo ?? "—")}</td><td><code>${esc(p.envio?.seguimiento ?? "")}</code></td><td>${p.despachadoEn ? `despachado ${esc(p.despachadoEn.slice(11, 16))}` : p.pagoPendiente ? "" : `<form method="post" action="/__despachar?pedido=${encodeURIComponent(p.pedido)}"><button>Despachar</button></form> <form method="post" action="/__despachar?pedido=${encodeURIComponent(p.pedido)}&faltante=1"><button>Falta mercadería</button></form>`}</td></tr>`).join("");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'" });
    return res.end(`<!doctype html><meta charset="utf-8"><title>Stocker simulado · Envíos del día</title><style>body{font:14px system-ui;margin:24px}td,th{border:1px solid #ddd;padding:6px 8px}table{border-collapse:collapse}form{display:inline}</style><h1>Envíos del día (Stocker simulado)</h1><p>Despachar = el depósito entregó la caja al transporte: Stocker descuenta el stock y avisa a la tienda.</p><table><tr><th>Pedido</th><th>Pago</th><th>Transporte</th><th>Seguimiento</th><th></th></tr>${filas}</table>`);
  }
  if (url.pathname === "/__despachar" && req.method === "POST" && local(req)) {
    const p = pedidos.get(url.searchParams.get("pedido") ?? "");
    if (!p || p.estado !== "aceptado" || p.pagoPendiente) return json(res, 409, { message: "No se puede despachar (no existe, cancelado o sin pagar)." });
    const e = url.searchParams.get("faltante") ? "faltante" : "despachado";
    if (e === "despachado") p.despachadoEn = new Date().toISOString();
    if (pool) await pool.query("SELECT pg_notify('stocker_tienda_envios', $1)", [JSON.stringify({ b: NEGOCIO, p: p.pedido, e })]);
    res.writeHead(303, { location: "/" });
    return res.end();
  }
  if (!url.pathname.startsWith("/api/integraciones/tienda/")) return json(res, 404, { message: "No existe." });
  if (!autorizado(req)) return json(res, 401, { message: "Credencial inválida." });
  if (url.pathname.endsWith("/catalogo")) {
    return json(res, 200, {
      negocio: NEGOCIO,
      productos: catalogo.map((p) => ({
        id: p.id, skuAgrupador: p.sku, titulo: p.titulo, precioMinorista: p.precio, precioMayorista: p.precio === null ? null : Math.round(p.precio / 2),
        descripcion: p.descripcion ?? null, categoria: p.categoria ?? null, modelo: p.modelo ?? null, genero: p.genero ?? null,
        variantes: p.variantes.map((v) => ({
          id: v.id, sku: v.sku, color: v.color ?? null, talle: v.talle ?? null, precioMinorista: v.precio ?? null,
          precioMayorista: (v.precio ?? null) === null ? null : Math.round(v.precio / 2), publicable: v.cantidad, activo: true,
        })),
      })),
      truncado: false,
      sinLocalesOnline: false,
      generadoEn: new Date().toISOString(),
    });
  }
  // ── Pedidos de la tienda (como el parche de Stocker: aparta todo o nada) ──
  // eslint-disable-next-line security/detect-unsafe-regex -- herramienta de desarrollo; grupos distintos, sin retroceso
  const mp = url.pathname.match(/^\/api\/integraciones\/tienda\/pedidos(?:\/([A-Z0-9-]+))?(?:\/(pagado|cancelar|envio))?$/);
  if (mp && req.method !== "GET" || (mp && mp[1])) {
    const [, numero, accion] = mp;
    if (!numero && req.method === "POST") {
      const b = await leerJson(req);
      if (pedidos.has(b.pedido)) return json(res, 200, { ...resumen(pedidos.get(b.pedido)), repetido: true });
      const faltan = (b.items ?? []).filter((i) => (porSku.get(i.sku)?.cantidad ?? 0) < i.cantidad);
      const p = { id: pedidos.size + 1, pedido: b.pedido, items: b.items ?? [], pagoPendiente: !!b.pagoPendiente, envio: b.envio ?? null };
      if (faltan.length) {
        p.estado = "rechazado"; p.motivo = "Sin stock";
        pedidos.set(b.pedido, p);
        return json(res, 200, { ...resumen(p), repetido: false, faltantes: faltan.map((i) => ({ sku: i.sku, pedido: i.cantidad, hay: porSku.get(i.sku)?.cantidad ?? 0 })) });
      }
      for (const i of p.items) porSku.get(i.sku).cantidad -= i.cantidad;
      p.estado = "aceptado";
      pedidos.set(b.pedido, p);
      await avisar(p.items.map((i) => i.sku));
      return json(res, 200, { ...resumen(p), repetido: false });
    }
    const p = pedidos.get(numero);
    if (!p) return json(res, 404, { message: "Ese pedido no existe." });
    if (accion === "pagado") {
      if (p.estado !== "aceptado") return json(res, 409, { message: `El pedido está ${p.estado}`, codigo: `PEDIDO_${p.estado.toUpperCase()}` });
      p.pagoPendiente = false;
      console.warn(`Stocker simulado: ${numero} PAGADO → ya se puede despachar`);
    }
    if (accion === "envio") {
      const b = await leerJson(req);
      if (p.despachadoEn && b.seguimiento && b.seguimiento !== p.envio?.seguimiento) return json(res, 409, { message: "Ya despachado con otro número", codigo: "YA_DESPACHADO" });
      p.envio = { ...(p.envio ?? {}), tipo: b.tipo, seguimiento: b.seguimiento ?? p.envio?.seguimiento };
      console.warn(`Stocker simulado: ${numero} sale con ${b.tipo} ${b.seguimiento ?? ""}`);
    }
    if (accion === "cancelar" && p.estado === "aceptado") {
      p.estado = "cancelado"; p.canceladoEn = new Date().toISOString();
      for (const i of p.items) porSku.get(i.sku).cantidad += i.cantidad;
      await avisar(p.items.map((i) => i.sku));
    }
    return json(res, 200, resumen(p));
  }
  if (url.pathname.endsWith("/clientes") && req.method === "PUT") {
    const b = await leerJson(req);
    return json(res, 200, { id: 1, nuevo: !!b.email });
  }
  if (url.pathname.endsWith("/stock")) {
    const skus = (url.searchParams.getAll("skus").join(",")).split(",").map((s) => s.trim()).filter(Boolean);
    if (skus.length > 200) return json(res, 400, { message: "Como mucho 200 SKU por pedido." });
    const conocidos = skus.filter((s) => porSku.has(s));
    return json(res, 200, { stock: Object.fromEntries(conocidos.map((s) => [s, porSku.get(s).cantidad])), desconocidos: skus.filter((s) => !porSku.has(s)), generadoEn: new Date().toISOString() });
  }
  return json(res, 404, { message: "No existe." });
}).listen(PUERTO, "127.0.0.1", () => console.warn(`Stocker simulado en http://127.0.0.1:${PUERTO} (${catalogo.length} productos)`));
