/*
 * Stocker simulado: las rutas que usa la tienda, con el catálogo de muestra y
 * las formas de Stocker v3.39 (contrato v1, docs/contrato-movimientos.md):
 *
 *   GET  /api/integraciones/tienda/catalogo      skuAgrupador, precioMinorista, publicable, generadoEn
 *   GET  /api/integraciones/tienda/stock?skus=   con desconocidos
 *   POST /api/integraciones/tienda/pedidos       sobre { contrato, tipo:"venta", id:"isu:…", datos } o plano;
 *                                                201 aceptado · 200 ya lo tenía · 409 sin stock · 201 parcial
 *   POST /api/integraciones/tienda/pedidos/:n/cancelar   { accion, liberadas, yaSalio } · 404
 *   POST /api/integraciones/tienda/pedidos/:n/envio      { pedidoExterno, seguimiento, envioTipo, despacharAntesDe }
 *   POST /api/integraciones/tienda/cobros        sobre tipo "cobro" (ventaId); aplicado / motivo
 *   GET  /api/integraciones/tienda/pedidos/resoluciones?desde=&limite=   el feed con cursor
 *   NOTIFY stock_cambio '<negocio>:<variante>' al apartar, liberar o vender en el local
 *   Libera solo lo que no se cobró a tiempo (pagoVenceEn, tope de 7 días).
 *
 *   POST /__vender   {"sku":"…","cantidad":1}   simula una venta en el local
 *   GET  /           "Envíos del día" simulado: los pedidos con su pago, transporte
 *                    y seguimiento. Despachar (sólo cobrados) o «Falta mercadería»
 *                    deja la novedad en el feed, como el Stocker real.
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
const cobros = new Map();
let secuencia = 0;
// Stocker espera 5 s antes de mostrar una novedad en el feed; acá alcanza con 1 s.
const REZAGO_MS = 1000;
const PAGO_VENCE_H = 72, PAGO_TOPE_H = 7 * 24, GRACIA_MS = 5 * 60_000;
// Un aviso por variante, como el Stocker real (NOTIFY stock_cambio, '<negocio>:<variante>').
const avisar = async (skus) => {
  if (!pool) return;
  for (const sku of new Set(skus)) { const v = porSku.get(sku); if (v) await pool.query("SELECT pg_notify('stock_cambio', $1)", [`${NEGOCIO}:${v.id}`]); }
};
const leerJson = async (req) => { let b = ""; for await (const c of req) { b += c; if (b.length > 100_000) break; } try { return JSON.parse(b || "{}"); } catch { return {}; } };
const hay = (v) => v !== undefined && v !== null;
const sinPrefijo = (v) => { const t = String(v ?? "").trim(); const i = t.indexOf(":"); return i === -1 ? t : t.slice(i + 1); };
/** Como abrirSobre de Stocker: el sobre del contrato o el cuerpo plano. */
function abrirSobre(c, tipo) {
  if (!c || typeof c.datos !== "object" || c.datos === null || Array.isArray(c.datos)) return c ?? {};
  if (hay(c.contrato) && Number(c.contrato) !== 1) throw Object.assign(new Error(`Este Stocker entiende el contrato de movimientos 1 y llegó "${c.contrato}".`), { status: 400 });
  if (tipo && c.tipo && String(c.tipo).toLowerCase() !== tipo) throw Object.assign(new Error(`Esta ruta procesa movimientos de tipo "${tipo}" y el mensaje dice "${c.tipo}".`), { status: 400 });
  const d = { ...c.datos };
  if (!hay(d.pedidoExterno) && hay(c.id)) d.pedidoExterno = sinPrefijo(c.id);
  return d;
}
/** Toda escritura deja la novedad para el feed (como `novedadEn` en Stocker). */
const novedad = (p) => { p.novedadEn = new Date(); p.orden = ++secuencia; };
const queCambio = (p) => (p.despachadoEn ? "despachado" : p.estadoEnvio === "con_faltante" ? "faltante" : p.canceladoEn ? "cancelado" : p.estado);
const respuesta = (p, repetido) => ({ pedidoExterno: p.pedidoExterno, estado: p.estado, motivo: p.motivo ?? null, repetido });
function cancelar(p, motivo) {
  if (p.estado === "cancelado") return { accion: "ya_cancelado", pedidoId: p.id };
  const yaSalio = p.estadoEnvio === "despachado";
  let liberadas = 0;
  if (["aceptado", "parcial"].includes(p.estado) && !yaSalio) {
    for (const i of p.apartado) { porSku.get(i.sku).cantidad += i.cantidad; liberadas += i.cantidad; }
  }
  p.estado = "cancelado"; p.canceladoEn = new Date().toISOString();
  p.motivo = (yaSalio ? `${motivo}. Ya se había despachado: si vuelve, entra por devolución.` : motivo).slice(0, 500);
  novedad(p);
  return { accion: "cancelado", pedidoId: p.id, liberadas, yaSalio };
}
// El reloj propio de Stocker: lo que no se cobró a tiempo se libera solo.
setInterval(async () => {
  for (const p of pedidos.values()) {
    if (p.pagoEstado === "pendiente" && p.pagoVenceEn && !p.canceladoEn && p.pagoVenceEn.getTime() < Date.now() - GRACIA_MS) {
      const r = cancelar(p, "Venció el plazo de pago: se liberó la mercadería apartada");
      if (r.liberadas) await avisar(p.apartado.map((i) => i.sku)).catch(() => {});
    }
  }
}, 30_000).unref();
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
    const filas = [...pedidos.values()].filter((p) => ["aceptado", "parcial"].includes(p.estado)).reverse().map((p) => `<tr><td>${esc(p.pedidoExterno)}</td><td>${p.pagoEstado === "pagado" ? "pagado" : `sin pagar${p.pagoDetalle ? ` · ${esc(p.pagoDetalle)}` : ""}`}</td><td>${esc(p.envioTipo ?? "—")}</td><td><code>${esc(p.seguimiento ?? "")}</code></td><td>${p.despachadoEn ? `despachado ${esc(p.despachadoEn.slice(11, 16))}` : p.pagoEstado !== "pagado" ? "" : `<form method="post" action="/__despachar?pedido=${encodeURIComponent(p.pedidoExterno)}"><button>Despachar</button></form> <form method="post" action="/__despachar?pedido=${encodeURIComponent(p.pedidoExterno)}&faltante=1"><button>Falta mercadería</button></form>`}</td></tr>`).join("");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'" });
    return res.end(`<!doctype html><meta charset="utf-8"><title>Stocker simulado · Envíos del día</title><style>body{font:14px system-ui;margin:24px}td,th{border:1px solid #ddd;padding:6px 8px}table{border-collapse:collapse}form{display:inline}</style><h1>Envíos del día (Stocker simulado)</h1><p>Despachar = el depósito entregó la caja al transporte: Stocker descuenta el stock y avisa a la tienda.</p><table><tr><th>Pedido</th><th>Pago</th><th>Transporte</th><th>Seguimiento</th><th></th></tr>${filas}</table>`);
  }
  if (url.pathname === "/__despachar" && req.method === "POST" && local(req)) {
    const p = pedidos.get(url.searchParams.get("pedido") ?? "");
    if (!p || !["aceptado", "parcial"].includes(p.estado) || p.pagoEstado !== "pagado") return json(res, 409, { message: "No se puede despachar (no existe, cancelado o sin cobrar)." });
    if (url.searchParams.get("faltante")) p.estadoEnvio = "con_faltante";
    else { p.despachadoEn = new Date().toISOString(); p.estadoEnvio = "despachado"; }
    novedad(p);
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
  try {
    // ── El feed de novedades (con cursor, sin historia la primera vez) ──
    if (url.pathname === "/api/integraciones/tienda/pedidos/resoluciones" && req.method === "GET") {
      const hasta = new Date(Date.now() - REZAGO_MS);
      const cursorDe = (en, orden) => `${en.toISOString()}|${orden}`;
      const desde = url.searchParams.get("desde");
      if (!desde) return json(res, 200, { cursor: cursorDe(hasta, secuencia), cambios: [] });
      const m = /^(.+)\|(\d+)$/.exec(desde);
      if (!m || Number.isNaN(Date.parse(m[1]))) return json(res, 400, { message: "El cursor no se entiende. Mandá el que devolvió la vuelta anterior, o ninguno para empezar." });
      const orden = Number(m[2]);
      const tope = Math.min(Math.max(Number(url.searchParams.get("limite")) || 100, 1), 500);
      const filas = [...pedidos.values()].filter((p) => p.novedadEn && p.novedadEn <= hasta && p.orden > orden).sort((a, b) => a.orden - b.orden).slice(0, tope);
      const ultima = filas.at(-1);
      return json(res, 200, {
        cursor: ultima ? cursorDe(ultima.novedadEn, ultima.orden) : desde,
        cambios: filas.map((p) => ({
          pedidoExterno: p.pedidoExterno, cambio: queCambio(p), estado: p.estado, estadoEnvio: p.estadoEnvio ?? null, pagoEstado: p.pagoEstado,
          seguimiento: p.seguimiento ?? null, envioTipo: p.envioTipo ?? null, despachadoEn: p.despachadoEn ?? null, canceladoEn: p.canceladoEn ?? null,
          motivo: p.motivo ?? null, en: p.novedadEn.toISOString(),
        })),
        hayMas: filas.length === tope,
      });
    }
    // ── Pedidos de la tienda: aparta todo o nada; el SKU desconocido deja el pedido parcial ──
    if (url.pathname === "/api/integraciones/tienda/pedidos" && req.method === "POST") {
      const b = abrirSobre(await leerJson(req), "venta");
      const externo = String(b.pedidoExterno ?? "").trim();
      if (!externo) return json(res, 400, { message: "El pedido necesita el id que le dio la plataforma." });
      if (externo.length > 60) return json(res, 400, { message: "El id del pedido de la plataforma no puede pasar de 60 caracteres." });
      const items = Array.isArray(b.items) ? b.items : [];
      if (!items.length) return json(res, 400, { message: "El pedido llegó sin artículos." });
      for (const i of items) if (!Number.isInteger(Number(i?.cantidad)) || Number(i.cantidad) <= 0) return json(res, 400, { message: `La cantidad de "${i?.sku}" tiene que ser un entero mayor a cero.` });
      const ya = pedidos.get(externo);
      if (ya) return json(res, ya.estado === "rechazado" ? 409 : 200, respuesta(ya, true));
      const pagoPendiente = b.pagoPendiente !== false;
      const ahora = new Date();
      const tope = new Date(ahora.getTime() + PAGO_TOPE_H * 3600_000);
      const pedida = b.pagoVenceEn ? new Date(b.pagoVenceEn) : null;
      const p = {
        id: pedidos.size + 1, pedidoExterno: externo, items, apartado: [], total: b.total ?? null, cobrado: 0,
        pagoEstado: pagoPendiente ? "pendiente" : "pagado", pagoDetalle: b.pagoDetalle ?? null,
        pagoVenceEn: pagoPendiente ? (pedida && !Number.isNaN(pedida.getTime()) ? (pedida > tope ? tope : pedida) : new Date(ahora.getTime() + PAGO_VENCE_H * 3600_000)) : null,
        envioTipo: b.envio?.tipo ?? null, seguimiento: b.envio?.seguimiento ?? null, despacharAntesDe: b.envio?.despacharAntesDe ?? null,
      };
      pedidos.set(externo, p);
      const conocidos = items.filter((i) => porSku.has(i.sku));
      const desconocidos = items.filter((i) => !porSku.has(i.sku)).map((i) => i.sku);
      const faltan = conocidos.filter((i) => porSku.get(i.sku).cantidad < i.cantidad);
      if (faltan.length) {
        p.estado = "rechazado";
        p.motivo = `Sin stock para despachar. ${faltan.map((i) => `${i.sku}: pide ${i.cantidad} y faltan ${i.cantidad - porSku.get(i.sku).cantidad}`).join("; ")}.`;
        novedad(p);
        return json(res, 409, respuesta(p, false));
      }
      for (const i of conocidos) { porSku.get(i.sku).cantidad -= i.cantidad; p.apartado.push({ sku: i.sku, cantidad: i.cantidad }); }
      p.estado = desconocidos.length ? "parcial" : "aceptado";
      p.motivo = desconocidos.length ? `No están en Stocker y no se descontaron: ${desconocidos.join(", ")}.` : null;
      novedad(p);
      await avisar(conocidos.map((i) => i.sku));
      return json(res, 201, respuesta(p, false));
    }
    const mp = /^\/api\/integraciones\/tienda\/pedidos\/([^/]{1,80})\/(cancelar|envio)$/.exec(url.pathname);
    if (mp && req.method === "POST") {
      const p = pedidos.get(decodeURIComponent(mp[1]).trim());
      if (!p) return json(res, 404, { message: "Ese pedido no está en la cola." });
      if (mp[2] === "cancelar") {
        const b = abrirSobre(await leerJson(req), "cancelacion");
        const r = cancelar(p, String(b.motivo || "Cancelado en la tienda"));
        if (r.liberadas) await avisar(p.apartado.map((i) => i.sku));
        return json(res, 200, r);
      }
      const b = abrirSobre(await leerJson(req), "envio");
      if (!hay(b.seguimiento) && !hay(b.tipo) && !hay(b.despacharAntesDe)) return json(res, 400, { message: "No vino nada que guardar: mandá seguimiento, tipo o despacharAntesDe." });
      if (hay(b.seguimiento)) p.seguimiento = String(b.seguimiento).slice(0, 60);
      if (hay(b.tipo)) p.envioTipo = String(b.tipo).slice(0, 30);
      if (hay(b.despacharAntesDe)) p.despacharAntesDe = b.despacharAntesDe;
      novedad(p);
      console.warn(`Stocker simulado: ${p.pedidoExterno} sale con ${p.envioTipo} ${p.seguimiento ?? ""}`);
      return json(res, 200, { pedidoExterno: p.pedidoExterno, seguimiento: p.seguimiento ?? null, envioTipo: p.envioTipo ?? null, despacharAntesDe: p.despacharAntesDe ?? null });
    }
    // ── Cobros: el id es del cobro, el pedido va en ventaId; nunca un 4xx si se entendió ──
    if (url.pathname === "/api/integraciones/tienda/cobros" && req.method === "POST") {
      const crudo = await leerJson(req);
      const b = abrirSobre(crudo, "cobro");
      const mov = sinPrefijo(crudo?.id ?? b.movimientoExterno);
      const externo = sinPrefijo(b.ventaId);
      const importe = Number(b.importe);
      if (!mov) return json(res, 400, { message: "El cobro necesita el id del movimiento." });
      if (!externo) return json(res, 400, { message: "El cobro tiene que nombrar el pedido (ventaId)." });
      if (!Number.isFinite(importe) || importe <= 0) return json(res, 400, { message: `El importe del cobro tiene que ser un número mayor a cero y llegó "${b.importe}".` });
      if (!String(b.medio ?? "").trim()) return json(res, 400, { message: "El cobro necesita decir con qué medio se pagó." });
      const p = pedidos.get(externo);
      if (!p) return json(res, 404, { message: "Ese pedido no está en la cola." });
      const salida = (c, repetido) => ({ movimientoExterno: mov, pedidoExterno: p.pedidoExterno, aplicado: c.aplicado, motivo: c.motivo, pagoEstado: p.pagoEstado, cobrado: p.cobrado, repetido });
      if (cobros.has(mov)) return json(res, 200, salida(cobros.get(mov), true));
      const avisos = [];
      if (b.operacion && [...cobros.values()].some((c) => c.operacion === String(b.operacion))) avisos.push(`La operación ${b.operacion} ya estaba registrada en otro cobro: revisar antes de dar por cobrado.`);
      if (p.estado === "cancelado") avisos.push("Cobró sobre un pedido cancelado: la mercadería ya se liberó y hay que devolver el dinero.");
      else if (p.estado === "rechazado") avisos.push("Cobró sobre un pedido rechazado por falta de stock: hay que devolver el dinero.");
      const c = { aplicado: avisos.length === 0, motivo: avisos.join(" ") || null, operacion: b.operacion ? String(b.operacion) : null };
      cobros.set(mov, c);
      if (c.aplicado) {
        p.cobrado += importe;
        const alcanza = !hay(p.total) || p.cobrado >= Number(p.total) - 0.02;
        p.pagoEstado = alcanza ? "pagado" : "pendiente";
        if (alcanza) { p.pagoVenceEn = null; p.pagoDetalle = null; } else p.pagoDetalle = `Cobrado ${p.cobrado} de ${p.total}`;
        novedad(p);
        console.warn(`Stocker simulado: ${p.pedidoExterno} cobro ${mov} de ${importe}${alcanza ? " → PAGADO, ya se puede despachar" : ""}`);
      } else console.warn(`Stocker simulado: cobro ${mov} sin aplicar: ${c.motivo}`);
      return json(res, 201, salida(c, false));
    }
  } catch (e) {
    return json(res, e.status ?? 500, { message: e.message });
  }
  if (url.pathname.endsWith("/stock")) {
    const skus = (url.searchParams.getAll("skus").join(",")).split(",").map((s) => s.trim()).filter(Boolean);
    if (skus.length > 200) return json(res, 400, { message: "Como mucho 200 SKU por pedido." });
    const conocidos = skus.filter((s) => porSku.has(s));
    return json(res, 200, { stock: Object.fromEntries(conocidos.map((s) => [s, porSku.get(s).cantidad])), desconocidos: skus.filter((s) => !porSku.has(s)), generadoEn: new Date().toISOString() });
  }
  return json(res, 404, { message: "No existe." });
}).listen(PUERTO, "127.0.0.1", () => console.warn(`Stocker simulado en http://127.0.0.1:${PUERTO} (${catalogo.length} productos)`));
