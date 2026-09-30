import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Redis } from "ioredis";
import { crearPool, migrar } from "@isu/db";
import { crearTransportes, firmaSeguimiento } from "@isu/envios";
import { levantarSimulador, type Simulador } from "@isu/envios/simulador";
import { construirApp } from "../src/app.js";
import { leerEntorno } from "../src/entorno.js";
import type { Colas } from "../src/lib/colas.js";
import { crearSesionAdmin } from "../src/modulos/admin/sesion.js";

/*
 * Etapa 4 en la API: opciones de envío en el checkout, pedido con
 * transporte, Mercado Envíos, seguimiento público y el backoffice de envíos.
 * Los transportes son el simulador de @isu/envios en este mismo proceso.
 */
const DB = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:5433/stocker_test";
const REDIS = process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6380/8";
const BASE = 7_600_000;
const INTERNO = "i".repeat(40);
const TOKEN_MP = `APP_USR-${"m".repeat(30)}`; // el simulador acepta los APP_USR-…

const pool = crearPool({ url: DB, max: 6 });
const redis = new Redis(REDIS, { maxRetriesPerRequest: 1 });
let app: Awaited<ReturnType<typeof construirApp>>;
let sim: Simulador;

const enviados: Array<{ tipo: string; nombre: string; datos: Record<string, unknown> }> = [];
const colas: Colas = {
  async email(plantilla, para, datos) { enviados.push({ tipo: "email", nombre: plantilla, datos: { ...datos, para } }); },
  async stocker(nombre, datos) { enviados.push({ tipo: "stocker", nombre, datos }); },
  async envios(nombre, datos) { enviados.push({ tipo: "envios", nombre, datos }); },
  async cerrar() {},
};

const servidores: http.Server[] = [];
async function levantar(h: http.RequestListener) {
  const s = http.createServer(h);
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  servidores.push(s);
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}
const leerCuerpo = async (req: http.IncomingMessage) => { let b = ""; for await (const c of req) b += c; return b ? JSON.parse(b) : {}; };
const json = (res: http.ServerResponse, status: number, cuerpo: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(cuerpo)); };

// Stocker simulado: acepta todo y anota con qué envío llegó cada pedido.
const stockerRecibidos: Array<Record<string, unknown>> = [];
const preferencias: Array<Record<string, unknown>> = [];
const resumen = (n: string) => ({ id: 1, pedido: n, estado: "aceptado", pagoPendiente: true, estadoEnvio: null, despachadoEn: null, canceladoEn: null, motivo: null });

let adminOperador = "", adminLectura = "";
const IP = { "x-isu-interno": INTERNO, "x-isu-ip": "10.8.8.8" };
const post = (url: string, payload: unknown, headers: Record<string, string> = {}) => app.inject({ method: "POST", url, payload: payload as object, headers: { ...IP, ...headers } });
const get = (url: string, headers: Record<string, string> = {}) => app.inject({ method: "GET", url, headers: { ...IP, ...headers } });
const adm = (t: string) => ({ "x-isu-admin": t });

const DESTINO = { cp: "1406", provincia: "CABA", localidad: "Flores" };
const DIRECCION = { calle: "Bacacay", numero: "3231", piso: "", cp: "C1406ABC", localidad: "Flores", provincia: "CABA", indicaciones: "" };
const contacto = (n: string) => ({ email: `qa-envio-${n}@test.com`, nombre: "Ana María", apellido: "Envío", telefono: "11 5555-1234", dni: "30111222" });
const ITEMS = [{ sku: "QA-E-M", cantidad: 2 }];
const pedido = (n: string, entrega: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  items: ITEMS, contacto: contacto(n), entrega: { tipo: "envio", direccion: DIRECCION, ...entrega }, medioPago: "transferencia", aceptaTerminos: true, ...extra,
});

const limpiar = async () => {
  await pool.query("DELETE FROM tienda.pedidos WHERE email LIKE 'qa-envio%'");
  await pool.query("DELETE FROM tienda.clientes WHERE email LIKE 'qa-envio%'");
  await pool.query("DELETE FROM tienda.admins WHERE email LIKE 'qa-envio%'");
  await pool.query("DELETE FROM tienda.productos WHERE stocker_id >= $1 AND stocker_id < $2", [BASE, BASE + 100]);
};

beforeAll(async () => {
  await migrar(pool);
  await redis.flushdb();
  await limpiar();
  sim = await levantarSimulador();
  const urlStocker = await levantar(async (req, res) => {
    const u = new URL(req.url!, "http://x");
    const b = req.method === "GET" ? {} : await leerCuerpo(req);
    if (u.pathname.endsWith("/clientes")) return json(res, 200, { id: 1, nuevo: true });
    if (u.pathname === "/api/integraciones/tienda/pedidos" && req.method === "POST") { stockerRecibidos.push(b); return json(res, 200, { ...resumen(b.pedido), repetido: false }); }
    const m = /\/pedidos\/(ISU-\d+)/.exec(u.pathname);
    return m ? json(res, 200, resumen(m[1]!)) : json(res, 404, {});
  });
  const urlMp = await levantar(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${TOKEN_MP}`) return json(res, 401, {});
    if (req.url === "/checkout/preferences" && req.method === "POST") {
      preferencias.push(await leerCuerpo(req));
      return json(res, 201, { id: `pref-${preferencias.length}`, init_point: `https://mp.test/checkout?pref=${preferencias.length}` });
    }
    return json(res, 404, {});
  });
  const transportes = crearTransportes({ NODE_ENV: "test", TRANSPORTES_SIMULADOR: sim.url, MP_API_URL: `${sim.url}/mp`, MP_ACCESS_TOKEN: TOKEN_MP });
  app = await construirApp({
    env: leerEntorno({
      NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: DB, REDIS_URL: REDIS, CACHE_SEGUNDOS: "0",
      STOCKER_API_URL: urlStocker, STOCKER_TOKEN: "s".repeat(30), MP_ACCESS_TOKEN: TOKEN_MP, MP_API_URL: urlMp, MP_WEBHOOK_SECRET: "secreto-de-prueba-de-mp",
      INTERNO_TOKEN: INTERNO, PAGOS_TOKEN: "p".repeat(40), COMPROBANTES_DIR: await mkdtemp(path.join(os.tmpdir(), "etq-")),
      SITIO_URL: "https://www.isuwaya.test", API_PUBLICA_URL: "https://api.isuwaya.test",
    }),
    pool, redis, colas, transportes,
  });
  await app.ready();

  const p = await pool.query("INSERT INTO tienda.productos (stocker_id, stocker_padre, nombre, slug, visible, peso_gramos) VALUES ($1,'QA-E','Buzo envío','qa-buzo-envio',true,600) RETURNING id", [BASE + 1]);
  const c = await pool.query("INSERT INTO tienda.producto_colores (producto_id, clave, nombre) VALUES ($1,'gris','Gris') RETURNING id", [p.rows[0].id]);
  await pool.query("INSERT INTO tienda.variantes (producto_id, color_id, stocker_id, sku, talle, precio, stock) VALUES ($1,$2,$3,'QA-E-M','M',1000000,50)", [p.rows[0].id, c.rows[0].id, BASE * 10 + 1]);
  await pool.query("UPDATE tienda.ajustes SET valor = 'null' WHERE clave = 'envioGratisDesde'");
  await pool.query("UPDATE tienda.ajustes SET valor = '0' WHERE clave = 'montoMinimoCarrito'");
  await pool.query(`UPDATE tienda.ajustes SET valor = '{"titular":"ISUWAYA SRL","cuit":"30-00000000-0","banco":"Banco QA","cbu":"0000000000000000000000","alias":"ISUWAYA.QA"}' WHERE clave = 'datosTransferencia'`);
  await pool.query(`UPDATE tienda.ajustes SET valor = '{"cps": "1000-1499", "dias": [], "horaCorte": "14:00"}' WHERE clave = 'enviosEnElDia'`);

  const admin = async (email: string, rol: string) => {
    const a = await pool.query("INSERT INTO tienda.admins (email, nombre, hash, rol, totp_activo, debe_cambiar_clave) VALUES ($1, 'QA', 'x', $2, true, false) RETURNING id", [email, rol]);
    return crearSesionAdmin(pool, a.rows[0].id, true, "10.8.8.8", null);
  };
  adminOperador = await admin("qa-envio-operador@test.com", "operador");
  adminLectura = await admin("qa-envio-lectura@test.com", "lectura");
});
afterAll(async () => {
  await limpiar();
  await pool.query(`UPDATE tienda.ajustes SET valor = '{"cps": "1000-1499,1600-1899", "dias": [1, 2, 3, 4, 5], "horaCorte": "14:00"}' WHERE clave = 'enviosEnElDia'`);
  await pool.query(`UPDATE tienda.ajustes SET valor = '{"titular":"","cuit":"","banco":"","cbu":"","alias":""}' WHERE clave = 'datosTransferencia'`);
  await app.close();
  await sim.cerrar();
  for (const s of servidores) await new Promise<void>((r) => s.close(() => r()));
  await redis.quit();
  await pool.end();
});
beforeEach(async () => { const k = await redis.keys("isu:freno:*"); if (k.length) await redis.del(...k); });

type Opcion = { id: string; precio: number; precioOriginal: number; gratis: boolean; soloMercadoPago: boolean; llegaHoy: boolean };
const opciones = async (destino = DESTINO, medioPago?: string) => {
  const r = await post("/v1/envios/opciones", { items: ITEMS, destino, ...(medioPago ? { medioPago } : {}) });
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as { opciones: Opcion[]; aviso: string | null };
};

describe("opciones de envío", () => {
  it("cotiza con cada transporte, a domicilio y a sucursal, de menor a mayor", async () => {
    const { opciones: o, aviso } = await opciones();
    const ids = o.map((x) => x.id);
    for (const id of ["andreani:domicilio", "andreani:sucursal", "oca:domicilio", "correo_argentino:domicilio", "correo_argentino:sucursal", "mercado_envios:domicilio"]) expect(ids).toContain(id);
    expect(ids).not.toContain("cabify:en_el_dia"); // sin días de envío en el día
    expect(aviso).toBeNull();
    expect(o.every((x) => x.precio > 0 && x.precio % 1000 === 0)).toBe(true); // redondeado a $10
    expect(o.map((x) => x.precio)).toEqual([...o.map((x) => x.precio)].sort((a, b) => a - b));
  });
  it("Mercado Envíos sólo si paga con Mercado Pago", async () => {
    expect((await opciones(DESTINO, "transferencia")).opciones.some((x) => x.soloMercadoPago)).toBe(false);
    expect((await opciones(DESTINO, "mercadopago")).opciones.some((x) => x.soloMercadoPago)).toBe(true);
  });
  it("sin cobertura: queda el envío estándar (no se frena la venta)", async () => {
    const { opciones: o } = await opciones({ ...DESTINO, cp: "9999" });
    expect(o.map((x) => x.id)).toEqual(["estandar:domicilio"]);
  });
  it("un transporte caído no tapa a los demás: se avisa", async () => {
    const { opciones: o, aviso } = await opciones({ ...DESTINO, cp: "8888" });
    expect(o.some((x) => x.id.startsWith("andreani"))).toBe(false);
    expect(o.some((x) => x.id.startsWith("oca"))).toBe(true);
    expect(aviso).toMatch(/Andreani/);
  });
  it("envío gratis: la estándar más barata sale $0 y las demás cuestan la diferencia", async () => {
    await pool.query("UPDATE tienda.ajustes SET valor = '100000' WHERE clave = 'envioGratisDesde'");
    try {
      const { opciones: o } = await opciones({ ...DESTINO, cp: "1407" });
      const estandar = o.filter((x) => !x.soloMercadoPago);
      expect(estandar[0]!.gratis).toBe(true);
      expect(estandar[0]!.precio).toBe(0);
      const min = Math.min(...estandar.map((x) => x.precioOriginal));
      for (const x of estandar) expect(x.precio).toBe(x.precioOriginal - min);
      expect(o.find((x) => x.soloMercadoPago)!.gratis).toBe(false);
    } finally {
      await pool.query("UPDATE tienda.ajustes SET valor = 'null' WHERE clave = 'envioGratisDesde'");
    }
  });
  it("en el día (Cabify) sólo en los CP, días y antes de la hora de corte", async () => {
    await pool.query(`UPDATE tienda.ajustes SET valor = '{"cps": "1000-1499", "dias": [0,1,2,3,4,5,6], "horaCorte": "23:59"}' WHERE clave = 'enviosEnElDia'`);
    try {
      const dentro = (await opciones({ ...DESTINO, cp: "1408" })).opciones;
      expect(dentro[0]!.id).toBe("cabify:en_el_dia"); // primero
      expect(dentro[0]!.llegaHoy).toBe(true);
      expect((await opciones({ ...DESTINO, cp: "1900" })).opciones.some((x) => x.llegaHoy)).toBe(false);
    } finally {
      await pool.query(`UPDATE tienda.ajustes SET valor = '{"cps": "1000-1499", "dias": [], "horaCorte": "14:00"}' WHERE clave = 'enviosEnElDia'`);
    }
  });
  it("valida el pedido: CP inválido y campos de más", async () => {
    expect((await post("/v1/envios/opciones", { items: ITEMS, destino: { ...DESTINO, cp: "abc" } })).statusCode).toBe(400);
    expect((await post("/v1/envios/opciones", { items: ITEMS, destino: DESTINO, precio: 0 })).statusCode).toBe(400);
  });
  it("tiene su propio freno por IP", async () => {
    const h = { "x-isu-ip": "10.77.0.1" };
    let ultimo = 0;
    for (let i = 0; i < 125; i++) ultimo = (await post("/v1/envios/opciones", { items: ITEMS, destino: DESTINO }, h)).statusCode;
    expect(ultimo).toBe(429);
  });
  it("sucursales del transporte cerca del CP", async () => {
    const r = await get("/v1/envios/sucursales?transporte=andreani&cp=1406");
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().sucursales).toHaveLength(3);
    expect((await get("/v1/envios/sucursales?transporte=andreani&cp=1406&x=1")).statusCode).toBe(400);
  });
});

describe("pedido con transporte", () => {
  it("el carrito suma la opción elegida", async () => {
    const o = (await opciones()).opciones.find((x) => x.id === "oca:domicilio")!;
    const r = await post("/v1/carrito", { items: ITEMS, entrega: "envio", medioPago: "transferencia", envio: { ...DESTINO, opcion: "oca:domicilio" } });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().envio).toBe(o.precio);
    expect(r.json().opcionEnvio.id).toBe("oca:domicilio");
  });
  it("a sucursal hace falta una sucursal de la lista", async () => {
    expect((await post("/v1/pedidos", pedido("s1", { opcion: "andreani:sucursal" }))).statusCode).toBe(400);
    const mala = await post("/v1/pedidos", pedido("s2", { opcion: "andreani:sucursal", sucursal: "inventada" }));
    expect(mala.statusCode).toBe(400);
    expect(mala.json().mensaje ?? mala.body).toMatch(/sucursal/i);
  });
  it("una opción que no se cotiza para ese CP: 409 con las opciones que sí hay", async () => {
    const r = await post("/v1/pedidos", pedido("x1", { opcion: "cabify:en_el_dia" }));
    expect(r.statusCode).toBe(409);
    expect(r.json().codigo ?? r.body).toMatch(/envio_no_disponible/);
  });
  it("sin elegir cómo, con transportes configurados: 400", async () => {
    expect((await post("/v1/pedidos", pedido("x2", {}))).statusCode).toBe(400);
  });
  it("crea el pedido con transporte, sucursal, paquete y avisos por WhatsApp; Stocker sabe con qué sale", async () => {
    const o = (await opciones()).opciones.find((x) => x.id === "andreani:sucursal")!;
    const r = await post("/v1/pedidos", pedido("ok1", { opcion: "andreani:sucursal", sucursal: "an14061" }, { avisosWhatsapp: true }));
    expect(r.statusCode, r.body).toBe(201);
    const { rows } = await pool.query("SELECT * FROM tienda.pedidos WHERE numero = $1", [r.json().numero]);
    const p = rows[0];
    expect(p.transporte).toBe("andreani");
    expect(p.servicio_envio).toBe("sucursal");
    expect(p.sucursal_envio.id).toBe("an14061");
    expect(p.avisos_whatsapp).toBe(true);
    expect(p.envio).toBe(o.precio);
    expect(p.paquete_envio.pesoGramos).toBe(2 * 600 + 150); // peso de la prenda + la caja
    expect(stockerRecibidos.at(-1)!.envio).toEqual({ tipo: "andreani" });
  });
  it("el precio del envío lo pone la API aunque el navegador mande otro", async () => {
    const r = await post("/v1/pedidos", pedido("ok2", { opcion: "oca:domicilio", precio: 1 }));
    expect(r.statusCode).toBe(400); // campo desconocido: strict
  });
  it("Mercado Envíos: sólo con Mercado Pago, no suma al total y va en la preferencia", async () => {
    expect((await post("/v1/pedidos", pedido("me1", { opcion: "mercado_envios:domicilio" }))).statusCode).toBe(409); // con transferencia no se ofrece
    const r = await post("/v1/pedidos", pedido("me2", { opcion: "mercado_envios:domicilio" }, { medioPago: "mercadopago" }));
    expect(r.statusCode, r.body).toBe(201);
    const { rows } = await pool.query("SELECT envio, total, subtotal, transporte FROM tienda.pedidos WHERE numero = $1", [r.json().numero]);
    expect(rows[0].envio).toBe(0);
    expect(rows[0].total).toBe(rows[0].subtotal);
    expect(preferencias.at(-1)!.shipments).toMatchObject({ mode: "me2", local_pickup: false });
  });
});

describe("seguimiento público", () => {
  let numero = "";
  beforeAll(async () => {
    numero = (await post("/v1/pedidos", pedido("seg", { opcion: "oca:domicilio" }))).json().numero;
  });
  it("sin la firma correcta no muestra nada", async () => {
    expect((await get(`/v1/seguimiento/${numero}?t=${"A".repeat(24)}`)).statusCode).toBe(404);
    expect((await get(`/v1/seguimiento/${numero}`)).statusCode).toBe(400);
    // La firma de un pedido no sirve para otro.
    expect((await get(`/v1/seguimiento/ISU-99999?t=${firmaSeguimiento(numero, INTERNO)}`)).statusCode).toBe(404);
  });
  it("con la firma: el envío y el nombre de pila, nada más", async () => {
    const r = await get(`/v1/seguimiento/${numero}?t=${firmaSeguimiento(numero, INTERNO)}`);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().nombre).toBe("Ana");
    expect(r.json().envio.transporte).toBe("oca");
    for (const dato of ["qa-envio", "Bacacay", "30111222", "5555", "Envío\""]) expect(r.body).not.toContain(dato);
  });
});

describe("backoffice de envíos", () => {
  let numero = "";
  beforeAll(async () => {
    const r = await post("/v1/pedidos", pedido("adm", { opcion: "andreani:domicilio" }));
    numero = r.json().numero;
    const { rows } = await pool.query("SELECT total FROM tienda.pedidos WHERE numero = $1", [numero]);
    const pago = await post(`/v1/admin/pedidos/${numero}/pago`, { medio: "transferencia", monto: rows[0].total, referencia: "QA-TRF-1" }, adm(adminOperador));
    expect(pago.statusCode, pago.body).toBe(200);
  });
  it("sin sesión 401; con rol lectura no prepara", async () => {
    expect((await get("/v1/admin/envios")).statusCode).toBe(401);
    expect((await post("/v1/admin/envios/preparar", { numeros: [numero] }, adm(adminLectura))).statusCode).toBe(403);
  });
  it("el pedido pagado aparece para preparar", async () => {
    const r = await get("/v1/admin/envios?vista=preparar", adm(adminOperador));
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().envios.map((e: { numero: string }) => e.numero)).toContain(numero);
    expect(r.json().conteo.preparar).toBeGreaterThan(0);
  });
  it("preparar crea el envío en Andreani, guarda la etiqueta y le pasa el número a Stocker", async () => {
    const r = await post("/v1/admin/envios/preparar", { numeros: [numero] }, adm(adminOperador));
    expect(r.statusCode, r.body).toBe(200);
    const res = r.json().resultados[0];
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(res.etiqueta).toBe(true);
    expect(sim.envios.has(res.seguimiento)).toBe(true);
    expect(enviados.some((e) => e.nombre === "envio" && e.datos.numero === numero && e.datos.seguimiento === res.seguimiento && e.datos.tipo === "andreani")).toBe(true);
    const otra = await post("/v1/admin/envios/preparar", { numeros: [numero] }, adm(adminOperador));
    expect(otra.json().resultados[0].ok).toBe(false); // no crea dos envíos
    const lista = await get("/v1/admin/envios?vista=etiquetados", adm(adminOperador));
    expect(lista.json().envios.find((e: { numero: string }) => e.numero === numero).tieneEtiqueta).toBe(true);
  });
  it("imprime las etiquetas en un solo PDF", async () => {
    const r = await get(`/v1/admin/envios/etiquetas?numeros=${numero}`, adm(adminOperador));
    expect(r.statusCode, r.body.slice(0, 200)).toBe(200);
    expect(r.headers["content-type"]).toBe("application/pdf");
    expect(r.headers["content-disposition"]).toMatch(/^attachment/);
    expect(r.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
    expect((await get("/v1/admin/envios/etiquetas?numeros=../../etc", adm(adminOperador))).statusCode).toBe(400);
  });
  it("con transporte, 'enviado' no se marca a mano", async () => {
    expect((await post(`/v1/admin/pedidos/${numero}/entrega`, { estado: "enviado" }, adm(adminOperador))).statusCode).toBe(409);
  });
  it("el seguimiento público muestra el número y el enlace del transporte", async () => {
    const r = await get(`/v1/seguimiento/${numero}?t=${firmaSeguimiento(numero, INTERNO)}`);
    expect(r.json().envio.seguimiento).toMatch(/^36/);
    expect(r.json().envio.url).toMatch(/^https:\/\//);
  });
  it("descartar la etiqueta lo vuelve a 'para preparar' (y queda auditado)", async () => {
    const r = await post(`/v1/admin/envios/${numero}/descartar`, { motivo: "dirección mal cargada" }, adm(adminOperador));
    expect(r.statusCode, r.body).toBe(200);
    const lista = await get("/v1/admin/envios?vista=preparar", adm(adminOperador));
    expect(lista.json().envios.map((e: { numero: string }) => e.numero)).toContain(numero);
    const a = await pool.query("SELECT 1 FROM tienda.auditoria WHERE accion = 'descartar_envio' AND detalle->>'numero' = $1", [numero]);
    expect(a.rowCount).toBe(1);
    expect((await post(`/v1/admin/envios/${numero}/descartar`, { motivo: "otra vez" }, adm(adminOperador))).statusCode).toBe(409);
  });
  it("no prepara pedidos sin pagar", async () => {
    const n = (await post("/v1/pedidos", pedido("sinpagar", { opcion: "oca:domicilio" }))).json().numero;
    const r = await post("/v1/admin/envios/preparar", { numeros: [n] }, adm(adminOperador));
    expect(r.json().resultados[0].ok).toBe(false);
  });
});
