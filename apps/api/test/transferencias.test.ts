import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createHmac } from "node:crypto";
import { Redis } from "ioredis";
import { crearPool, migrar } from "@isu/db";
import { construirApp } from "../src/app.js";
import { leerEntorno } from "../src/entorno.js";
import type { Colas } from "../src/lib/colas.js";

/*
 * Transferencias que se confirman solas (migración 0014), de punta a punta en la API.
 * Stocker, Mercado Pago y Talo son simuladores en este mismo proceso.
 *
 *   · Talo: cada pedido tiene su CVU; el aviso trae sólo el id y se le pregunta a Talo.
 *   · Mercado Pago: el cliente transfiere al alias de la cuenta con centavos únicos y
 *     la tienda lo reconoce entre lo que entró (aviso, página abierta o vuelta del worker).
 */
const DB = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:5433/stocker_test";
const REDIS = process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6380/6";
const BASE = 7_600_000;
const SECRETO_MP = "secreto-de-prueba-de-mercado-pago";
const INTERNO = "i".repeat(40);
const TALO_USUARIO = "usuario-qa-talo";
const TALO_CLIENTE = "cliente-qa-talo";
const TALO_SECRETO = "secreto-qa-talo-1234";

const pool = crearPool({ url: DB, max: 6 });
const redis = new Redis(REDIS, { maxRetriesPerRequest: 1 });
let app: Awaited<ReturnType<typeof construirApp>>;

const enviados: Array<{ tipo: string; nombre: string; datos: Record<string, unknown> }> = [];
const colas: Colas = {
  async email(plantilla, para, datos) { enviados.push({ tipo: "email", nombre: plantilla, datos: { ...datos, para } }); },
  async stocker(nombre, datos) { enviados.push({ tipo: "stocker", nombre, datos }); },
  async envios(nombre, datos) { enviados.push({ tipo: "envios", nombre, datos }); },
  async cerrar() {},
};

// ── Simuladores ──
const stocker = { pedidos: new Map<string, { estado: string; pagoPendiente: boolean; items: Array<{ sku: string; cantidad: number }> }>(), stock: new Map<string, number>() };
const mp = { pagos: new Map<string, Record<string, unknown>>(), busquedas: 0 };
type PagoTaloSim = { id: string; external_id: string; payment_status: string; price: { amount: number; currency: string }; quotes: Array<{ cvu: string; alias: string }>; transactions: Array<Record<string, unknown>> };
const talo = { pagos: new Map<string, PagoTaloSim>(), creados: [] as Array<Record<string, unknown>>, tokens: 0, consultas: 0, caido: false, tokenVencido: false };

const servidores: http.Server[] = [];
async function levantar(h: http.RequestListener) {
  const s = http.createServer(h);
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  servidores.push(s);
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}
const leerCuerpo = async (req: http.IncomingMessage) => { let b = ""; for await (const c of req) b += c; return b ? JSON.parse(b) : {}; };
const json = (res: http.ServerResponse, status: number, cuerpo: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(cuerpo)); };

async function cargarCatalogo() {
  await pool.query("DELETE FROM tienda.productos WHERE stocker_id >= $1 AND stocker_id < $2", [BASE, BASE + 100]);
  const p = await pool.query("INSERT INTO tienda.productos (stocker_id, stocker_padre, nombre, slug, visible) VALUES ($1,'QA-T','Remera transferencia','qa-remera-transferencia',true) RETURNING id", [BASE + 1]);
  const c = await pool.query("INSERT INTO tienda.producto_colores (producto_id, clave, nombre) VALUES ($1,'negro','Negro') RETURNING id", [p.rows[0].id]);
  await pool.query("INSERT INTO tienda.variantes (producto_id, color_id, stocker_id, sku, talle, precio, stock) VALUES ($1,$2,$3,'QA-T-M','M',1000000,20)", [p.rows[0].id, c.rows[0].id, BASE * 10 + 1]);
  stocker.stock = new Map([["QA-T-M", 20]]);
}
const limpiar = async () => {
  await pool.query(`DELETE FROM tienda.transferencias_recibidas WHERE externo LIKE 'qa-%' OR (via = 'mercadopago' AND externo LIKE '9100%')
                       OR pedido_id IN (SELECT id FROM tienda.pedidos WHERE email LIKE 'qa-transf%')`);
  await pool.query("DELETE FROM tienda.pedidos WHERE email LIKE 'qa-transf%'");
  await pool.query("DELETE FROM tienda.clientes WHERE email LIKE 'qa-transf%'");
};
const ajuste = (talo: boolean, mercadoPago: boolean) =>
  pool.query("UPDATE tienda.ajustes SET valor = $1 WHERE clave = 'transferenciasAuto'", [JSON.stringify({ talo, mercadoPago })]);

let urlStocker = "", urlMp = "", urlTalo = "";

beforeAll(async () => {
  await migrar(pool);
  await redis.flushdb();
  urlStocker = await levantar(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${"s".repeat(30)}`) return json(res, 401, {});
    const u = new URL(req.url!, "http://x");
    const b = req.method === "GET" ? {} : await leerCuerpo(req);
    if (u.pathname.endsWith("/clientes")) return json(res, 200, { id: 1, nuevo: true });
    const resumen = (n: string) => ({ id: 1, pedido: n, estado: stocker.pedidos.get(n)!.estado, pagoPendiente: stocker.pedidos.get(n)!.pagoPendiente, estadoEnvio: null, despachadoEn: null, canceladoEn: null, motivo: null });
    if (u.pathname === "/api/integraciones/tienda/pedidos" && req.method === "POST") {
      for (const i of b.items) stocker.stock.set(i.sku, (stocker.stock.get(i.sku) ?? 0) - i.cantidad);
      stocker.pedidos.set(b.pedido, { estado: "aceptado", pagoPendiente: b.pagoPendiente, items: b.items });
      return json(res, 200, { ...resumen(b.pedido), repetido: false });
    }
    const m = u.pathname.match(/^\/api\/integraciones\/tienda\/pedidos\/([^/]+)\/(pagado|cancelar)$/);
    const p = m ? stocker.pedidos.get(m[1]!) : undefined;
    if (!m || !p) return json(res, 404, {});
    if (m[2] === "cancelar") p.estado = "cancelado"; else p.pagoPendiente = false;
    return json(res, 200, resumen(m[1]!));
  });
  urlMp = await levantar(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${"m".repeat(30)}`) return json(res, 401, {});
    const u = new URL(req.url!, "http://x");
    const pm = u.pathname.match(/^\/v1\/payments\/(\d+)$/);
    if (pm) return mp.pagos.has(pm[1]!) ? json(res, 200, mp.pagos.get(pm[1]!)) : json(res, 404, {});
    if (u.pathname === "/v1/payments/search") {
      const ref = u.searchParams.get("external_reference");
      if (ref) return json(res, 200, { results: [...mp.pagos.values()].filter((p) => p.external_reference === ref) });
      mp.busquedas++;
      // Lo que entró a la cuenta: aprobados, lo más nuevo primero.
      expect(u.searchParams.get("range")).toBe("date_created");
      const r = [...mp.pagos.values()].filter((p) => p.status === u.searchParams.get("status")).reverse();
      return json(res, 200, { results: r, paging: { total: r.length } });
    }
    return json(res, 404, {});
  });
  urlTalo = await levantar(async (req, res) => {
    if (talo.caido) return json(res, 500, { message: "caído" });
    const u = new URL(req.url!, "http://x");
    if (u.pathname === `/users/${TALO_USUARIO}/tokens` && req.method === "POST") {
      const b = await leerCuerpo(req);
      if (b.client_id !== TALO_CLIENTE || b.client_secret !== TALO_SECRETO) return json(res, 401, { message: "credenciales" });
      talo.tokens++;
      talo.tokenVencido = false;
      return json(res, 200, { message: "ok", error: false, data: { token: `TL-prueba-${talo.tokens}` } });
    }
    if (!/^Bearer TL-prueba-\d+$/.test(req.headers.authorization ?? "") || talo.tokenVencido) return json(res, 401, { message: "token" });
    if (u.pathname === "/payments/" && req.method === "POST") {
      const b = await leerCuerpo(req);
      talo.creados.push(b);
      const n = talo.creados.length;
      const pago: PagoTaloSim = {
        id: `VAR-qa-${n}-${b.external_id}`, external_id: b.external_id, payment_status: "PENDING", price: b.price,
        quotes: [{ cvu: `00006305${String(10_000_000_000_000 + n).padStart(14, "0")}`, alias: `isu.qa.${n}` }], transactions: [],
      };
      talo.pagos.set(pago.id, pago);
      return json(res, 200, { message: "ok", error: false, data: { ...pago, payment_url: `https://talo.test/p/${pago.id}`, expiration_timestamp: new Date(Date.now() + 5 * 86_400_000).toISOString() } });
    }
    const m = u.pathname.match(/^\/payments\/([A-Za-z0-9_-]+)$/);
    if (m && req.method === "GET") {
      talo.consultas++;
      const p = talo.pagos.get(m[1]!);
      return p ? json(res, 200, { message: "ok", error: false, code: 200, data: p }) : json(res, 404, { message: "no" });
    }
    return json(res, 404, {});
  });
  app = await construirApp({
    env: leerEntorno({
      NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: DB, REDIS_URL: REDIS, CACHE_SEGUNDOS: "0",
      STOCKER_API_URL: urlStocker, STOCKER_TOKEN: "s".repeat(30),
      MP_ACCESS_TOKEN: "m".repeat(30), MP_API_URL: urlMp, MP_WEBHOOK_SECRET: SECRETO_MP,
      TALO_API_URL: urlTalo, TALO_USER_ID: TALO_USUARIO, TALO_CLIENT_ID: TALO_CLIENTE, TALO_CLIENT_SECRET: TALO_SECRETO,
      INTERNO_TOKEN: INTERNO, SITIO_URL: "https://www.isuwaya.test", API_PUBLICA_URL: "https://api.isuwaya.test",
    }),
    pool, redis, colas,
  });
  await app.ready();
  await pool.query(`UPDATE tienda.ajustes SET valor = '{"titular":"ISUWAYA SRL","cuit":"30-00000000-0","banco":"Mercado Pago","cbu":"0000003100000000000001","alias":"ISUWAYA.MP"}' WHERE clave = 'datosTransferencia'`);
  await pool.query("UPDATE tienda.ajustes SET valor = 'null' WHERE clave = 'envioGratisDesde'");
  await pool.query("UPDATE tienda.ajustes SET valor = '0' WHERE clave = 'montoMinimoCarrito'");
  await limpiar();
});
afterAll(async () => {
  await limpiar();
  await ajuste(false, false);
  await pool.query("DELETE FROM tienda.productos WHERE stocker_id >= $1 AND stocker_id < $2", [BASE, BASE + 100]);
  await pool.query(`UPDATE tienda.ajustes SET valor = '{"titular":"","cuit":"","banco":"","cbu":"","alias":""}' WHERE clave = 'datosTransferencia'`);
  await app.close();
  for (const s of servidores) await new Promise<void>((r) => s.close(() => r()));
  await redis.quit();
  await pool.end();
});
beforeEach(async () => {
  const k = await redis.keys("isu:*");
  if (k.length) await redis.del(...k);
  await cargarCatalogo();
});

const post = (url: string, payload: unknown, headers: Record<string, string> = {}) => app.inject({ method: "POST", url, payload: payload as object, headers });
const get = (url: string, headers: Record<string, string> = {}) => app.inject({ method: "GET", url, headers });
let n = 0;
async function comprar(cantidad = 2) {
  n++;
  const r = await post("/v1/pedidos", {
    items: [{ sku: "QA-T-M", cantidad }], medioPago: "transferencia", aceptaTerminos: true,
    contacto: { email: `qa-transf-${n}@test.com`, nombre: "Ana", apellido: "Transfer", telefono: "11 5555-1234", dni: "30111222" },
    entrega: { tipo: "retiro", local: "Vía Flores · Local 21" },
  });
  expect(r.statusCode, r.body).toBe(201);
  const { numero, acceso } = r.json();
  const ver = async () => (await get(`/v1/pedidos/${numero}`, { "x-isu-acceso": acceso })).json();
  return { numero: numero as string, acceso: acceso as string, ver };
}
const fila = async (numero: string) => (await pool.query("SELECT * FROM tienda.pedidos WHERE numero = $1", [numero])).rows[0];
const vuelta = () => post("/v1/interno/conciliar-transferencias", {}, { "x-isu-interno": INTERNO });
let idMp = 9_100_000_000;
function entraAMp(pesos: number, extra: Record<string, unknown> = {}) {
  const id = String(idMp++);
  mp.pagos.set(id, {
    id: Number(id), status: "approved", status_detail: "accredited", external_reference: null, currency_id: "ARS",
    transaction_amount: pesos, payment_type_id: "account_money", payment_method_id: "account_money", operation_type: "money_transfer",
    date_created: new Date().toISOString(), date_approved: new Date().toISOString(),
    payer: { first_name: "Carla", last_name: "Pérez", identification: { type: "CUIT", number: "27-30111222-4" } }, ...extra,
  });
  return id;
}
function firmar(dataId: string, rid = "req-t", ts = Math.floor(Date.now() / 1000)) {
  const v1 = createHmac("sha256", SECRETO_MP).update(`id:${dataId};request-id:${rid};ts:${ts};`).digest("hex");
  return { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": rid };
}
function taloRecibe(pagoId: string, pesos: number, estado: string) {
  const p = talo.pagos.get(pagoId)!;
  p.transactions.push({
    amount: String(pesos), currency: "ARS", creation_timestamp: new Date().toISOString(), address: p.quotes[0]!.cvu,
    transaction_data: { PROCESSED: { amount: pesos, trxId: `qa-trx-${pagoId}-${p.transactions.length}`, senderCuit: "20301112224", senderTitular: "Carolina Perez" } },
  });
  p.payment_status = estado;
}

describe("apagado", () => {
  it("transferencia como siempre: los datos de Ajustes, el total, y se confirma a mano", async () => {
    await ajuste(false, false);
    const { numero, ver } = await comprar();
    const t = (await ver()).pago.transferencia;
    expect(t).toMatchObject({ alias: "ISUWAYA.MP", monto: 1_600_000, via: "cuenta", automatica: false });
    expect((await fila(numero)).transferencia_via).toBe("cuenta");
    expect(talo.creados.length).toBe(0);
  });
});

describe("Talo: un CVU por pedido", () => {
  beforeEach(async () => { await ajuste(true, false); talo.caido = false; });

  it("cada pedido tiene su CVU y alias por el monto exacto; el mail los trae", async () => {
    const a = await comprar();
    const b = await comprar();
    const ta = (await a.ver()).pago.transferencia;
    const tb = (await b.ver()).pago.transferencia;
    expect(ta).toMatchObject({ via: "talo", automatica: true, monto: 1_600_000, titular: "" });
    expect(ta.cbu).toMatch(/^\d{22}$/);
    expect(ta.cbu).not.toBe(tb.cbu);
    const pedido = talo.creados.at(-2)!;
    expect(pedido).toMatchObject({
      user_id: TALO_USUARIO, price: { amount: 16_000, currency: "ARS" }, payment_options: ["transfer"], external_id: a.numero,
      webhook_url: "https://api.isuwaya.test/v1/pagos/talo/aviso", client_data: { email: expect.stringMatching(/^qa-transf-/) },
    });
    const mail = enviados.filter((e) => e.nombre === "pedido_recibido").find((e) => e.datos.numero === a.numero)!;
    expect(mail.datos.transferencia).toMatchObject({ via: "talo", cbu: ta.cbu, monto: 1_600_000 });
  });

  it("aviso con un id que no es de la tienda, o sin id: no se le pregunta nada a Talo", async () => {
    const antes = talo.consultas;
    expect((await post("/v1/pagos/talo/aviso", { paymentId: "VAR-inventado-123" })).json()).toMatchObject({ ignorado: "ajeno" });
    expect((await post("/v1/pagos/talo/aviso", { paymentId: "../../etc/passwd" })).json()).toMatchObject({ ignorado: "sin_id" });
    expect((await post("/v1/pagos/talo/aviso", {})).json()).toMatchObject({ ignorado: "sin_id" });
    expect(talo.consultas).toBe(antes);
  });

  it("llega la transferencia: el aviso confirma el pedido (preguntándole a Talo); repetido no cobra dos veces", async () => {
    const { numero, ver } = await comprar();
    const id = (await fila(numero)).talo_pago as string;
    // El aviso solo no alcanza: Talo todavía dice PENDING.
    expect((await post("/v1/pagos/talo/aviso", { message: "Pago Actualizado", paymentId: id, externalId: numero })).statusCode).toBe(200);
    expect((await fila(numero)).estado).toBe("esperando_transferencia");
    taloRecibe(id, 16_000, "SUCCESS");
    await post("/v1/pagos/talo/aviso", { message: "Pago Actualizado", paymentId: id, externalId: numero });
    expect((await ver()).estado).toBe("pagado");
    await post("/v1/pagos/talo/aviso", { message: "Pago Actualizado", paymentId: id, externalId: numero });
    const pagos = await pool.query("SELECT p.proveedor, p.externo, p.estado, p.monto FROM tienda.pagos p JOIN tienda.pedidos x ON x.id = p.pedido_id WHERE x.numero = $1", [numero]);
    expect(pagos.rows).toEqual([{ proveedor: "transferencia", externo: `talo:${id}`, estado: "aprobado", monto: 1_600_000 }]);
    const t = await pool.query("SELECT estado, monto, pagador, pagador_cuit FROM tienda.transferencias_recibidas WHERE via = 'talo' AND externo LIKE $1", [`qa-trx-${id}-%`]);
    expect(t.rows).toEqual([{ estado: "aplicada", monto: 1_600_000, pagador: "Carolina Perez", pagador_cuit: "20301112224" }]);
    expect(enviados.some((e) => e.nombre === "pagado" && e.datos.numero === numero)).toBe(true);
  });

  it("de menos: no se confirma y queda para revisar; cuando completa, se confirma", async () => {
    const { numero } = await comprar();
    const id = (await fila(numero)).talo_pago as string;
    taloRecibe(id, 10_000, "UNDERPAID");
    expect((await vuelta()).json().talo.revisados).toBeGreaterThanOrEqual(1);
    expect((await fila(numero)).estado).toBe("esperando_transferencia");
    const t1 = await pool.query("SELECT estado FROM tienda.transferencias_recibidas WHERE externo = $1", [`qa-trx-${id}-0`]);
    expect(t1.rows[0].estado).toBe("monto_distinto");
    const ev = await pool.query("SELECT detalle FROM tienda.pedido_eventos e JOIN tienda.pedidos p ON p.id = e.pedido_id WHERE p.numero = $1 AND e.actor = 'talo'", [numero]);
    expect(ev.rows.map((r) => r.detalle).join(" ")).toMatch(/falta/);
    // Una segunda vuelta no repite el aviso.
    await vuelta();
    expect((await pool.query("SELECT count(*)::int AS n FROM tienda.pedido_eventos e JOIN tienda.pedidos p ON p.id = e.pedido_id WHERE p.numero = $1 AND e.actor = 'talo'", [numero])).rows[0].n).toBe(1);
    taloRecibe(id, 6_000, "SUCCESS");
    await vuelta();
    expect((await fila(numero)).estado).toBe("pagado");
    const t2 = await pool.query("SELECT estado FROM tienda.transferencias_recibidas WHERE externo LIKE $1 ORDER BY externo", [`qa-trx-${id}-%`]);
    expect(t2.rows.map((r) => r.estado)).toEqual(["aplicada", "aplicada"]);
  });

  it("un pago de Talo que dice ser de otro pedido no se aplica", async () => {
    const { numero } = await comprar();
    const id = (await fila(numero)).talo_pago as string;
    taloRecibe(id, 16_000, "SUCCESS");
    talo.pagos.get(id)!.external_id = "ISU-99999999";
    await post("/v1/pagos/talo/aviso", { paymentId: id });
    expect((await fila(numero)).estado).toBe("esperando_transferencia");
  });

  it("si Talo vence el token, se pide otro y sigue", async () => {
    const { numero } = await comprar();
    const id = (await fila(numero)).talo_pago as string;
    taloRecibe(id, 16_000, "SUCCESS");
    const tokens = talo.tokens;
    talo.tokenVencido = true;
    await vuelta();
    expect(talo.tokens).toBe(tokens + 1);
    expect((await fila(numero)).estado).toBe("pagado");
  });

  it("Talo caído al crear el pedido: el pedido sale igual, con los datos de Ajustes (o el monto con centavos si MP está prendido)", async () => {
    talo.caido = true;
    const a = await comprar();
    expect((await a.ver()).pago.transferencia).toMatchObject({ via: "cuenta", alias: "ISUWAYA.MP", automatica: false });
    await ajuste(true, true);
    const b = await comprar();
    const t = (await b.ver()).pago.transferencia;
    expect(t.via).toBe("mercadopago");
    expect(t.monto).toBeGreaterThan(1_600_000);
    const ev = await pool.query("SELECT detalle FROM tienda.pedido_eventos e JOIN tienda.pedidos p ON p.id = e.pedido_id WHERE p.numero = $1 AND e.actor = 'talo'", [b.numero]);
    expect(ev.rows[0].detalle).toMatch(/Talo no respondió/);
    talo.caido = false;
  });
});

describe("Mercado Pago: alias de la cuenta con centavos únicos", () => {
  beforeEach(async () => { await ajuste(false, true); });

  it("dos pedidos del mismo total piden montos distintos (de 1 a 99 centavos más)", async () => {
    const a = await comprar();
    const b = await comprar();
    const [ma, mb] = [(await a.ver()).pago.transferencia, (await b.ver()).pago.transferencia];
    expect([ma.via, ma.automatica, ma.alias]).toEqual(["mercadopago", true, "ISUWAYA.MP"]);
    expect(ma.monto).not.toBe(mb.monto);
    for (const m of [ma.monto, mb.monto]) { expect(m).toBeGreaterThan(1_600_000); expect(m).toBeLessThan(1_600_100); }
  });

  it("la vuelta del worker: el monto exacto confirma; sin centavos queda sin pedido; ventas del local y cobros con tarjeta no se tocan", async () => {
    const { numero } = await comprar();
    const monto = (await fila(numero)).transferencia_monto as number;
    const exacta = entraAMp(monto / 100);
    const redonda = entraAMp(16_000);
    const local = entraAMp(monto / 100, { operation_type: "pos_payment" });
    const tarjeta = entraAMp(monto / 100, { payment_type_id: "credit_card", operation_type: "regular_payment" });
    expect((await vuelta()).json().mercadoPago.pagados).toBe(1);
    expect((await fila(numero)).estado).toBe("pagado");
    const t = await pool.query("SELECT externo, estado, pagador, pagador_cuit FROM tienda.transferencias_recibidas WHERE via = 'mercadopago' AND externo = ANY($1::text[]) ORDER BY externo", [[exacta, redonda, local, tarjeta]]);
    expect(t.rows).toEqual([
      { externo: exacta, estado: "aplicada", pagador: "Carla Pérez", pagador_cuit: "27301112224" },
      { externo: redonda, estado: "sin_pedido", pagador: "Carla Pérez", pagador_cuit: "27301112224" },
    ]);
    const pago = await pool.query("SELECT p.externo, p.monto FROM tienda.pagos p JOIN tienda.pedidos x ON x.id = p.pedido_id WHERE x.numero = $1", [numero]);
    expect(pago.rows).toEqual([{ externo: `mp:${exacta}`, monto }]);
    // Otra vuelta: nada nuevo, nada doble.
    await vuelta();
    expect((await pool.query("SELECT count(*)::int AS n FROM tienda.pagos p JOIN tienda.pedidos x ON x.id = p.pedido_id WHERE x.numero = $1", [numero])).rows[0].n).toBe(1);
  });

  it("el aviso de Mercado Pago de una transferencia (sin número de pedido) también la confirma", async () => {
    const { numero } = await comprar();
    const id = entraAMp((await fila(numero)).transferencia_monto / 100);
    const r = await app.inject({ method: "POST", url: `/v1/pagos/mercadopago/aviso?type=payment&data.id=${id}`, payload: { type: "payment", data: { id } }, headers: firmar(id) });
    expect(r.json()).toMatchObject({ ok: true, aplicado: true });
    expect((await fila(numero)).estado).toBe("pagado");
  });

  it("con la página del pedido abierta se mira solo (y no más de una vez cada 20 s)", async () => {
    const { numero, ver } = await comprar();
    expect((await ver()).estado).toBe("esperando_transferencia");
    entraAMp((await fila(numero)).transferencia_monto / 100);
    // La consulta de recién (al ver el pedido) ya contó: hasta que pasen 20 s no se vuelve a buscar.
    expect((await ver()).estado).toBe("esperando_transferencia");
    await redis.del("isu:consulta-mp-cuenta");
    const antes = mp.busquedas;
    expect((await ver()).estado).toBe("pagado");
    expect(mp.busquedas).toBe(antes + 1);
  });

  it("antes de vencer un pedido se mira si la transferencia llegó", async () => {
    const { numero } = await comprar();
    entraAMp((await fila(numero)).transferencia_monto / 100);
    await pool.query("UPDATE tienda.pedidos SET vence_en = now() - interval '1 minute' WHERE numero = $1", [numero]);
    await post("/v1/interno/vencer", {}, { "x-isu-interno": INTERNO });
    expect((await fila(numero)).estado).toBe("pagado");
  });

  it("apagar el ajuste no deja colgados a los pedidos que ya pidieron el monto con centavos", async () => {
    const { numero } = await comprar();
    await ajuste(false, false);
    // Los pedidos nuevos ya no piden centavos…
    expect((await (await comprar()).ver()).pago.transferencia.via).toBe("cuenta");
    // …pero el que ya los pidió se sigue confirmando solo.
    entraAMp((await fila(numero)).transferencia_monto / 100);
    expect((await vuelta()).json().mercadoPago.pagados).toBe(1);
    expect((await fila(numero)).estado).toBe("pagado");
  });

  it("sin pedidos esperando una transferencia a la cuenta, lo que entra ni se mira ni se anota", async () => {
    await ajuste(false, false);
    await pool.query("UPDATE tienda.pedidos SET estado = 'cancelado' WHERE email LIKE 'qa-transf%' AND estado IN ('esperando_transferencia', 'transferencia_informada')");
    const busquedas = mp.busquedas;
    expect((await vuelta()).json().mercadoPago.revisados).toBe(0);
    expect(mp.busquedas).toBe(busquedas);
    const id = entraAMp(1234.56);
    const r = await app.inject({ method: "POST", url: `/v1/pagos/mercadopago/aviso?type=payment&data.id=${id}`, payload: { type: "payment", data: { id } }, headers: firmar(id) });
    expect(r.json().aplicado).toBe(false);
    expect((await pool.query("SELECT 1 FROM tienda.transferencias_recibidas WHERE externo = $1", [id])).rowCount).toBe(0);
  });
});
