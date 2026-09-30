/*
 * Mercado Pago simulado (sólo desarrollo y pruebas).
 *
 * Las rutas que usa la API (preferencias, pagos, búsqueda) y una pantalla de
 * pago con tres botones: Aprobar, Rechazar y Dejar pendiente. Al aprobar,
 * manda el aviso FIRMADO a la API (igual que Mercado Pago) y vuelve a la tienda.
 *
 * Uso: MP_ACCESS_TOKEN=… MP_WEBHOOK_SECRET=… node scripts/demo/mercadopago-simulado.mjs
 * y en la API: MP_API_URL=http://127.0.0.1:3910
 */
import http from "node:http";
import { createHmac, randomUUID } from "node:crypto";

const PUERTO = Number(process.env.MP_SIMULADO_PUERTO ?? 3910);
const TOKEN = process.env.MP_ACCESS_TOKEN ?? "";
const SECRETO = process.env.MP_WEBHOOK_SECRET ?? "";
const PUBLICO = `http://127.0.0.1:${PUERTO}`;
if (TOKEN.length < 20 || SECRETO.length < 16) { console.error("Faltan MP_ACCESS_TOKEN (20+) y MP_WEBHOOK_SECRET (16+)."); process.exit(2); }

const preferencias = new Map();
const pagos = new Map();
// Ids únicos aunque se reinicie (como en Mercado Pago: nunca se repiten).
let siguiente = Date.now();

const json = (res, s, c) => { res.writeHead(s, { "content-type": "application/json" }); res.end(JSON.stringify(c)); };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const leer = async (req) => { let b = ""; for await (const c of req) { b += c; if (b.length > 100_000) throw new Error("grande"); } return b; };

async function avisar(pref, pago) {
  const ts = Math.floor(Date.now() / 1000);
  const rid = randomUUID();
  const v1 = createHmac("sha256", SECRETO).update(`id:${pago.id};request-id:${rid};ts:${ts};`).digest("hex");
  try {
    await fetch(`${pref.notification_url}?type=payment&data.id=${pago.id}`, {
      method: "POST", headers: { "content-type": "application/json", "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": rid },
      body: JSON.stringify({ type: "payment", action: "payment.created", data: { id: String(pago.id) } }),
    });
  } catch (e) { console.warn("no se pudo avisar a la tienda:", e.message); }
}

http.createServer(async (req, res) => {
  const u = new URL(req.url ?? "/", PUBLICO);
  try {
    // ── Pantalla de pago (la ve el cliente) ──
    if (u.pathname === "/checkout" && req.method === "GET") {
      const pref = preferencias.get(u.searchParams.get("pref"));
      if (!pref) { res.writeHead(404); return res.end("Preferencia inexistente"); }
      const total = pref.items.reduce((a, i) => a + i.unit_price * i.quantity, 0) + (pref.shipments?.mode === "me2" ? 4500 : 0);
      const efectivo = pref.payment_methods?.excluded_payment_types?.some((t) => t.id === "credit_card");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' http: https:" });
      return res.end(`<!doctype html><html lang="es"><meta name="viewport" content="width=device-width"><title>Mercado Pago (simulado)</title>
<body style="font-family:Arial;background:#eee;margin:0"><div style="max-width:420px;margin:40px auto;background:#fff;border-radius:12px;padding:24px">
<p style="color:#009ee3;font-weight:bold">Mercado Pago · SIMULADO</p><h1 style="font-size:20px">Pagar pedido ${esc(pref.external_reference)}</h1>
<ul>${pref.items.map((i) => `<li>${esc(i.quantity)} × ${esc(i.title)} — $ ${esc(i.unit_price)}</li>`).join("")}${pref.shipments?.mode === "me2" ? "<li>Envío con Mercado Envíos — $ 4500</li>" : ""}</ul>
<p style="font-size:22px"><b>Total: $ ${esc(total)}</b></p><p>${efectivo ? "Pago en efectivo (Pago Fácil / Rapipago)" : "Tarjeta de crédito o débito"}</p>
<form method="post" action="/pagar"><input type="hidden" name="pref" value="${esc(pref.id)}">
<button name="r" value="approved" style="display:block;width:100%;padding:14px;margin:8px 0;background:#009ee3;color:#fff;border:0;border-radius:8px;font-size:16px">Aprobar pago</button>
<button name="r" value="rejected" style="display:block;width:100%;padding:14px;margin:8px 0;background:#fff;border:1px solid #c00;color:#c00;border-radius:8px">Rechazar</button>
<button name="r" value="pending" style="display:block;width:100%;padding:14px;margin:8px 0;background:#fff;border:1px solid #999;border-radius:8px">Dejar pendiente${efectivo ? " (genera el código)" : ""}</button>
</form></div></body></html>`);
    }
    if (u.pathname === "/pagar" && req.method === "POST") {
      const f = new URLSearchParams(await leer(req));
      const pref = preferencias.get(f.get("pref"));
      const estado = ["approved", "rejected", "pending"].includes(f.get("r")) ? f.get("r") : "rejected";
      if (!pref) { res.writeHead(404); return res.end(); }
      const pago = {
        id: siguiente++, status: estado, status_detail: estado === "approved" ? "accredited" : estado,
        external_reference: pref.external_reference, currency_id: "ARS",
        transaction_amount: pref.items.reduce((a, i) => a + i.unit_price * i.quantity, 0),
        payment_type_id: "credit_card", payment_method_id: "visa", installments: 1, date_approved: estado === "approved" ? new Date().toISOString() : null,
      };
      // Mercado Envíos (etapa 4): la preferencia trae shipments → el pago queda con una orden y el envío.
      if (pref.shipments?.mode === "me2") {
        pago.order = { id: pago.id, type: "mercadopago" };
        pago.shipping_amount = 4500;
        pago.transaction_amount += 4500;
      }
      pagos.set(String(pago.id), pago);
      await avisar(pref, pago);
      const vuelta = new URL(pref.back_urls[estado === "approved" ? "success" : estado === "pending" ? "pending" : "failure"]);
      vuelta.searchParams.set("payment_id", String(pago.id));
      vuelta.searchParams.set("status", estado);
      vuelta.searchParams.set("external_reference", pref.external_reference);
      res.writeHead(302, { location: vuelta.toString() });
      return res.end();
    }

    // ── API (la usa el servidor de la tienda) ──
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(res, 401, { message: "invalid_token" });
    if (u.pathname === "/checkout/preferences" && req.method === "POST") {
      const b = JSON.parse(await leer(req) || "{}");
      const id = `pref-${randomUUID()}`;
      preferencias.set(id, { ...b, id });
      return json(res, 201, { id, init_point: `${PUBLICO}/checkout?pref=${id}` });
    }
    const m = u.pathname.match(/^\/v1\/payments\/(\d+)$/);
    if (m && req.method === "GET") return pagos.has(m[1]) ? json(res, 200, pagos.get(m[1])) : json(res, 404, { message: "not_found" });
    const mo = u.pathname.match(/^\/merchant_orders\/(\d+)$/);
    if (mo && req.method === "GET") {
      const pago = pagos.get(mo[1]);
      if (!pago?.order) return json(res, 404, { message: "not_found" });
      // El id del envío lo sigue el simulador de transportes (/meli/shipments/:id).
      return json(res, 200, { id: pago.order.id, shipments: pago.status === "approved" ? [{ id: 40_000_000 + (pago.id % 10_000_000) }] : [], shipping_cost: 4500 });
    }
    if (u.pathname === "/v1/payments/search") {
      const ref = u.searchParams.get("external_reference");
      return json(res, 200, { results: [...pagos.values()].filter((p) => p.external_reference === ref).reverse() });
    }
    return json(res, 404, { message: "not_found" });
  } catch (e) {
    return json(res, 500, { message: e.message });
  }
}).listen(PUERTO, "127.0.0.1", () => console.warn(`Mercado Pago simulado en ${PUBLICO}`));
