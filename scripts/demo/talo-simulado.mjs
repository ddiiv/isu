/*
 * Talo simulado (sólo desarrollo y pruebas): las rutas que usa la API, como
 * las documenta Talo (https://docs.talo.com.ar), más el "faucet" del sandbox
 * para simular que alguien transfirió a un CVU.
 *
 *   POST /users/:id/tokens        { client_id, client_secret } → token
 *   POST /payments/               crea el cobro: un CVU y alias por pedido
 *   GET  /payments/:id            el cobro, con lo que llegó
 *   POST /cvu/:cvu/faucet         { amount } simula una transferencia y avisa a la tienda
 *   GET  /                        los cobros, con botones para "transferir" (para probar a mano)
 *
 * Uso: TALO_USER_ID=… TALO_CLIENT_ID=… TALO_CLIENT_SECRET=… node scripts/demo/talo-simulado.mjs
 * y en la API: TALO_API_URL=http://127.0.0.1:3930
 */
import http from "node:http";
import { randomUUID } from "node:crypto";

const PUERTO = Number(process.env.TALO_SIMULADO_PUERTO ?? 3930);
const USUARIO = process.env.TALO_USER_ID ?? "";
const CLIENTE = process.env.TALO_CLIENT_ID ?? "";
const SECRETO = process.env.TALO_CLIENT_SECRET ?? "";
if (!USUARIO || !CLIENTE || SECRETO.length < 8) { console.error("Faltan TALO_USER_ID, TALO_CLIENT_ID y TALO_CLIENT_SECRET (8+)."); process.exit(2); }

const pagos = new Map();
const porCvu = new Map();
const tokens = new Set();
let n = 0;

const json = (res, s, c) => { res.writeHead(s, { "content-type": "application/json" }); res.end(JSON.stringify(c)); };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const leer = async (req) => { let b = ""; for await (const c of req) { b += c; if (b.length > 100_000) throw new Error("grande"); } return b ? JSON.parse(b) : {}; };
const recibido = (p) => p.transactions.reduce((a, t) => a + Number(t.amount), 0);

async function transferir(p, monto) {
  p.transactions.push({
    address: p.quotes[0].cvu, amount: String(monto), currency: "ARS", network: "POLLUX", commission: 0.008,
    creation_timestamp: new Date().toISOString(), sender_address: "0000003100099999999999",
    transaction_data: { PROCESSED: { amount: monto, currency: "ARS", recipient: p.quotes[0].cvu, sender: "0000003100099999999999", senderCuit: "20301112224", senderTitular: "Cliente Simulado", trxId: randomUUID() } },
  });
  const total = Math.round(recibido(p) * 100), pedido = Math.round(p.price.amount * 100);
  p.payment_status = total === pedido ? "SUCCESS" : total > pedido ? "OVERPAID" : "UNDERPAID";
  p.last_modified_timestamp = new Date().toISOString();
  // Como Talo: el aviso trae sólo ids.
  if (p.webhook_url) {
    try {
      await fetch(p.webhook_url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "Pago Actualizado", paymentId: p.id, externalId: p.external_id }) });
    } catch (e) { console.warn("no se pudo avisar a la tienda:", e.message); }
  }
}

http.createServer(async (req, res) => {
  const u = new URL(req.url ?? "/", `http://127.0.0.1:${PUERTO}`);
  try {
    // ── Pantalla para probar a mano ──
    if (u.pathname === "/" && req.method === "GET") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'" });
      return res.end(`<!doctype html><html lang="es"><meta name="viewport" content="width=device-width"><title>Talo (simulado)</title>
<body style="font-family:Arial;max-width:720px;margin:30px auto"><h1>Talo · SIMULADO</h1><ul>${[...pagos.values()].reverse().map((p) => `<li style="margin:12px 0">
<b>${esc(p.external_id)}</b> · $ ${esc(p.price.amount)} · CVU ${esc(p.quotes[0].cvu)} · <b>${esc(p.payment_status)}</b>
<form method="post" action="/simular" style="display:inline"><input type="hidden" name="id" value="${esc(p.id)}">
<button name="como" value="exacto">Transferir el monto exacto</button> <button name="como" value="menos">De menos</button></form></li>`).join("")}</ul></body></html>`);
    }
    if (u.pathname === "/simular" && req.method === "POST") {
      let b = ""; for await (const c of req) b += c;
      const f = new URLSearchParams(b);
      const p = pagos.get(f.get("id"));
      if (p) await transferir(p, f.get("como") === "menos" ? Math.max(1, Math.floor(p.price.amount / 2)) : Math.round((p.price.amount - recibido(p)) * 100) / 100);
      res.writeHead(303, { location: "/" });
      return res.end();
    }

    // ── API ──
    const tk = u.pathname.match(/^\/users\/([^/]+)\/tokens$/);
    if (tk && req.method === "POST") {
      const b = await leer(req);
      if (decodeURIComponent(tk[1]) !== USUARIO || b.client_id !== CLIENTE || b.client_secret !== SECRETO) return json(res, 401, { message: "Credenciales inválidas", error: true });
      const token = `TL-simulado-${randomUUID()}`;
      tokens.add(token);
      return json(res, 200, { message: "ok", error: false, data: { token } });
    }
    const auth = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    if (!tokens.has(auth)) return json(res, 401, { message: "Token inválido", error: true });

    if (u.pathname === "/payments/" && req.method === "POST") {
      const b = await leer(req);
      if (b.user_id !== USUARIO || !(b.price?.amount > 0) || b.price?.currency !== "ARS") return json(res, 400, { message: "Datos inválidos", error: true });
      n++;
      const cvu = `00006305${String(Date.now() % 1e9).padStart(9, "0")}${String(n).padStart(5, "0")}`;
      const p = {
        id: `VAR-simulado-${n}-${String(b.external_id ?? "").replace(/[^A-Za-z0-9_-]/g, "")}`, external_id: b.external_id ?? null,
        payment_status: "PENDING", price: b.price, payment_options: ["transfer"], webhook_url: b.webhook_url ?? null,
        quotes: [{ currency: "ARS", network: "POLLUX", amount: String(b.price.amount), address: cvu, cvu, alias: `isu.sim.${n}` }],
        creation_timestamp: new Date().toISOString(), last_modified_timestamp: new Date().toISOString(),
        expiration_timestamp: new Date(Date.now() + 5 * 86_400_000).toISOString(), transactions: [],
      };
      pagos.set(p.id, p);
      porCvu.set(cvu, p);
      const { webhook_url: _w, ...publico } = p;
      return json(res, 200, { message: "ok", error: false, data: { ...publico, payment_url: `http://127.0.0.1:${PUERTO}/` } });
    }
    const pm = u.pathname.match(/^\/payments\/([A-Za-z0-9_-]+)$/);
    if (pm && req.method === "GET") {
      const p = pagos.get(pm[1]);
      if (!p) return json(res, 404, { message: "No existe", error: true });
      const { webhook_url: _w, ...publico } = p;
      return json(res, 200, { message: "ok", error: false, code: 200, data: publico });
    }
    const fc = u.pathname.match(/^\/cvu\/(\d{22})\/faucet$/);
    if (fc && req.method === "POST") {
      const p = porCvu.get(fc[1]);
      const b = await leer(req);
      if (!p || !(Number(b.amount) > 0)) return json(res, 404, { message: "CVU inexistente o monto inválido", error: true });
      await transferir(p, Number(b.amount));
      return json(res, 200, { message: "ok", error: false, data: { payment_status: p.payment_status } });
    }
    return json(res, 404, { message: "No existe", error: true });
  } catch (e) {
    return json(res, 500, { message: e.message, error: true });
  }
}).listen(PUERTO, "127.0.0.1", () => console.warn(`Talo simulado en http://127.0.0.1:${PUERTO}`));
