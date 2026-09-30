import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createHmac } from "node:crypto";
import { mkdtemp, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { Redis } from "ioredis";
import { crearPool, migrar } from "@isu/db";
import { construirApp } from "../src/app.js";
import { leerEntorno } from "../src/entorno.js";
import type { Colas } from "../src/lib/colas.js";
import { firmaValida } from "../src/lib/mercadopago.js";

/*
 * Etapa 2 de punta a punta en la API: cuentas, carrito, pedido, pagos.
 * Stocker y Mercado Pago son simuladores en este mismo proceso: así se
 * puede probar "otro canal vendió la última", "Stocker caído" o "Mercado
 * Pago avisa dos veces" sin depender de nadie.
 */
const DB = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:5433/stocker_test";
const REDIS = process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6380/7";
const BASE = 7_400_000;
const SECRETO_MP = "secreto-de-prueba-de-mercado-pago";
const PAGOS = "p".repeat(40);
const INTERNO = "i".repeat(40);

const pool = crearPool({ url: DB, max: 6 });
const redis = new Redis(REDIS, { maxRetriesPerRequest: 1 });
let app: Awaited<ReturnType<typeof construirApp>>;

// ── Colas de mentira: se anota qué se mandó ──
const enviados: Array<{ tipo: string; nombre: string; datos: Record<string, unknown> }> = [];
const colas: Colas = {
  async email(plantilla, para, datos) { enviados.push({ tipo: "email", nombre: plantilla, datos: { ...datos, para } }); },
  async stocker(nombre, datos) { enviados.push({ tipo: "stocker", nombre, datos }); },
  async cerrar() {},
};
const mails = (plantilla: string) => enviados.filter((e) => e.tipo === "email" && e.nombre === plantilla);

// ── Stocker simulado ──
const stocker = {
  pedidos: new Map<string, { estado: string; pagoPendiente: boolean; items: Array<{ sku: string; cantidad: number }> }>(),
  stock: new Map<string, number>(),
  caido: false,
};
// ── Mercado Pago simulado ──
const mp = { preferencias: [] as Array<Record<string, unknown>>, pagos: new Map<string, Record<string, unknown>>(), caido: false };

const servidores: http.Server[] = [];
async function levantar(h: http.RequestListener) {
  const s = http.createServer(h);
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  servidores.push(s);
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}
const leerCuerpo = async (req: http.IncomingMessage) => { let b = ""; for await (const c of req) b += c; return b ? JSON.parse(b) : {}; };
const json = (res: http.ServerResponse, status: number, cuerpo: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(cuerpo)); };
const resumen = (n: string) => { const p = stocker.pedidos.get(n)!; return { id: 1, pedido: n, estado: p.estado, pagoPendiente: p.pagoPendiente, estadoEnvio: null, despachadoEn: null, canceladoEn: null, motivo: null }; };

async function fotoPrueba() { return sharp({ create: { width: 800, height: 600, channels: 3, background: "#fff" } }).jpeg().toBuffer(); }

let urlStocker = "", urlMp = "", dirComp = "";

async function cargarCatalogo() {
  await pool.query("DELETE FROM tienda.productos WHERE stocker_id >= $1 AND stocker_id < $2", [BASE, BASE + 100]);
  const p = await pool.query("INSERT INTO tienda.productos (stocker_id, stocker_padre, nombre, slug, visible) VALUES ($1,'QA-C','Remera compra','qa-remera-compra',true) RETURNING id", [BASE + 1]);
  const c = await pool.query("INSERT INTO tienda.producto_colores (producto_id, clave, nombre) VALUES ($1,'negro','Negro') RETURNING id", [p.rows[0].id]);
  const v = async (sku: string, talle: string, precio: number, stock: number, sid: number) =>
    pool.query("INSERT INTO tienda.variantes (producto_id, color_id, stocker_id, sku, talle, precio, stock) VALUES ($1,$2,$3,$4,$5,$6,$7)", [p.rows[0].id, c.rows[0].id, sid, sku, talle, precio, stock]);
  await v("QA-C-M", "M", 1_000_000, 5, BASE * 10 + 1);   // $10.000
  await v("QA-C-L", "L", 1_200_000, 1, BASE * 10 + 2);   // $12.000
  await v("QA-C-XL", "XL", 1_200_000, 0, BASE * 10 + 3);
  stocker.stock = new Map([["QA-C-M", 5], ["QA-C-L", 1], ["QA-C-XL", 0]]);
}
const limpiarPedidos = async () => {
  await pool.query("DELETE FROM tienda.arrepentimientos WHERE email LIKE 'qa-compra%'");
  await pool.query("DELETE FROM tienda.pedidos WHERE email LIKE 'qa-compra%'");
  await pool.query("DELETE FROM tienda.clientes WHERE email LIKE 'qa-compra%'");
};

beforeAll(async () => {
  await migrar(pool);
  await redis.flushdb();
  urlStocker = await levantar(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${"s".repeat(30)}`) return json(res, 401, { message: "Credencial inválida." });
    if (stocker.caido) { req.socket.destroy(); return; }
    const u = new URL(req.url!, "http://x");
    const b = req.method === "GET" ? {} : await leerCuerpo(req);
    // eslint-disable-next-line security/detect-unsafe-regex -- ruta del simulador, texto controlado por la prueba
    const m = u.pathname.match(/^\/api\/integraciones\/tienda\/pedidos(?:\/([^/]+))?(?:\/(pagado|cancelar))?$/);
    if (u.pathname.endsWith("/clientes")) return json(res, 200, { id: 1, nuevo: true });
    if (!m) return json(res, 404, { message: "No existe." });
    const [, numero, accion] = m;
    if (!numero && req.method === "POST") {
      if (stocker.pedidos.has(b.pedido)) return json(res, 200, { ...resumen(b.pedido), repetido: true });
      const faltan = b.items.filter((i: { sku: string; cantidad: number }) => (stocker.stock.get(i.sku) ?? 0) < i.cantidad);
      if (faltan.length) {
        return json(res, 200, { id: 2, pedido: b.pedido, estado: "rechazado", pagoPendiente: true, estadoEnvio: null, despachadoEn: null, canceladoEn: null, motivo: "sin stock",
          faltantes: faltan.map((i: { sku: string; cantidad: number }) => ({ sku: i.sku, pedido: i.cantidad, hay: stocker.stock.get(i.sku) ?? 0 })) });
      }
      for (const i of b.items) stocker.stock.set(i.sku, stocker.stock.get(i.sku)! - i.cantidad);
      stocker.pedidos.set(b.pedido, { estado: "aceptado", pagoPendiente: b.pagoPendiente, items: b.items });
      return json(res, 200, { ...resumen(b.pedido), repetido: false });
    }
    const p = stocker.pedidos.get(numero!);
    if (!p) return json(res, 404, { message: "Ese pedido no existe." });
    if (accion === "pagado") {
      if (p.estado === "cancelado") return json(res, 409, { message: "cancelado", codigo: "PEDIDO_CANCELADO" });
      p.pagoPendiente = false;
    }
    if (accion === "cancelar" && p.estado !== "cancelado") {
      p.estado = "cancelado";
      for (const i of p.items) stocker.stock.set(i.sku, stocker.stock.get(i.sku)! + i.cantidad);
    }
    return json(res, 200, resumen(numero!));
  });
  urlMp = await levantar(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${"m".repeat(30)}`) return json(res, 401, {});
    if (mp.caido) return json(res, 500, {});
    const u = new URL(req.url!, "http://x");
    if (u.pathname === "/checkout/preferences" && req.method === "POST") {
      const b = await leerCuerpo(req);
      mp.preferencias.push(b);
      return json(res, 201, { id: `pref-${mp.preferencias.length}`, init_point: `https://mp.test/checkout?pref=${mp.preferencias.length}` });
    }
    const pm = u.pathname.match(/^\/v1\/payments\/(\d+)$/);
    if (pm) return mp.pagos.has(pm[1]!) ? json(res, 200, mp.pagos.get(pm[1]!)) : json(res, 404, {});
    if (u.pathname === "/v1/payments/search") {
      const ref = u.searchParams.get("external_reference");
      return json(res, 200, { results: [...mp.pagos.values()].filter((p) => p.external_reference === ref) });
    }
    return json(res, 404, {});
  });
  dirComp = await mkdtemp(path.join(os.tmpdir(), "comp-"));
  app = await construirApp({
    env: leerEntorno({
      NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: DB, REDIS_URL: REDIS, CACHE_SEGUNDOS: "0",
      STOCKER_API_URL: urlStocker, STOCKER_TOKEN: "s".repeat(30),
      MP_ACCESS_TOKEN: "m".repeat(30), MP_API_URL: urlMp, MP_WEBHOOK_SECRET: SECRETO_MP,
      PAGOS_TOKEN: PAGOS, INTERNO_TOKEN: INTERNO, COMPROBANTES_DIR: dirComp,
      SITIO_URL: "https://www.isuwaya.test", API_PUBLICA_URL: "https://api.isuwaya.test",
    }),
    pool, redis, colas,
  });
  await app.ready();
  await pool.query(`UPDATE tienda.ajustes SET valor = '{"titular":"ISUWAYA SRL","cuit":"30-00000000-0","banco":"Banco QA","cbu":"0000000000000000000000","alias":"ISUWAYA.QA"}' WHERE clave = 'datosTransferencia'`);
  await pool.query("UPDATE tienda.ajustes SET valor = '2000000' WHERE clave = 'envioGratisDesde'");
  await pool.query("UPDATE tienda.ajustes SET valor = '0' WHERE clave = 'montoMinimoCarrito'");
  await cargarCatalogo();
  await limpiarPedidos();
});
afterAll(async () => {
  await limpiarPedidos();
  await pool.query("DELETE FROM tienda.productos WHERE stocker_id >= $1 AND stocker_id < $2", [BASE, BASE + 100]);
  await pool.query("UPDATE tienda.ajustes SET valor = 'null' WHERE clave = 'envioGratisDesde'");
  await pool.query(`UPDATE tienda.ajustes SET valor = '{"titular":"","cuit":"","banco":"","cbu":"","alias":""}' WHERE clave = 'datosTransferencia'`);
  await app.close();
  for (const s of servidores) await new Promise<void>((r) => s.close(() => r()));
  await redis.quit();
  await pool.end();
});

const post = (url: string, payload: unknown, headers: Record<string, string> = {}) => app.inject({ method: "POST", url, payload: payload as object, headers });
const get = (url: string, headers: Record<string, string> = {}) => app.inject({ method: "GET", url, headers });
const contacto = (n: string) => ({ email: `qa-compra-${n}@test.com`, nombre: "Ana", apellido: "Compra", telefono: "11 5555-1234", dni: "30111222" });
const pedido = (n: string, extra: Record<string, unknown> = {}) => ({
  items: [{ sku: "QA-C-M", cantidad: 2 }], contacto: contacto(n), entrega: { tipo: "retiro", local: "Vía Flores · Local 21" },
  medioPago: "transferencia", aceptaTerminos: true, ...extra,
});
function firmar(dataId: string, rid = "req-1", ts = Math.floor(Date.now() / 1000)) {
  const v1 = createHmac("sha256", SECRETO_MP).update(`id:${dataId};request-id:${rid};ts:${ts};`).digest("hex");
  return { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": rid };
}

// Los frenos anti-abuso se prueban aparte: acá la prueba crea decenas de pedidos desde la misma IP.
beforeEach(async () => { const k = await redis.keys("isu:freno:*"); if (k.length) await redis.del(...k); });

describe("cuentas", () => {
  let token = "";
  it("registro: crea la cuenta y la sesión; la contraseña no viaja ni queda en claro", async () => {
    const r = await post("/v1/cuenta/registro", { email: "QA-Compra-Uno@Test.com", contrasena: "clave-segura-1", nombre: "Ana", apellido: "Uno" });
    expect(r.statusCode, r.body).toBe(201);
    token = r.json().token;
    expect(r.json().cliente.email).toBe("qa-compra-uno@test.com");
    expect(r.body).not.toContain("clave-segura-1");
    const { rows } = await pool.query("SELECT hash FROM tienda.clientes WHERE email = 'qa-compra-uno@test.com'");
    expect(rows[0].hash).toMatch(/^\$argon2id\$/);
    const s = await pool.query("SELECT s.id FROM tienda.sesiones s JOIN tienda.clientes c ON c.id = s.cliente_id WHERE c.email = 'qa-compra-uno@test.com'");
    expect(s.rows[0].id).not.toBe(token); // en la base sólo el hash
    expect(mails("bienvenida").length).toBeGreaterThan(0);
  });
  it("el mismo email no se registra dos veces", async () => {
    expect((await post("/v1/cuenta/registro", { email: "qa-compra-uno@test.com", contrasena: "otra-clave-12", nombre: "Xavi", apellido: "Ye" })).statusCode).toBe(409);
  });
  it("ingresar: bien, y mismo mensaje para email inexistente o clave equivocada", async () => {
    expect((await post("/v1/cuenta/ingresar", { email: "qa-compra-uno@test.com", contrasena: "clave-segura-1" })).statusCode).toBe(200);
    const a = await post("/v1/cuenta/ingresar", { email: "qa-compra-uno@test.com", contrasena: "mala" });
    const b = await post("/v1/cuenta/ingresar", { email: "qa-compra-nadie@test.com", contrasena: "mala" });
    expect([a.statusCode, b.statusCode]).toEqual([401, 401]);
    expect(a.json().mensaje).toBe(b.json().mensaje);
  });
  it("con sesión ve su cuenta; sin sesión o con una inventada, no", async () => {
    expect((await get("/v1/cuenta", { "x-isu-sesion": token })).json().cliente.nombre).toBe("Ana");
    expect((await get("/v1/cuenta")).statusCode).toBe(401);
    expect((await get("/v1/cuenta", { "x-isu-sesion": "x".repeat(43) })).statusCode).toBe(401);
    expect((await get("/v1/cuenta", { "x-isu-sesion": "' OR 1=1 --" })).statusCode).toBe(401);
  });
  it("editar datos no deja tocar el email ni campos de más", async () => {
    const r = await app.inject({ method: "PATCH", url: "/v1/cuenta", headers: { "x-isu-sesion": token }, payload: { nombre: "Ana María", apellido: "Uno", email: "otro@x.com" } });
    expect(r.statusCode).toBe(400);
    const ok = await app.inject({ method: "PATCH", url: "/v1/cuenta", headers: { "x-isu-sesion": token }, payload: { nombre: "Ana María", apellido: "Uno", telefono: "11 4444-5555" } });
    expect(ok.json().cliente).toMatchObject({ nombre: "Ana María", telefono: "11 4444-5555", email: "qa-compra-uno@test.com" });
  });
  it("cambiar la contraseña cierra las otras sesiones", async () => {
    const otra = (await post("/v1/cuenta/ingresar", { email: "qa-compra-uno@test.com", contrasena: "clave-segura-1" })).json().token;
    expect((await post("/v1/cuenta/contrasena", { actual: "clave-segura-1", nueva: "clave-nueva-22" }, { "x-isu-sesion": token })).statusCode).toBe(204);
    expect((await get("/v1/cuenta", { "x-isu-sesion": otra })).statusCode).toBe(401);
    expect((await get("/v1/cuenta", { "x-isu-sesion": token })).statusCode).toBe(200);
  });
  it("olvidé mi contraseña: misma respuesta exista o no; el enlace sirve una vez", async () => {
    enviados.length = 0;
    const a = await post("/v1/cuenta/olvide", { email: "qa-compra-uno@test.com" });
    const b = await post("/v1/cuenta/olvide", { email: "qa-compra-nadie@test.com" });
    expect([a.statusCode, b.statusCode, a.body === b.body]).toEqual([202, 202, true]);
    expect(mails("restablecer")).toHaveLength(1);
    const enlace = String(mails("restablecer")[0]!.datos.enlace);
    expect(enlace).toMatch(/^https:\/\/www\.isuwaya\.test\/cuenta\/restablecer#t=/); // en el fragmento: no llega a ningún log
    const t = enlace.split("#t=")[1]!;
    const r = await post("/v1/cuenta/restablecer", { token: t, contrasena: "clave-tercera-3" });
    expect(r.statusCode).toBe(200);
    expect((await post("/v1/cuenta/restablecer", { token: t, contrasena: "clave-cuarta-44" })).statusCode).toBe(400);
    expect((await get("/v1/cuenta", { "x-isu-sesion": token })).statusCode).toBe(401); // se cerraron las sesiones viejas
  });
  it("10 intentos fallidos bloquean la cuenta (aunque la clave después sea la correcta)", async () => {
    await post("/v1/cuenta/registro", { email: "qa-compra-bloq@test.com", contrasena: "clave-segura-1", nombre: "Bea", apellido: "Qu" });
    await redis.del("isu:freno:ingresar-email:" + (await import("../src/lib/cripto.js")).sha256("qa-compra-bloq@test.com"));
    for (let i = 0; i < 10; i++) await post("/v1/cuenta/ingresar", { email: "qa-compra-bloq@test.com", contrasena: `mala-${i}` });
    expect((await post("/v1/cuenta/ingresar", { email: "qa-compra-bloq@test.com", contrasena: "clave-segura-1" })).statusCode).toBe(423);
  });
  it("quien compró sin cuenta no puede «registrarse» con su email: tiene que confirmarlo", async () => {
    await pool.query("INSERT INTO tienda.clientes (email, nombre) VALUES ('qa-compra-invitada@test.com', 'Invi')");
    enviados.length = 0;
    const r = await post("/v1/cuenta/registro", { email: "qa-compra-invitada@test.com", contrasena: "clave-de-otro-1", nombre: "Otro", apellido: "Xu" });
    expect([r.statusCode, r.json().error]).toEqual([409, "confirmar_email"]);
    const { rows } = await pool.query("SELECT hash FROM tienda.clientes WHERE email = 'qa-compra-invitada@test.com'");
    expect(rows[0].hash).toBeNull();
    expect(mails("restablecer")[0]?.datos.para).toBe("qa-compra-invitada@test.com");
  });
});

describe("carrito", () => {
  it("el precio lo pone la tienda; el mismo SKU se suma; avisa lo que falta", async () => {
    const r = await post("/v1/carrito", { items: [{ sku: "QA-C-M", cantidad: 1 }, { sku: "QA-C-M", cantidad: 1 }, { sku: "QA-C-XL", cantidad: 1 }, { sku: "NO-EXISTE", cantidad: 1 }] });
    const c = r.json();
    expect(c.lineas.find((l: { sku: string }) => l.sku === "QA-C-M")).toMatchObject({ cantidad: 2, precio: 1_000_000, subtotal: 2_000_000 });
    expect(c.subtotal).toBe(2_000_000);
    expect(c.problemas.map((p: { tipo: string }) => p.tipo).sort()).toEqual(["no_existe", "sin_stock"]);
  });
  it("un precio mandado por el navegador ni siquiera entra", async () => {
    expect((await post("/v1/carrito", { items: [{ sku: "QA-C-M", cantidad: 1, precio: 1 }] })).statusCode).toBe(400);
  });
  it("transferencia: 20% menos; envío gratis desde $20.000 (sobre lo que se paga)", async () => {
    const t = (await post("/v1/carrito", { items: [{ sku: "QA-C-M", cantidad: 2 }], entrega: "envio", medioPago: "transferencia" })).json();
    expect([t.subtotal, t.descuento, t.envio]).toEqual([2_000_000, 400_000, 790_000]); // $16.000 < $20.000: paga envío
    const m = (await post("/v1/carrito", { items: [{ sku: "QA-C-M", cantidad: 2 }], entrega: "envio", medioPago: "mercadopago" })).json();
    expect([m.descuento, m.envio, m.total]).toEqual([0, 0, 2_000_000]);
  });
  it("cantidades raras → 400", async () => {
    for (const cantidad of [0, -1, 1.5, 21, "2"]) expect((await post("/v1/carrito", { items: [{ sku: "QA-C-M", cantidad }] })).statusCode).toBe(400);
  });
});

describe("pedidos", () => {
  beforeEach(async () => { await cargarCatalogo(); });

  it("transferencia: aparta en Stocker (sin pagar) y da los datos para transferir", async () => {
    const r = await post("/v1/pedidos", pedido("t1"));
    expect(r.statusCode).toBe(201);
    const { numero, acceso, estado, redirigir } = r.json();
    expect([estado, redirigir]).toEqual(["esperando_transferencia", null]);
    expect(stocker.pedidos.get(numero)).toMatchObject({ estado: "aceptado", pagoPendiente: true });
    const v = (await get(`/v1/pedidos/${numero}`, { "x-isu-acceso": acceso })).json();
    expect([v.subtotal, v.descuento, v.total]).toEqual([2_000_000, 400_000, 1_600_000]);
    expect(v.pago.transferencia.alias).toBe("ISUWAYA.QA");
    expect(mails("pedido_recibido").at(-1)?.datos.numero).toBe(numero);
  });

  it("nadie más ve el pedido: otro token, otra sesión o sin nada → 404", async () => {
    const { numero } = (await post("/v1/pedidos", pedido("t2"))).json();
    expect((await get(`/v1/pedidos/${numero}`)).statusCode).toBe(404);
    expect((await get(`/v1/pedidos/${numero}`, { "x-isu-acceso": "a".repeat(32) })).statusCode).toBe(404);
    const otro = (await post("/v1/cuenta/registro", { email: "qa-compra-otro@test.com", contrasena: "clave-segura-1", nombre: "Otto", apellido: "Te" })).json().token;
    expect((await get(`/v1/pedidos/${numero}`, { "x-isu-sesion": otro })).statusCode).toBe(404);
    expect((await get("/v1/pedidos/ISU-999999")).statusCode).toBe(404);
  });

  it("con sesión, el pedido queda en su cuenta", async () => {
    const t = (await post("/v1/cuenta/registro", { email: "qa-compra-cuenta@test.com", contrasena: "clave-segura-1", nombre: "Cata", apellido: "Us" })).json().token;
    const { numero } = (await post("/v1/pedidos", { ...pedido("cuenta") }, { "x-isu-sesion": t })).json();
    expect((await get("/v1/cuenta", { "x-isu-sesion": t })).json().pedidos.map((p: { numero: string }) => p.numero)).toContain(numero);
    expect((await get(`/v1/pedidos/${numero}`, { "x-isu-sesion": t })).statusCode).toBe(200);
  });

  it("otro canal vendió la última: 409 con qué faltó, y la tienda pide el stock nuevo", async () => {
    stocker.stock.set("QA-C-L", 0); // la tienda todavía cree que hay 1
    enviados.length = 0;
    const r = await post("/v1/pedidos", pedido("sinstock", { items: [{ sku: "QA-C-L", cantidad: 1 }] }));
    expect([r.statusCode, r.json().error]).toEqual([409, "sin_stock"]);
    expect(r.json().faltantes).toEqual([{ sku: "QA-C-L", hay: 0, nombre: "Remera compra (L)" }]);
    expect(enviados.some((e) => e.nombre === "stock")).toBe(true);
  });

  it("Stocker caído: 503, no se cobra, y el pedido queda para limpiar", async () => {
    stocker.caido = true;
    try {
      const r = await post("/v1/pedidos", pedido("caido"));
      expect(r.statusCode).toBe(503);
      const { rows } = await pool.query("SELECT estado FROM tienda.pedidos WHERE email = 'qa-compra-caido@test.com'");
      expect(rows[0].estado).toBe("error_reserva");
    } finally { stocker.caido = false; }
  });

  it("reglas: pagar en el local es sólo con retiro; el local tiene que existir; hay que aceptar términos", async () => {
    const env = { tipo: "envio", direccion: { calle: "Bacacay", numero: "3231", cp: "1406", localidad: "CABA", provincia: "CABA" } };
    expect((await post("/v1/pedidos", pedido("r1", { medioPago: "local", entrega: env }))).statusCode).toBe(400);
    expect((await post("/v1/pedidos", pedido("r2", { entrega: { tipo: "retiro", local: "Local inventado" } }))).statusCode).toBe(400);
    expect((await post("/v1/pedidos", pedido("r3", { aceptaTerminos: false }))).statusCode).toBe(400);
    expect((await post("/v1/pedidos", { ...pedido("r4"), total: 1 })).statusCode).toBe(400);
  });

  it("envío a domicilio con Mercado Pago: link de pago con los ítems y el envío a precio de la tienda", async () => {
    const env = { tipo: "envio", direccion: { calle: "Bacacay", numero: "3231", cp: "1406", localidad: "CABA", provincia: "CABA" } };
    const r = await post("/v1/pedidos", pedido("mp1", { medioPago: "mercadopago", entrega: env, items: [{ sku: "QA-C-M", cantidad: 1 }] }));
    expect(r.json().redirigir).toMatch(/^https:\/\/mp\.test\/checkout/);
    const pref = mp.preferencias.at(-1)!;
    expect(pref.items).toEqual([
      { id: "QA-C-M", title: "Remera compra · Negro · M", quantity: 1, unit_price: 10000, currency_id: "ARS" },
      { id: "ENVIO", title: "Envío a domicilio", quantity: 1, unit_price: 7900, currency_id: "ARS" },
    ]);
    expect(pref.external_reference).toBe(r.json().numero);
    expect(pref.notification_url).toBe("https://api.isuwaya.test/v1/pagos/mercadopago/aviso");
    expect(JSON.stringify(pref)).not.toContain(r.json().acceso); // el token de acceso al pedido no viaja a Mercado Pago
  });

  it("Pago Fácil: preferencia sólo en efectivo y con vencimiento", async () => {
    await post("/v1/pedidos", pedido("pf", { medioPago: "pagofacil" }));
    const pref = mp.preferencias.at(-1)! as { payment_methods: { excluded_payment_types: Array<{ id: string }> }; date_of_expiration?: string };
    expect(pref.payment_methods.excluded_payment_types.map((x) => x.id)).toContain("credit_card");
    expect(pref.payment_methods.excluded_payment_types.map((x) => x.id)).not.toContain("ticket");
    expect(pref.date_of_expiration).toBeTruthy();
  });
});

describe("Mercado Pago: aviso de pago", () => {
  let numero = "", acceso = "";
  beforeAll(async () => {
    await cargarCatalogo();
    const r = (await post("/v1/pedidos", pedido("aviso", { medioPago: "mercadopago", items: [{ sku: "QA-C-M", cantidad: 1 }] }))).json();
    numero = r.numero; acceso = r.acceso;
  });

  it("la firma se verifica (y un aviso viejo no sirve)", () => {
    const h = firmar("123");
    expect(firmaValida({ firma: h["x-signature"], requestId: h["x-request-id"], dataId: "123", secreto: SECRETO_MP })).toBe(true);
    expect(firmaValida({ firma: h["x-signature"], requestId: h["x-request-id"], dataId: "124", secreto: SECRETO_MP })).toBe(false);
    const viejo = firmar("123", "req-1", Math.floor(Date.now() / 1000) - 3600);
    expect(firmaValida({ firma: viejo["x-signature"], requestId: "req-1", dataId: "123", secreto: SECRETO_MP })).toBe(false);
  });

  const estado = async () => (await pool.query("SELECT estado FROM tienda.pedidos WHERE numero = $1", [numero])).rows[0].estado;
  it("sin firma o con firma falsa → 401 y no se toca nada", async () => {
    mp.pagos.set("5001", { id: 5001, status: "approved", external_reference: numero, transaction_amount: 10000, currency_id: "ARS" });
    const guardado = mp.pagos.get("5001")!;
    mp.pagos.delete("5001"); // que tampoco lo encuentre preguntando: esto prueba sólo el aviso
    expect((await post("/v1/pagos/mercadopago/aviso?type=payment&data.id=5001", { type: "payment", data: { id: "5001" } })).statusCode).toBe(401);
    expect((await post("/v1/pagos/mercadopago/aviso?type=payment&data.id=5001", {}, { "x-signature": "ts=1,v1=abc", "x-request-id": "x" })).statusCode).toBe(401);
    expect(await estado()).toBe("esperando_pago");
    expect((await get(`/v1/pedidos/${numero}`, { "x-isu-acceso": acceso })).statusCode).toBe(200);
    void guardado;
  });

  it("aviso firmado de un pago que NO cubre el total: no se da por pagado", async () => {
    await redis.del(`isu:consulta-mp:${numero}`);
    mp.pagos.set("5002", { id: 5002, status: "approved", external_reference: numero, transaction_amount: 1, currency_id: "ARS" });
    expect((await post("/v1/pagos/mercadopago/aviso?type=payment&data.id=5002", {}, firmar("5002"))).statusCode).toBe(200);
    expect((await pool.query("SELECT estado FROM tienda.pedidos WHERE numero = $1", [numero])).rows[0].estado).toBe("esperando_pago");
  });

  it("aviso firmado de un pago en dólares: se ignora", async () => {
    mp.pagos.set("5003", { id: 5003, status: "approved", external_reference: numero, transaction_amount: 10000, currency_id: "USD" });
    await post("/v1/pagos/mercadopago/aviso?type=payment&data.id=5003", {}, firmar("5003"));
    expect((await pool.query("SELECT estado FROM tienda.pedidos WHERE numero = $1", [numero])).rows[0].estado).toBe("esperando_pago");
  });

  it("aviso firmado y aprobado: pagado, Stocker avisado, mail; el segundo aviso no hace nada", async () => {
    enviados.length = 0;
    mp.pagos.set("5001", { id: 5001, status: "approved", external_reference: numero, transaction_amount: 10000, currency_id: "ARS" });
    expect((await post("/v1/pagos/mercadopago/aviso?type=payment&data.id=5001", {}, firmar("5001"))).json().aplicado).toBe(true);
    expect((await pool.query("SELECT estado FROM tienda.pedidos WHERE numero = $1", [numero])).rows[0].estado).toBe("pagado");
    expect(enviados.filter((e) => e.nombre === "pagado")).toHaveLength(1);
    expect(mails("pago_confirmado")).toHaveLength(1);
    expect((await post("/v1/pagos/mercadopago/aviso?type=payment&data.id=5001", {}, firmar("5001", "req-2"))).json().aplicado).toBe(false);
    expect(mails("pago_confirmado")).toHaveLength(1);
  });

  it("si el aviso no llega, ver el pedido le pregunta a Mercado Pago", async () => {
    await cargarCatalogo();
    const r = (await post("/v1/pedidos", pedido("sinaviso", { medioPago: "mercadopago", items: [{ sku: "QA-C-M", cantidad: 1 }] }))).json();
    mp.pagos.set("6001", { id: 6001, status: "approved", external_reference: r.numero, transaction_amount: 10000, currency_id: "ARS" });
    expect((await get(`/v1/pedidos/${r.numero}`, { "x-isu-acceso": r.acceso })).json().estado).toBe("pagado");
  });
});

describe("registrar pagos por API (transferencias, local)", () => {
  it("sin credencial o con otra → 401", async () => {
    const b = { pedido: "ISU-1001", medio: "transferencia", monto: 1, referencia: "OP-1", quien: "qa" };
    expect((await post("/v1/pagos/registrar", b)).statusCode).toBe(401);
    expect((await post("/v1/pagos/registrar", b, { authorization: `Bearer ${INTERNO}` })).statusCode).toBe(401);
  });
  it("registra, avisa a Stocker; la misma referencia dos veces no cobra dos veces; un monto menor no alcanza", async () => {
    await cargarCatalogo();
    const r = (await post("/v1/pedidos", pedido("reg"))).json();
    const auth = { authorization: `Bearer ${PAGOS}` };
    const menos = await post("/v1/pagos/registrar", { pedido: r.numero, medio: "transferencia", monto: 100_000, referencia: "OP-CORTA", quien: "Caja" }, auth);
    expect(menos.json()).toMatchObject({ estado: "esperando_transferencia", insuficiente: true });
    const ok = await post("/v1/pagos/registrar", { pedido: r.numero, medio: "transferencia", monto: 1_600_000, referencia: "OP-778899", quien: "Caja" }, auth);
    expect(ok.json()).toMatchObject({ estado: "pagado", repetido: false });
    expect(stocker.pedidos.get(r.numero)?.pagoPendiente).toBe(true); // lo levanta el worker (cola), no la API
    expect(enviados.some((e) => e.nombre === "pagado" && e.datos.numero === r.numero)).toBe(true);
    expect((await post("/v1/pagos/registrar", { pedido: r.numero, medio: "transferencia", monto: 1_600_000, referencia: "OP-778899", quien: "Caja" }, auth)).json().repetido).toBe(true);
    const ev = await pool.query("SELECT e.estado, e.actor FROM tienda.pedido_eventos e JOIN tienda.pedidos p ON p.id = e.pedido_id WHERE p.numero = $1 ORDER BY e.id", [r.numero]);
    expect(ev.rows.map((x) => x.estado)).toEqual(["reservando", "esperando_transferencia", "esperando_transferencia", "pagado"]);
  });
});

describe("vencimientos", () => {
  it("sólo el worker (credencial interna) los dispara", async () => {
    expect((await post("/v1/interno/vencer", {})).statusCode).toBe(404);
  });
  it("un pedido sin pagar a tiempo devuelve lo apartado y avisa", async () => {
    await cargarCatalogo();
    const r = (await post("/v1/pedidos", pedido("vence"))).json();
    expect(stocker.stock.get("QA-C-M")).toBe(3);
    await pool.query("UPDATE tienda.pedidos SET vence_en = now() - interval '1 minute' WHERE numero = $1", [r.numero]);
    enviados.length = 0;
    const v = await post("/v1/interno/vencer", {}, { "x-isu-interno": INTERNO });
    expect(v.json().vencidos).toBeGreaterThanOrEqual(1);
    expect(stocker.pedidos.get(r.numero)?.estado).toBe("cancelado");
    expect(stocker.stock.get("QA-C-M")).toBe(5);
    expect(mails("pedido_vencido").some((m) => m.datos.numero === r.numero)).toBe(true);
    // Y si después llega la plata, no se pierde: queda para revisar.
    await post("/v1/pagos/registrar", { pedido: r.numero, medio: "transferencia", monto: 1_600_000, referencia: "OP-TARDE", quien: "Caja" }, { authorization: `Bearer ${PAGOS}` });
    expect((await pool.query("SELECT estado FROM tienda.pedidos WHERE numero = $1", [r.numero])).rows[0].estado).toBe("pagado_tarde");
  });
});

describe("comprobante de transferencia", () => {
  it("imagen: se re-codifica y queda privada; el pedido pasa a «informada»", async () => {
    await cargarCatalogo();
    const r = (await post("/v1/pedidos", pedido("comp"))).json();
    const s = await app.inject({ method: "POST", url: `/v1/pedidos/${r.numero}/comprobante`, headers: { "content-type": "image/jpeg", "x-isu-acceso": r.acceso }, payload: await fotoPrueba() });
    expect(s.statusCode).toBe(201);
    expect((await get(`/v1/pedidos/${r.numero}`, { "x-isu-acceso": r.acceso })).json()).toMatchObject({ estado: "transferencia_informada", pago: { comprobanteSubido: true } });
    const archivos = await readdir(dirComp, { recursive: true });
    expect(archivos.some((a) => String(a).endsWith(".webp"))).toBe(true);
  });
  it("un «jpg» que es HTML → 400; sin acceso → 404; otro content-type → 415", async () => {
    await cargarCatalogo();
    const r = (await post("/v1/pedidos", pedido("comp2"))).json();
    const html = Buffer.from("<html><script>alert(1)</script></html>".repeat(10));
    expect((await app.inject({ method: "POST", url: `/v1/pedidos/${r.numero}/comprobante`, headers: { "content-type": "image/jpeg", "x-isu-acceso": r.acceso }, payload: html })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `/v1/pedidos/${r.numero}/comprobante`, headers: { "content-type": "image/jpeg" }, payload: await fotoPrueba() })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/v1/pedidos/${r.numero}/comprobante`, headers: { "content-type": "text/html", "x-isu-acceso": r.acceso }, payload: "<h1>x</h1>" })).statusCode).toBe(415);
  });
});

describe("botón de arrepentimiento", () => {
  it("pedido sin pagar: se cancela solo y se devuelve lo apartado", async () => {
    await cargarCatalogo();
    const r = (await post("/v1/pedidos", pedido("arr"))).json();
    const a = await post("/v1/arrepentimiento", { numero: r.numero, email: "qa-compra-arr@test.com", nombre: "Ana" });
    expect(a.statusCode).toBe(201);
    expect(a.json().codigo).toMatch(/^ARR-[A-Z0-9]{6}$/);
    expect(a.json().mensaje).toMatch(/quedó cancelado/);
    expect(stocker.pedidos.get(r.numero)?.estado).toBe("cancelado");
  });
  it("email que no es del pedido: se registra con código, pero no cancela nada ni manda mails", async () => {
    await cargarCatalogo();
    const r = (await post("/v1/pedidos", pedido("arr2"))).json();
    enviados.length = 0;
    const a = await post("/v1/arrepentimiento", { numero: r.numero, email: "qa-compra-intruso@test.com", nombre: "Xime" });
    expect(a.statusCode).toBe(201);
    expect(a.json().mensaje).not.toMatch(/cancelado/);
    expect(stocker.pedidos.get(r.numero)?.estado).toBe("aceptado");
    expect(mails("arrepentimiento")).toHaveLength(0);
  });
});
