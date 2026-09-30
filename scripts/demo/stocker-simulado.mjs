/*
 * Stocker simulado: las dos rutas que usa la tienda, con el catálogo de muestra.
 *
 *   GET  /api/integraciones/tienda/catalogo
 *   GET  /api/integraciones/tienda/stock?skus=A,B
 *   POST /api/integraciones/tienda/pedidos (+ /:n, /:n/pagado, /:n/cancelar) y PUT …/clientes
 *   POST /__vender   {"sku":"…","cantidad":1}   simula una venta en el local
 *                    (baja el stock y avisa por NOTIFY, como el Stocker real)
 *
 * Uso: STOCKER_TOKEN=… DATABASE_URL=… node scripts/demo/stocker-simulado.mjs
 */
import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import pg from "pg";
import { catalogoDemo } from "./catalogo.mjs";

const PUERTO = Number(process.env.STOCKER_SIMULADO_PUERTO ?? 3900);
const TOKEN = process.env.STOCKER_TOKEN ?? "";
const NEGOCIO = 1;
if (TOKEN.length < 20) {
  console.error("Falta STOCKER_TOKEN (20+ caracteres), el mismo que usa el worker.");
  process.exit(2);
}
const catalogo = catalogoDemo();
const porSku = new Map(catalogo.flatMap((p) => p.variantes.map((v) => [v.sku, v])));
const pool = process.env.DATABASE_URL ? new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 }) : null;
const pedidos = new Map();
const avisar = async (skus) => { if (pool) await pool.query("SELECT pg_notify('stocker_stock', $1)", [JSON.stringify({ b: NEGOCIO, s: skus })]); };
const leerJson = async (req) => { let b = ""; for await (const c of req) { b += c; if (b.length > 100_000) break; } try { return JSON.parse(b || "{}"); } catch { return {}; } };
const resumen = (p) => ({ id: p.id, pedido: p.pedido, estado: p.estado, pagoPendiente: p.pagoPendiente, estadoEnvio: null, despachadoEn: null, canceladoEn: p.canceladoEn ?? null, motivo: p.motivo ?? null });

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
    if (pool) await pool.query("SELECT pg_notify('stocker_stock', $1)", [JSON.stringify({ b: NEGOCIO, s: [sku] })]);
    return json(res, 200, { sku, cantidad: v.cantidad });
  }
  if (!url.pathname.startsWith("/api/integraciones/tienda/")) return json(res, 404, { message: "No existe." });
  if (!autorizado(req)) return json(res, 401, { message: "Credencial inválida." });
  if (url.pathname.endsWith("/catalogo")) {
    return json(res, 200, {
      negocio: NEGOCIO,
      generado: new Date().toISOString(),
      sinLocalesOnline: false,
      productos: catalogo.map(({ forma: _f, ...p }) => p),
    });
  }
  // ── Pedidos de la tienda (como el parche de Stocker: aparta todo o nada) ──
  // eslint-disable-next-line security/detect-unsafe-regex -- herramienta de desarrollo; grupos distintos, sin retroceso
  const mp = url.pathname.match(/^\/api\/integraciones\/tienda\/pedidos(?:\/([A-Z0-9-]+))?(?:\/(pagado|cancelar))?$/);
  if (mp && req.method !== "GET" || (mp && mp[1])) {
    const [, numero, accion] = mp;
    if (!numero && req.method === "POST") {
      const b = await leerJson(req);
      if (pedidos.has(b.pedido)) return json(res, 200, { ...resumen(pedidos.get(b.pedido)), repetido: true });
      const faltan = (b.items ?? []).filter((i) => (porSku.get(i.sku)?.cantidad ?? 0) < i.cantidad);
      const p = { id: pedidos.size + 1, pedido: b.pedido, items: b.items ?? [], pagoPendiente: !!b.pagoPendiente };
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
    return json(res, 200, { generado: new Date().toISOString(), stock: Object.fromEntries(skus.map((s) => [s, porSku.get(s)?.cantidad ?? 0])) });
  }
  return json(res, 404, { message: "No existe." });
}).listen(PUERTO, "127.0.0.1", () => console.warn(`Stocker simulado en http://127.0.0.1:${PUERTO} (${catalogo.length} productos)`));
