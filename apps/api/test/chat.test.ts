import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Redis } from "ioredis";
import { crearPool, migrar } from "@isu/db";
import { crearTransportes } from "@isu/envios";
import { levantarSimulador, type Simulador } from "@isu/envios/simulador";
import { construirApp } from "../src/app.js";
import { leerEntorno } from "../src/entorno.js";
import type { Colas } from "../src/lib/colas.js";
import { crearSesionAdmin } from "../src/modulos/admin/sesion.js";
import type { Ia } from "../src/modulos/chat/ia.js";
import { limpiar as limpiarIa } from "../src/modulos/chat/ia.js";
import { codigoPostal, normalizar, raices, raiz, rellenar, tachar } from "../src/modulos/chat/texto.js";

/*
 * Etapa 5: el asistente de la tienda. Preguntas escritas como las escribe
 * la gente, cotización de envío por CP (simulador de transportes), estado de
 * un pedido con número + email, búsqueda de productos, IA de mentira (con
 * tope diario) y el backoffice de preguntas frecuentes.
 */
const DB = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:5433/stocker_test";
const REDIS = process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6380/9";
const BASE = 7_700_000;
const INTERNO = "i".repeat(40);

const pool = crearPool({ url: DB, max: 6 });
const redis = new Redis(REDIS, { maxRetriesPerRequest: 1 });
let app: Awaited<ReturnType<typeof construirApp>>;
let sim: Simulador;
let servidor: http.Server;
const colas: Colas = { async email() {}, async stocker() {}, async envios() {}, async cerrar() {} };

// IA de mentira: devuelve lo que se le diga y anota qué recibió.
const iaRecibio: Array<{ contexto: string; pregunta: string; previos: string[] }> = [];
const ia: Ia = { modelo: "prueba", async responder(a) { iaRecibio.push(a); return "Respuesta de la IA sobre la tienda."; } };

let operador = "", lectura = "";
// Los ajustes que la prueba cambia se devuelven como estaban (la base es la misma del desarrollo local).
let originales: Array<{ clave: string; valor: unknown }> = [];
const IP = { "x-isu-interno": INTERNO, "x-isu-ip": "10.6.6.6" };
const post = (url: string, payload: unknown, headers: Record<string, string> = {}) => app.inject({ method: "POST", url, payload: payload as object, headers: { ...IP, ...headers } });
const get = (url: string, headers: Record<string, string> = {}) => app.inject({ method: "GET", url, headers: { ...IP, ...headers } });
const adm = (t: string) => ({ "x-isu-admin": t });
const chat = async (mensaje: string, extra: Record<string, unknown> = {}) => {
  const r = await post("/v1/chat", { mensaje, ...extra });
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
};
const ajuste = (clave: string, valor: unknown) => pool.query("UPDATE tienda.ajustes SET valor = $2 WHERE clave = $1", [clave, JSON.stringify(valor)]);

const limpiar = async () => {
  await pool.query("DELETE FROM tienda.pedidos WHERE email LIKE 'qa-chat%'");
  await pool.query("DELETE FROM tienda.admins WHERE email LIKE 'qa-chat%'");
  await pool.query("DELETE FROM tienda.productos WHERE stocker_id >= $1 AND stocker_id < $2", [BASE, BASE + 100]);
  await pool.query("DELETE FROM tienda.faq WHERE pregunta LIKE 'QA chat%'");
  await pool.query("DELETE FROM tienda.chat_sin_respuesta");
};

beforeAll(async () => {
  await migrar(pool);
  await redis.flushdb();
  await limpiar();
  sim = await levantarSimulador();
  servidor = http.createServer((_req, res) => { res.writeHead(404); res.end("{}"); });
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  app = await construirApp({
    env: leerEntorno({
      NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: DB, REDIS_URL: REDIS, CACHE_SEGUNDOS: "0",
      STOCKER_API_URL: `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`, STOCKER_TOKEN: "s".repeat(30), INTERNO_TOKEN: INTERNO,
      SITIO_URL: "https://www.isuwaya.test", API_PUBLICA_URL: "https://api.isuwaya.test",
    }),
    pool, redis, colas, ia,
    transportes: crearTransportes({ NODE_ENV: "test", TRANSPORTES_SIMULADOR: sim.url }),
  });
  await app.ready();
  originales = (await pool.query("SELECT clave, valor FROM tienda.ajustes WHERE clave IN ('chatbot', 'chatbotIa', 'envioGratisDesde')")).rows;
  await ajuste("chatbot", { activo: true, saludo: "¡Hola! Soy el asistente de prueba." });
  await ajuste("chatbotIa", { activo: false, topeDiario: 2 });
  await ajuste("envioGratisDesde", null);

  const p = await pool.query("INSERT INTO tienda.productos (stocker_id, stocker_padre, nombre, slug, visible) VALUES ($1,'QA-CHAT','Buzo Canguro Chat','qa-buzo-chat',true) RETURNING id", [BASE + 1]);
  const c = await pool.query("INSERT INTO tienda.producto_colores (producto_id, clave, nombre) VALUES ($1,'gris','Gris') RETURNING id", [p.rows[0].id]);
  await pool.query("INSERT INTO tienda.variantes (producto_id, color_id, stocker_id, sku, talle, precio, stock) VALUES ($1,$2,$3,'QA-CHAT-M','M',2500000,5)", [p.rows[0].id, c.rows[0].id, BASE * 10 + 1]);

  const admin = async (email: string, rol: string) => {
    const a = await pool.query("INSERT INTO tienda.admins (email, nombre, hash, rol, totp_activo, debe_cambiar_clave) VALUES ($1, 'QA', 'x', $2, true, false) RETURNING id", [email, rol]);
    return crearSesionAdmin(pool, a.rows[0].id, true, "10.6.6.6", null);
  };
  operador = await admin("qa-chat-operador@test.com", "operador");
  lectura = await admin("qa-chat-lectura@test.com", "lectura");
});
afterAll(async () => {
  await limpiar();
  for (const o of originales) await ajuste(o.clave, o.valor);
  await app.close();
  await sim.cerrar();
  await new Promise<void>((r) => servidor.close(() => r()));
  await redis.quit();
  await pool.end();
});
beforeEach(async () => { const k = await redis.keys("isu:freno:*"); if (k.length) await redis.del(...k); });

describe("texto", () => {
  it("normaliza, reduce a raíces y junta las formas de una misma palabra", () => {
    expect(normalizar("¿Cuánto SALE el envío?!")).toBe("cuanto sale el envio");
    expect(raiz("envios")).toBe(raiz("enviar"));
    expect(raiz("cambio")).toBe(raiz("cambiar"));
    expect(raiz("devolucion")).toBe(raiz("devolver"));
    expect(raiz("seguro")).not.toBe(raiz("seguimiento"));
    expect(raices("hola, quiero saber de los envíos")).toEqual([raiz("envios")]);
  });
  it("código postal: 4 números o CPA; no confunde con otros números largos", () => {
    expect(codigoPostal("cuanto sale el envio a 5000")).toBe("5000");
    expect(codigoPostal("envio a c1406abc")).toBe("1406");
    expect(codigoPostal("mi dni es 30111222")).toBeNull();
  });
  it("tacha datos personales antes de guardar", () => {
    const t = tachar("soy juan@mail.com, mi cel 11 5555-1234 y el pedido ISU-1234");
    expect(t).not.toMatch(/juan@|5555|1234/);
    expect(t).toContain("[email]");
  });
  it("rellena {variables} y deja las desconocidas", () => {
    expect(rellenar("{descuento}% OFF {nada}", { descuento: "20" })).toBe("20% OFF {nada}");
  });
  it("la salida de la IA queda en texto plano, sin enlaces ni markdown", () => {
    expect(limpiarIa("**Hola** visitá https://evil.test/x y `code`")).toBe("Hola visitá y code");
  });
});

describe("preguntas frecuentes (escritas como las escribe la gente)", () => {
  const casos: Array<[string, RegExp]> = [
    ["hacen envios al interior?", /todo el pa[ií]s/],
    ["mandan a cordoba?", /todo el pa[ií]s/],
    ["cuanto tarda en llegar a mendoza", /tarda/],
    ["q medios de pago aceptan", /medios de pago/],
    ["aceptan mercado pago?", /medios de pago/],
    ["tienen cuotas sin interes", /cuotas/],
    ["hay descuento pagando con transferencia?", /transferencia/],
    ["como se que talle soy", /talle/],
    ["que talle me queda?", /talle/],
    ["quiero cambiar el talle de una remera", /cambio/],
    ["me arrepenti de la compra", /arrepent/],
    ["me llego fallada la remera", /fallada/],
    ["horario del local", /locales/],
    ["puedo pasar a retirar por el local?", /retirar/],
    ["venden por mayor?", /mayor/],
    ["es seguro comprar aca?", /seguro/],
    ["me equivoque de direccion, la puedo cambiar?", /direcci[oó]n/],
  ];
  it.each(casos)("«%s»", async (pregunta, esperada) => {
    const r = await chat(pregunta);
    expect(r.faqId, `${pregunta} → ${r.texto}`).toBeDefined();
    const { rows } = await pool.query("SELECT pregunta FROM tienda.faq WHERE id = $1", [r.faqId]);
    expect(rows[0].pregunta).toMatch(esperada);
  });
  it("las respuestas salen con los datos de Ajustes ({descuento}, {whatsapp}…)", async () => {
    const r = await chat("hay descuento por transferencia");
    expect(r.texto).not.toMatch(/\{/);
    expect(r.texto).toMatch(/\d+% OFF/);
  });
  it("enlaces sólo de la tienda o del WhatsApp de la tienda", async () => {
    const r = await chat("me llego fallada la remera");
    for (const e of r.enlaces) expect(e.url).toMatch(/^(\/|https:\/\/wa\.me\/\d+\?)/);
  });
  it("en una ficha, el talle apunta a la guía de esa prenda", async () => {
    const r = await chat("que talle soy?", { producto: "qa-buzo-chat" });
    expect(r.enlaces[0].url).toBe("/producto/qa-buzo-chat#guia-talles");
  });
});

describe("con datos de verdad", () => {
  it("saludo y sugerencias", async () => {
    const r = await chat("hola!");
    expect(r.tema).toBe("saludo");
    expect(r.texto).toBe("¡Hola! Soy el asistente de prueba.");
    expect(r.sugerencias.length).toBeGreaterThan(0);
  });
  it("costo de envío con CP: cotiza con los transportes", async () => {
    const r = await chat("cuanto sale el envio a 5000?");
    expect(r.tema).toBe("envios");
    expect(r.opcionesEnvio.length).toBeGreaterThan(1);
    expect(r.opcionesEnvio[0].precio).toBeGreaterThan(0);
  });
  it("sin CP lo pide, y con el CP solo (esperando) cotiza", async () => {
    const r = await chat("cuanto sale el envio?");
    expect(r.esperando).toBe("cp");
    const r2 = await chat("1406", { esperando: "cp" });
    expect(r2.opcionesEnvio.length).toBeGreaterThan(0);
    const r3 = await chat("no se", { esperando: "cp" });
    expect(r3.esperando).toBe("cp");
  });
  it("un número que no es CP no dispara una cotización", async () => {
    const r = await chat("tienen buzos de 5000?");
    expect(r.opcionesEnvio).toBeUndefined();
  });
  it("hablar con una persona → WhatsApp", async () => {
    const r = await chat("quiero hablar con una persona");
    expect(r.tema).toBe("humano");
    expect(r.enlaces[0].url).toMatch(/^https:\/\/wa\.me\/\d+\?text=/);
  });
  it("productos: usa el buscador de la tienda", async () => {
    const r = await chat("tienen buzos canguro?");
    expect(r.tema).toBe("productos");
    expect(r.productos[0]).toMatchObject({ nombre: "Buzo Canguro Chat", url: "/producto/qa-buzo-chat", precio: 2500000 });
  });
  it("lo que no sabe: lo dice, ofrece WhatsApp y lo anota SIN datos personales", async () => {
    const r = await chat("soy juan@mail.com cel 1155551234, cual es el planeta mas grande");
    expect(r.tema).toBe("sin_respuesta");
    expect(r.enlaces[0].url).toMatch(/wa\.me/);
    const { rows } = await pool.query("SELECT ejemplo FROM tienda.chat_sin_respuesta ORDER BY id DESC LIMIT 1");
    expect(rows[0].ejemplo).not.toMatch(/juan@|5555/);
  });
  it("entrada estricta y acotada", async () => {
    expect((await post("/v1/chat", { mensaje: "x".repeat(301) })).statusCode).toBe(400);
    expect((await post("/v1/chat", { mensaje: "hola", rol: "system" })).statusCode).toBe(400);
    expect((await post("/v1/chat", { mensaje: "hola", producto: "../../etc" })).statusCode).toBe(400);
    expect((await post("/v1/chat", { mensaje: "hola", previos: ["a", "b", "c", "d"] })).statusCode).toBe(400);
  });
  it("freno por IP", async () => {
    let ultimo = 0;
    for (let i = 0; i < 65; i++) ultimo = (await post("/v1/chat", { mensaje: "hola" }, { "x-isu-ip": "10.66.0.1" })).statusCode;
    expect(ultimo).toBe(429);
  });
  it("apagado en Ajustes → 503", async () => {
    await ajuste("chatbot", { activo: false, saludo: "x" });
    try {
      expect((await post("/v1/chat", { mensaje: "hola" })).statusCode).toBe(503);
    } finally {
      await ajuste("chatbot", { activo: true, saludo: "¡Hola! Soy el asistente de prueba." });
    }
  });
});

describe("estado de un pedido (número + email)", () => {
  let numero = "";
  beforeAll(async () => {
    const { rows } = await pool.query(
      `INSERT INTO tienda.pedidos (acceso_hash, email, nombre, apellido, telefono, dni, entrega, direccion, medio_pago, subtotal, total, estado, transporte, servicio_envio)
       VALUES (repeat('a',64), 'qa-chat-cliente@test.com', 'Ana', 'Chat', '1155551234', '30111222', 'envio', '{"calle":"x","numero":"1","cp":"1406","localidad":"Flores","provincia":"CABA"}', 'transferencia', 100, 100, 'enviado', 'andreani', 'domicilio')
       RETURNING id, numero`);
    numero = rows[0].numero;
    await pool.query("INSERT INTO tienda.envios (pedido_id, transporte, servicio, seguimiento, estado, despachado_en) VALUES ($1, 'andreani', 'domicilio', '360000099999', 'en_camino', now())", [rows[0].id]);
  });
  it("preguntar por el pedido pide los datos", async () => {
    expect((await chat("donde esta mi pedido?")).esperando).toBe("pedido");
    expect((await chat(`como viene el ${numero.toLowerCase()}`)).esperando).toBe("pedido");
    // "Me arrepentí de mi compra" NO es "dónde está mi pedido".
    expect((await chat("me arrepenti de mi compra")).esperando).toBeUndefined();
  });
  it("con el email correcto: estado, envío y enlace de seguimiento firmado", async () => {
    const r = await post("/v1/chat/pedido", { numero: numero.replace("-", ""), email: "QA-Chat-Cliente@test.com" });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().texto).toMatch(/en camino/);
    expect(r.json().enlaces[0].url.startsWith(`/seguimiento/${numero}?t=`)).toBe(true);
    expect(r.json().enlaces[0].url).toMatch(/\?t=[A-Za-z0-9_-]{24}$/);
    // Nada de la dirección ni del teléfono.
    expect(r.body).not.toMatch(/Flores|5555/);
  });
  it("con otro email: la misma respuesta que si no existiera", async () => {
    const a = await post("/v1/chat/pedido", { numero, email: "otro@test.com" });
    const b = await post("/v1/chat/pedido", { numero: "ISU-9999999", email: "otro@test.com" });
    expect(a.json().texto).toBe(b.json().texto);
    expect(a.json().enlaces).toEqual([]);
  });
  it("no se pueden probar emails contra un número (freno por número, aunque cambie la IP)", async () => {
    let ultimo = 0;
    for (let i = 0; i < 7; i++) ultimo = (await post("/v1/chat/pedido", { numero, email: `x${i}@test.com` }, { "x-isu-ip": `10.7.0.${i}` })).statusCode;
    expect(ultimo).toBe(429);
  });
});

describe("IA (opcional)", () => {
  it("sólo si está prendida, con la información de la tienda, y con tope diario", async () => {
    // Apagada: no se usa.
    expect((await chat("cual es la capital de francia")).ia).toBeUndefined();
    await ajuste("chatbotIa", { activo: true, topeDiario: 2 });
    try {
      const r = await chat("cual es la capital de francia", { previos: ["hola"] });
      expect(r.ia).toBe(true);
      expect(r.texto).toBe("Respuesta de la IA sobre la tienda.");
      const recibio = iaRecibio.at(-1)!;
      expect(recibio.contexto).toMatch(/Preguntas frecuentes/);
      expect(recibio.contexto).toMatch(/OFF/);
      expect(recibio.previos).toEqual(["hola"]);
      await chat("otra cosa rara que no sabe");
      // Tercera del día: sin cupo, contesta sin IA.
      expect((await chat("una tercera pregunta sin respuesta")).ia).toBeUndefined();
      // Lo que sí está en las preguntas frecuentes nunca va a la IA.
      const n = iaRecibio.length;
      await chat("tienen cuotas sin interes");
      expect(iaRecibio.length).toBe(n);
    } finally {
      await ajuste("chatbotIa", { activo: false, topeDiario: 2 });
    }
  });
});

describe("votos", () => {
  it("¿te sirvió? suma a la pregunta", async () => {
    const r = await chat("tienen cuotas sin interes");
    expect((await post("/v1/chat/voto", { faqId: r.faqId, util: true })).statusCode).toBe(204);
    const { rows } = await pool.query("SELECT util FROM tienda.faq WHERE id = $1", [r.faqId]);
    expect(rows[0].util).toBeGreaterThan(0);
    expect((await post("/v1/chat/voto", { faqId: -1, util: true })).statusCode).toBe(400);
  });
});

describe("backoffice del asistente", () => {
  const nueva = { pregunta: "QA chat ¿hacen factura A?", respuesta: "Sí, pedila por WhatsApp al {whatsapp}.", palabras: "factura iva responsable inscripto", tema: "pagos" };
  it("sin sesión 401; lectura no edita", async () => {
    expect((await get("/v1/admin/chat/faq")).statusCode).toBe(401);
    expect((await post("/v1/admin/chat/faq", nueva, adm(lectura))).statusCode).toBe(403);
  });
  it("crear una pregunta: el asistente la usa al toque (y queda auditado)", async () => {
    const r = await post("/v1/admin/chat/faq", nueva, adm(operador));
    expect(r.statusCode, r.body).toBe(201);
    const c = await chat("hacen factura a?");
    expect(c.faqId).toBe(r.json().faq.id);
    expect(c.texto).toMatch(/\+54 9/);
    const a = await pool.query("SELECT 1 FROM tienda.auditoria WHERE accion = 'crear_faq' AND entidad_id = $1 AND creado_en > now() - interval '1 minute'", [String(r.json().faq.id)]);
    expect(a.rowCount).toBe(1);
  });
  it("enlaces sólo a la tienda", async () => {
    const r = await post("/v1/admin/chat/faq", { ...nueva, enlaceTexto: "x", enlaceUrl: "https://evil.test" }, adm(operador));
    expect(r.statusCode).toBe(400);
    expect((await post("/v1/admin/chat/faq", { ...nueva, enlaceTexto: "x", enlaceUrl: "//evil.test" }, adm(operador))).statusCode).toBe(400);
  });
  it("probar una pregunta muestra las cercanas y no suma estadísticas", async () => {
    const total = async () => {
      await get("/v1/admin/chat/resumen", adm(lectura)); // guarda los contadores en memoria
      return (await pool.query("SELECT COALESCE(sum(veces),0)::int AS n FROM tienda.chat_temas")).rows[0].n;
    };
    const antes = await total();
    const r = await post("/v1/admin/chat/probar", { mensaje: "aceptan mercado pago?" }, adm(lectura));
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().cercanas[0].pregunta).toMatch(/medios de pago/);
    expect(await total()).toBe(antes);
  });
  it("lo sin respuesta y el resumen", async () => {
    await chat("xyzzy plugh frobnicate");
    const s = await get("/v1/admin/chat/sin-respuesta", adm(lectura));
    expect(s.json().preguntas.some((p: { ejemplo: string }) => p.ejemplo.includes("xyzzy"))).toBe(true);
    const id = s.json().preguntas[0].id;
    expect((await post(`/v1/admin/chat/sin-respuesta/${id}/resuelta`, {}, adm(operador))).statusCode).toBe(200);
    const res = await get("/v1/admin/chat/resumen", adm(lectura));
    expect(res.json().consultas).toBeGreaterThan(0);
    expect(res.json().iaDisponible).toBe(true);
  });
  it("ajustes del asistente validados", async () => {
    const r = await app.inject({ method: "PUT", url: "/v1/admin/ajustes", headers: { ...IP, ...adm(operador) }, payload: { chatbot: { activo: true, saludo: "x" } } });
    expect(r.statusCode).toBe(403); // sólo el dueño
  });
});
