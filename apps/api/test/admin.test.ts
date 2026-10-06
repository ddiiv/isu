import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { Redis } from "ioredis";
import { hash } from "@node-rs/argon2";
import { crearPool, migrar } from "@isu/db";
import { construirApp } from "../src/app.js";
import { leerEntorno } from "../src/entorno.js";
import type { Colas } from "../src/lib/colas.js";
import { codigo } from "../src/lib/totp.js";
import { ARGON_ADMIN } from "../src/modulos/admin/ingreso.js";
import { firmaOpinar } from "@isu/envios";

/*
 * Etapa 3: el backoffice por la API. Ingreso con doble factor, roles,
 * auditoría y cada pantalla (pedidos, productos, fotos, categorías,
 * descuentos, guías de talles, ajustes, usuarios), más lo que se ve del
 * lado de la tienda: Destacados/Nuevos, descuentos, guía de talles y outfits.
 */
const DB = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:5433/stocker_test";
const REDIS = process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6380/8";
const BASE = 7_500_000;
const INTERNO = "i".repeat(40);
const CLAVE_CIFRADO = Buffer.alloc(32, 7).toString("base64");

const pool = crearPool({ url: DB, max: 6 });
const redis = new Redis(REDIS, { maxRetriesPerRequest: 1 });
let app: Awaited<ReturnType<typeof construirApp>>;
let dirFotos = "";

const enviados: Array<{ tipo: string; nombre: string; datos: Record<string, unknown> }> = [];
const colas: Colas = {
  async email(plantilla, para, datos) { enviados.push({ tipo: "email", nombre: plantilla, datos: { ...datos, para } }); },
  async stocker(nombre, datos) { enviados.push({ tipo: "stocker", nombre, datos }); },
  async envios(nombre, datos) { enviados.push({ tipo: "envios", nombre, datos }); },
  async cerrar() {},
};

// Stocker simulado: sólo lo que usa el backoffice (estado y cancelar).
const cancelados = new Set<string>();
let servidor: http.Server;
async function levantarStocker() {
  servidor = http.createServer((req, res) => {
    const m = /\/pedidos\/(ISU-\d+)(\/cancelar)?$/.exec(req.url ?? "");
    res.writeHead(m ? 200 : 404, { "content-type": "application/json" });
    if (!m) return res.end("{}");
    if (m[2]) cancelados.add(m[1]!);
    res.end(JSON.stringify({ id: 1, pedido: m[1], estado: cancelados.has(m[1]!) ? "cancelado" : "aceptado", pagoPendiente: false, estadoEnvio: null, despachadoEn: null, canceladoEn: null, motivo: null }));
  });
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
}

const ids: Record<string, number> = {};
async function producto(n: number, nombre: string, cat: string, categoria: string | null, variantes: Array<[string, string, string, number, number]>) {
  const slug = `qa-adm-${n}`;
  const p = await pool.query(
    `INSERT INTO tienda.productos (stocker_id, stocker_padre, nombre, slug, visible, stocker_categoria, categoria_id)
     VALUES ($1,$2,$3,$4,true,$5,(SELECT h.id FROM tienda.categorias h JOIN tienda.categorias p ON p.id = h.padre_id WHERE p.slug || '/' || h.slug = $6)) RETURNING id, categoria_id`,
    [BASE + n, `QA-ADM-${n}`, nombre, slug, categoria, cat]);
  const id = p.rows[0].id;
  await pool.query("INSERT INTO tienda.producto_categorias VALUES ($1,$2)", [id, p.rows[0].categoria_id]);
  const colores = new Map<string, number>();
  let i = 0;
  for (const [color, hex, talle, precio, stock] of variantes) {
    if (!colores.has(color)) {
      const c = await pool.query("INSERT INTO tienda.producto_colores (producto_id, clave, nombre, hex, orden) VALUES ($1,$2,$2,$3,$4) RETURNING id", [id, color, hex, colores.size]);
      colores.set(color, c.rows[0].id);
    }
    i++;
    await pool.query("INSERT INTO tienda.variantes (producto_id, color_id, stocker_id, sku, talle, precio, stock, orden) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [id, colores.get(color), BASE * 10 + n * 100 + i, `QA-ADM-${n}-${i}`, talle, precio, stock, i]);
  }
  ids[slug] = id;
  return { id, slug, colores };
}

const limpiar = async () => {
  await pool.query("DELETE FROM tienda.pedidos WHERE email LIKE 'qa-adm%'");
  await pool.query("DELETE FROM tienda.productos WHERE stocker_id >= $1 AND stocker_id < $2", [BASE, BASE + 1000]);
  await pool.query("DELETE FROM tienda.admins WHERE email LIKE 'qa-adm%'");
  await pool.query("DELETE FROM tienda.descuentos WHERE nombre LIKE 'QA adm%'");
  await pool.query("DELETE FROM tienda.cupones WHERE nombre LIKE 'QA adm%'");
  await pool.query("DELETE FROM tienda.guias_talles WHERE nombre LIKE 'QA adm%'");
  await pool.query("DELETE FROM tienda.categorias WHERE slug LIKE 'qa-adm%'");
  await pool.query("DELETE FROM tienda.redirecciones WHERE desde LIKE '/qa-adm%'");
  await pool.query("DELETE FROM tienda.banners WHERE alt LIKE 'QA adm%'");
  await pool.query("DELETE FROM tienda.transferencias_recibidas WHERE externo LIKE 'qa-adm-%'");
};

const IP = { "x-isu-interno": INTERNO, "x-isu-ip": "10.9.9.9" };
const req = (method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, token?: string, payload?: unknown) =>
  app.inject({ method, url, headers: { ...IP, ...(token ? { "x-isu-admin": token } : {}) }, ...(payload !== undefined ? { payload: payload as object } : {}) });

const ahora = () => Math.floor(Date.now() / 30_000);
const pasoTotp = ahora();
/* El servidor acepta el paso anterior, el actual y el siguiente, y nunca uno ya usado. */
const usados = new Map<string, number>();
function codigoNuevo(email: string) {
  const paso = Math.max((usados.get(email) ?? ahora() - 2) + 1, ahora() - 1);
  if (paso > ahora() + 1) throw new Error("demasiados ingresos seguidos para la prueba");
  usados.set(email, paso);
  return codigo(secretos.get(email)!, paso);
}
/** Ingreso completo: contraseña → doble factor (configurándolo si hace falta) → cambio de clave provisoria. */
async function ingresar(email: string, clave: string, nueva = "una-clave-nueva-larga") {
  const r1 = await req("POST", "/v1/admin/ingresar", undefined, { email, contrasena: clave });
  expect(r1.statusCode, r1.body).toBe(200);
  let pre = r1.json().token as string;
  if (r1.json().siguiente === "configurar_2fa") {
    secretos.set(email, (await req("POST", "/v1/admin/2fa/configurar", pre)).json().secreto);
    usados.delete(email);
  }
  const r2 = await req("POST", "/v1/admin/2fa", pre, { codigo: codigoNuevo(email) });
  expect(r2.statusCode, r2.body).toBe(200);
  pre = r2.json().token;
  if (r2.json().siguiente === "cambiar_clave") {
    const r3 = await req("POST", "/v1/admin/clave", pre, { actual: clave, nueva });
    expect(r3.statusCode, r3.body).toBe(204);
  }
  return pre;
}
const secretos = new Map<string, string>();
let dueno = "", operador = "", lectura = "";

beforeAll(async () => {
  await migrar(pool);
  await redis.flushdb();
  await limpiar();
  dirFotos = await mkdtemp(path.join(os.tmpdir(), "fotos-adm-"));
  const urlStocker = await levantarStocker();
  app = await construirApp({
    env: leerEntorno({
      NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: DB, REDIS_URL: REDIS, CACHE_SEGUNDOS: "0",
      INTERNO_TOKEN: INTERNO, ADMIN_CLAVE_CIFRADO: CLAVE_CIFRADO, FOTOS_DIR: dirFotos,
      STOCKER_API_URL: urlStocker, STOCKER_TOKEN: "s".repeat(30),
    }),
    pool, redis, colas,
  });
  await app.ready();
  await pool.query("INSERT INTO tienda.admins (email, nombre, hash, rol) VALUES ('qa-adm-dueno@test.com','Dueña QA',$1,'dueno')", [await hash("provisoria-1", ARGON_ADMIN)]);

  // Catálogo de "Mujer" para outfits, guías y descuentos.
  await producto(1, "Remera qa adm lisa", "mujer/remeras-y-tops", "Remeras", [
    ["negro", "#111111", "S", 1_000_000, 5], ["negro", "#111111", "M", 1_000_000, 5], ["rojo", "#c62828", "M", 1_100_000, 3], ["negro", "#111111", "L", 1_000_000, 0],
  ]);
  await producto(2, "Jogger qa adm frisa", "mujer/pantalones-y-calzas", "Joggers", [["gris", "#8a8a8a", "M", 2_000_000, 4], ["verde", "#2e7d4f", "M", 2_000_000, 4]]);
  await producto(3, "Campera qa adm puffer", "mujer/buzos-y-camperas", "Camperas", [["negro", "#111111", "M", 5_000_000, 2]]);
  await producto(4, "Remera qa adm nena", "ninos/remeras", "Remeras", [["rosa", "#f2a7bd", "8", 700_000, 5], ["rosa", "#f2a7bd", "10", 700_000, 5]]);
  await producto(5, "Top qa adm crop", "mujer/remeras-y-tops", "Tops", [["blanco", "#ffffff", "M", 900_000, 5], ["blanco", "#ffffff", "XXL", 900_000, 5]]);
});
afterAll(async () => {
  await limpiar();
  await app.close();
  await new Promise<void>((r) => servidor.close(() => r()));
  await redis.quit();
  await pool.end();
});

describe("ingreso con doble factor", () => {
  it("contraseña mal → 401 igual que un email que no existe", async () => {
    const a = await req("POST", "/v1/admin/ingresar", undefined, { email: "qa-adm-dueno@test.com", contrasena: "mal" });
    const b = await req("POST", "/v1/admin/ingresar", undefined, { email: "qa-adm-nadie@test.com", contrasena: "mal" });
    expect([a.statusCode, b.statusCode]).toEqual([401, 401]);
    expect(a.json().mensaje).toBe(b.json().mensaje);
  });
  it("sin el segundo paso no se entra a nada; con clave provisoria, sólo a cambiarla", async () => {
    const r1 = await req("POST", "/v1/admin/ingresar", undefined, { email: "qa-adm-dueno@test.com", contrasena: "provisoria-1" });
    expect(r1.json().siguiente).toBe("configurar_2fa");
    const pre = r1.json().token;
    expect((await req("GET", "/v1/admin/resumen", pre)).statusCode).toBe(401);
    const rc = await req("POST", "/v1/admin/2fa/configurar", pre);
    const { secreto, url } = rc.json();
    expect(url).toMatch(/^otpauth:\/\/totp\/.*secret=/);
    secretos.set("qa-adm-dueno@test.com", secreto);
    expect((await req("POST", "/v1/admin/2fa", pre, { codigo: "000000" })).statusCode).toBe(401);
    usados.set("qa-adm-dueno@test.com", pasoTotp);
    const r2 = await req("POST", "/v1/admin/2fa", pre, { codigo: codigo(secreto, pasoTotp) });
    expect(r2.json().siguiente).toBe("cambiar_clave");
    // El token del primer paso ya no sirve.
    expect((await req("GET", "/v1/admin/yo", pre)).statusCode).toBe(401);
    const tok = r2.json().token;
    expect((await req("GET", "/v1/admin/resumen", tok)).json().error).toBe("cambiar_clave");
    expect((await req("POST", "/v1/admin/clave", tok, { actual: "provisoria-1", nueva: "corta" })).statusCode).toBe(400);
    expect((await req("POST", "/v1/admin/clave", tok, { actual: "provisoria-1", nueva: "una-clave-nueva-larga" })).statusCode).toBe(204);
    expect((await req("GET", "/v1/admin/resumen", tok)).statusCode).toBe(200);
    dueno = tok;
  });
  it("el mismo código no sirve dos veces", async () => {
    const r1 = await req("POST", "/v1/admin/ingresar", undefined, { email: "qa-adm-dueno@test.com", contrasena: "una-clave-nueva-larga" });
    expect(r1.json().siguiente).toBe("codigo");
    const r = await req("POST", "/v1/admin/2fa", r1.json().token, { codigo: codigo(secretos.get("qa-adm-dueno@test.com")!, pasoTotp) });
    expect(r.statusCode).toBe(401);
  });
  it("30 minutos sin uso cierran la sesión", async () => {
    const tok = await ingresar("qa-adm-dueno@test.com", "una-clave-nueva-larga");
    await pool.query("UPDATE tienda.admin_sesiones SET visto_en = now() - interval '31 minutes' WHERE id = encode(sha256(convert_to($1, 'UTF8')), 'hex')", [tok]);
    expect((await req("GET", "/v1/admin/yo", tok)).statusCode).toBe(401);
  });
  it("5 intentos fallidos bloquean 30 minutos", async () => {
    await pool.query("INSERT INTO tienda.admins (email, nombre, hash, rol) VALUES ('qa-adm-bloq@test.com','B',$1,'lectura')", [await hash("provisoria-9", ARGON_ADMIN)]);
    // La auditoría no se borra entre corridas: se cuenta desde acá.
    const desde = (await pool.query("SELECT COALESCE(max(id), 0) AS id FROM tienda.auditoria")).rows[0].id;
    for (let i = 0; i < 5; i++) await req("POST", "/v1/admin/ingresar", undefined, { email: "qa-adm-bloq@test.com", contrasena: "mal" });
    const r = await req("POST", "/v1/admin/ingresar", undefined, { email: "qa-adm-bloq@test.com", contrasena: "provisoria-9" });
    expect(r.statusCode).toBe(423);
    const aud = await pool.query("SELECT count(*)::int AS n FROM tienda.auditoria WHERE actor = 'qa-adm-bloq@test.com' AND accion = 'ingreso_fallido' AND id > $1", [desde]);
    expect(aud.rows[0].n).toBe(5);
  });
});

describe("usuarios y roles", () => {
  it("el dueño crea usuarios con clave provisoria; cada rol ve lo suyo", async () => {
    const op = await req("POST", "/v1/admin/usuarios", dueno, { email: "QA-ADM-op@test.com", nombre: "Operador", rol: "operador" });
    expect(op.statusCode).toBe(201);
    const le = await req("POST", "/v1/admin/usuarios", dueno, { email: "qa-adm-lec@test.com", nombre: "Lectura", rol: "lectura" });
    expect((await req("POST", "/v1/admin/usuarios", dueno, { email: "qa-adm-lec@test.com", nombre: "Otra", rol: "lectura" })).statusCode).toBe(409);
    operador = await ingresar("qa-adm-op@test.com", op.json().claveProvisoria);
    lectura = await ingresar("qa-adm-lec@test.com", le.json().claveProvisoria);
    expect((await req("GET", "/v1/admin/productos", lectura)).statusCode).toBe(200);
    expect((await req("PATCH", `/v1/admin/productos/${ids["qa-adm-1"]}`, lectura, { visible: false })).json().error).toBe("sin_permiso");
    expect((await req("GET", "/v1/admin/ajustes", operador)).json().error).toBe("sin_permiso");
    expect((await req("GET", "/v1/admin/usuarios", operador)).statusCode).toBe(403);
    expect((await req("GET", "/v1/admin/auditoria", operador)).statusCode).toBe(403);
  });
  it("no se puede sacar al último dueño ni desactivarse a uno mismo", async () => {
    const yo = (await pool.query("SELECT id FROM tienda.admins WHERE email = 'qa-adm-dueno@test.com'")).rows[0].id;
    expect((await req("PATCH", `/v1/admin/usuarios/${yo}`, dueno, { activo: false })).json().error).toBe("propio");
    const otros = await pool.query("SELECT count(*)::int AS n FROM tienda.admins WHERE rol = 'dueno' AND activo AND email NOT LIKE 'qa-adm%'");
    if (otros.rows[0].n === 0) {
      const op = (await pool.query("SELECT id FROM tienda.admins WHERE email = 'qa-adm-op@test.com'")).rows[0].id;
      expect((await req("PATCH", `/v1/admin/usuarios/${op}`, dueno, { rol: "lectura" })).statusCode).toBe(200);
      expect((await req("PATCH", `/v1/admin/usuarios/${op}`, dueno, { rol: "operador" })).statusCode).toBe(200);
      // Cambiarle el rol cierra sus sesiones.
      expect((await req("GET", "/v1/admin/yo", operador)).statusCode).toBe(401);
      operador = await ingresar("qa-adm-op@test.com", "una-clave-nueva-larga", "otra-clave-nueva-larga");
    }
  });
  it("restablecer: clave provisoria nueva, doble factor de cero, sesiones cerradas", async () => {
    const lec = (await pool.query("SELECT id FROM tienda.admins WHERE email = 'qa-adm-lec@test.com'")).rows[0].id;
    const r = await req("POST", `/v1/admin/usuarios/${lec}/restablecer`, dueno);
    expect(r.json().claveProvisoria).toHaveLength(16);
    expect((await req("GET", "/v1/admin/yo", lectura)).statusCode).toBe(401);
    const r1 = await req("POST", "/v1/admin/ingresar", undefined, { email: "qa-adm-lec@test.com", contrasena: r.json().claveProvisoria });
    expect(r1.json().siguiente).toBe("configurar_2fa");
  });
});

describe("productos: destacados, nuevos, edición masiva", () => {
  it("las casillas Destacado y Nuevo arman las colecciones de la tienda", async () => {
    const id = ids["qa-adm-3"]!;
    enviados.length = 0;
    const r = await req("PATCH", `/v1/admin/productos/${id}`, operador, { destacado: true, nuevo: true, destacadoOrden: -500 });
    expect(r.statusCode, r.body).toBe(200);
    expect(enviados.some((e) => e.nombre === "invalidar" && (e.datos.slugs as string[]).includes("qa-adm-3"))).toBe(true);
    const d = (await app.inject("/v1/productos?coleccion=destacados&limite=50")).json().productos;
    expect(d[0].slug).toBe("qa-adm-3");
    const n = (await app.inject("/v1/productos?coleccion=nuevos&limite=50")).json().productos;
    expect(n.find((p: { slug: string }) => p.slug === "qa-adm-3")).toMatchObject({ nuevo: true });
    const det = (await req("GET", `/v1/admin/productos/${id}`, operador)).json();
    expect(det.producto).toMatchObject({ destacado: true, nuevo: true, parteOutfitSugerida: "abrigo" });
    const aud = await pool.query("SELECT detalle FROM tienda.auditoria WHERE accion = 'editar_producto' AND entidad_id = $1 ORDER BY id DESC LIMIT 1", [String(id)]);
    expect(aud.rows[0].detalle).toMatchObject({ destacado: true });
  });
  it("masivo: nuevo a varios; lo recién marcado va primero; destildar lo saca", async () => {
    const r = await req("POST", "/v1/admin/productos/masivo", operador, { ids: [ids["qa-adm-1"], ids["qa-adm-2"]], cambios: { nuevo: true } });
    expect(r.json()).toEqual({ ok: true, productos: 2 });
    const n = (await app.inject("/v1/productos?coleccion=nuevos&limite=200")).json().productos.map((p: { slug: string }) => p.slug);
    expect(n.indexOf("qa-adm-1")).toBeLessThan(n.indexOf("qa-adm-3"));
    await req("POST", "/v1/admin/productos/masivo", operador, { ids: [ids["qa-adm-2"]], cambios: { nuevo: false } });
    const n2 = (await app.inject("/v1/productos?coleccion=nuevos&limite=200")).json().productos.map((p: { slug: string }) => p.slug);
    expect(n2).not.toContain("qa-adm-2");
  });
  it("filtros del listado y cambios que no se aceptan", async () => {
    const d = (await req("GET", "/v1/admin/productos?filtro=destacados&q=qa%20adm", operador)).json();
    expect(d.productos.map((p: { sku: string }) => p.sku)).toEqual(["QA-ADM-3"]);
    expect((await req("PATCH", `/v1/admin/productos/${ids["qa-adm-1"]}`, operador, { precio: 1 })).statusCode).toBe(400);
    expect((await req("PATCH", `/v1/admin/productos/${ids["qa-adm-1"]}`, operador, { categorias: [999999] })).statusCode).toBe(400);
    expect((await req("PATCH", "/v1/admin/productos/99999999", operador, { visible: true })).statusCode).toBe(404);
  });
  it("editar el nombre lo fija (la sincronización con Stocker ya no lo pisa)", async () => {
    await req("PATCH", `/v1/admin/productos/${ids["qa-adm-5"]}`, operador, { nombre: "Top qa adm crop cuadrillé" });
    const r = await pool.query("SELECT nombre, nombre_fijo FROM tienda.productos WHERE id = $1", [ids["qa-adm-5"]]);
    expect(r.rows[0]).toEqual({ nombre: "Top qa adm crop cuadrillé", nombre_fijo: true });
  });
});

describe("fotos", () => {
  const jpg = () => sharp({ create: { width: 900, height: 1200, channels: 3, background: "#c33" } }).jpeg().toBuffer();
  const subir = async (id: number, q: string, cuerpo: Buffer, tipo = "image/jpeg") =>
    app.inject({ method: "POST", url: `/v1/admin/productos/${id}/fotos?${q}`, headers: { ...IP, "x-isu-admin": operador, "content-type": tipo }, payload: cuerpo });
  it("sube, guarda los 3 tamaños en webp y respeta el tope de 5 por color", async () => {
    const id = ids["qa-adm-3"]!;
    const color = (await pool.query("SELECT id FROM tienda.producto_colores WHERE producto_id = $1", [id])).rows[0].id;
    const r = await subir(id, `tipo=color&color=${color}`, await jpg());
    expect(r.statusCode, r.body).toBe(201);
    const archivos = await readdir(path.join(dirFotos, "p", String(id)));
    expect(archivos.filter((a) => a.startsWith(r.json().clave.split("/")[2])).sort()).toHaveLength(3);
    for (let i = 0; i < 4; i++) expect((await subir(id, `tipo=exhibicion`, await jpg())).statusCode).toBe(201);
    // 1 color → tope 5 fotos en total.
    const tope = await subir(id, `tipo=color&color=${color}`, await jpg());
    expect(tope.statusCode).toBe(409);
    expect(tope.json().error).toBe("tope_fotos");
  });
  it("rechaza lo que no es imagen y el color de otro producto", async () => {
    expect((await subir(ids["qa-adm-1"]!, "tipo=exhibicion", Buffer.from("%PDF-1.4 hola"))).json().error).toBe("foto_invalida");
    expect((await subir(ids["qa-adm-1"]!, "tipo=exhibicion", Buffer.from("x"), "application/pdf")).statusCode).toBe(415);
    const otro = (await pool.query("SELECT id FROM tienda.producto_colores WHERE producto_id = $1", [ids["qa-adm-3"]])).rows[0].id;
    expect((await subir(ids["qa-adm-1"]!, `tipo=color&color=${otro}`, await jpg())).json().error).toBe("color");
  });
  it("ordenar y borrar", async () => {
    const fotos = (await req("GET", `/v1/admin/productos/${ids["qa-adm-3"]}`, operador)).json().fotos as Array<{ id: number }>;
    const orden = fotos.map((f) => f.id).reverse();
    expect((await req("POST", `/v1/admin/productos/${ids["qa-adm-3"]}/fotos/orden`, operador, { ids: orden })).json().ordenadas).toBe(5);
    expect((await req("DELETE", `/v1/admin/fotos/${orden[0]}`, operador)).statusCode).toBe(200);
    expect((await req("DELETE", `/v1/admin/fotos/${orden[0]}`, operador)).statusCode).toBe(404);
  });
});

describe("categorías y descuentos", () => {
  it("categorías: alta, dos niveles como máximo, no se borra con productos", async () => {
    const mujer = (await pool.query("SELECT id FROM tienda.categorias WHERE slug = 'mujer' AND padre_id IS NULL")).rows[0].id;
    const r = await req("POST", "/v1/admin/categorias", operador, { nombre: "QA Vestidos", slug: "qa-adm-vestidos", padreId: mujer });
    expect(r.statusCode).toBe(201);
    expect((await req("POST", "/v1/admin/categorias", operador, { nombre: "QA nieta", slug: "qa-adm-nieta", padreId: r.json().id })).json().error).toBe("niveles");
    expect((await req("POST", "/v1/admin/categorias", operador, { nombre: "QA Vestidos", slug: "qa-adm-vestidos", padreId: mujer })).json().error).toBe("slug");
    expect((await req("DELETE", `/v1/admin/categorias/${mujer}`, operador)).json().error).toBe("en_uso");
    expect((await req("DELETE", `/v1/admin/categorias/${r.json().id}`, operador)).statusCode).toBe(200);
  });
  it("un descuento por producto baja el precio en la tienda y muestra el de antes", async () => {
    const mal = await req("POST", "/v1/admin/descuentos", operador, { nombre: "QA adm malo", porcentaje: 20, alcance: "productos" });
    expect(mal.statusCode).toBe(400);
    const r = await req("POST", "/v1/admin/descuentos", operador, { nombre: "QA adm jogger", porcentaje: 20, alcance: "productos", productoIds: [ids["qa-adm-2"]] });
    expect(r.statusCode).toBe(201);
    const p = (await app.inject("/v1/productos/qa-adm-2")).json();
    expect(p).toMatchObject({ precio: 1_600_000, precioLista: 2_000_000, descuento: 20 });
    // Vencido: deja de aplicar.
    await req("PUT", `/v1/admin/descuentos/${r.json().id}`, operador, { nombre: "QA adm jogger", porcentaje: 20, alcance: "productos", productoIds: [ids["qa-adm-2"]], hasta: "2020-01-02T00:00:00Z", desde: "2020-01-01T00:00:00Z" });
    expect((await app.inject("/v1/productos/qa-adm-2")).json().descuento).toBeNull();
  });
});

describe("guías de talles", () => {
  const guia = (extra: Record<string, unknown> = {}) => ({
    nombre: "QA adm remera regular", tipo: "adulto", medidas: ["pecho", "cintura", "largo"],
    filas: [
      { talle: "S", valores: [[86, 91], [70, 75], [68, 68]] },
      { talle: "M", valores: [[91, 96], [75, 80], [70, 70]] },
      { talle: "L", valores: [[96, 101], [80, 85], [72, 72]] },
    ],
    nota: "Medidas del cuerpo en cm.", ...extra,
  });
  let guiaId = 0;
  it("valida los talles según el tipo (niños 4–16, adulto XS–5XL)", async () => {
    const r = await req("POST", "/v1/admin/guias-talles", operador, guia({ filas: [{ talle: "10", valores: [[1, 2], null, null] }] }));
    expect(r.statusCode).toBe(400);
    expect((await req("POST", "/v1/admin/guias-talles", operador, guia({ medidas: ["pecho", "pecho"] }))).statusCode).toBe(400);
    const ok = await req("POST", "/v1/admin/guias-talles", operador, guia());
    expect(ok.statusCode, ok.body).toBe(201);
    guiaId = ok.json().id;
    expect((await req("POST", "/v1/admin/guias-talles", operador, guia({ nombre: "QA ADM remera regular" }))).json().error).toBe("nombre");
  });
  it("lista los productos que coinciden con los talles de la guía", async () => {
    const c = (await req("GET", `/v1/admin/guias-talles/${guiaId}/candidatos?q=qa%20adm`, operador)).json();
    const skus = c.productos.map((p: { sku: string }) => p.sku).sort();
    // La de nena (8/10) y el top con XXL no coinciden.
    expect(skus).toEqual(["QA-ADM-1", "QA-ADM-2", "QA-ADM-3"]);
    const todos = (await req("GET", `/v1/admin/guias-talles/${guiaId}/candidatos?q=qa%20adm&solo=todos`, operador)).json();
    expect(todos.productos.find((p: { sku: string }) => p.sku === "QA-ADM-5")).toMatchObject({ coincide: false, talles: ["M", "XXL"] });
  });
  it("asociada, la ficha del producto la muestra; al editarla se regeneran esas fichas", async () => {
    const r = await req("POST", `/v1/admin/guias-talles/${guiaId}/productos`, operador, { agregar: [ids["qa-adm-1"], ids["qa-adm-2"], ids["qa-adm-3"]] });
    expect(r.json().cambiados).toBe(3);
    const p = (await app.inject("/v1/productos/qa-adm-1")).json();
    expect(p.guiaTalles).toMatchObject({ nombre: "QA adm remera regular", tipo: "adulto" });
    expect(p.guiaTalles.medidas.map((m: { clave: string; tipo: string }) => `${m.clave}:${m.tipo}`)).toEqual(["pecho:cuerpo", "cintura:cuerpo", "largo:prenda"]);
    expect(p.guiaTalles.filas.map((f: { talle: string }) => f.talle)).toEqual(["S", "M", "L"]);
    enviados.length = 0;
    await req("PUT", `/v1/admin/guias-talles/${guiaId}`, operador, guia({ nota: "Nueva nota" }));
    const inv = enviados.find((e) => e.nombre === "invalidar")!;
    expect((inv.datos.slugs as string[]).sort()).toEqual(["qa-adm-1", "qa-adm-2", "qa-adm-3"]);
    expect((await app.inject("/v1/productos/qa-adm-1")).json().guiaTalles.nota).toBe("Nueva nota");
  });
  it("sin guía, la ficha no muestra ninguna", async () => {
    expect((await app.inject("/v1/productos/qa-adm-5")).json().guiaTalles).toBeNull();
  });
});

describe("armá tu outfit", () => {
  const pedir = (b: Record<string, unknown>) => app.inject({ method: "POST", url: "/v1/outfits", payload: { para: "mujer", presupuesto: 100_000_00, ...b } });
  const deQa = (piezas: Array<{ slug: string }>) => piezas.every((p) => p.slug.startsWith("qa-adm-"));
  it("arma arriba + abajo en el talle pedido, dentro del presupuesto", async () => {
    const r = await pedir({ talle: "M", presupuesto: 100_000_00 });
    expect(r.statusCode, r.body).toBe(200);
    const o = r.json().outfits.filter((x: { piezas: Array<{ slug: string }> }) => deQa(x.piezas));
    expect(o.length).toBeGreaterThan(0);
    for (const x of r.json().outfits) {
      expect(x.piezas.map((p: { parte: string }) => p.parte)).toEqual(["arriba", "abajo"]);
      expect(x.total).toBeLessThanOrEqual(100_000_00);
      for (const p of x.piezas) if (p.slug.startsWith("qa-adm")) expect(p.talle).toBe("M");
    }
    // Rojo + verde no combinan: nunca salen juntos.
    const colores = r.json().outfits.map((x: { piezas: Array<{ color: { clave: string } }> }) => x.piezas.map((p) => p.color?.clave).sort().join("+"));
    expect(colores).not.toContain("rojo+verde");
  });
  it("sin plata suficiente dice desde cuánto hay", async () => {
    const r = (await pedir({ talle: "M", presupuesto: 500_00, partes: ["arriba", "abajo", "abrigo"] })).json();
    expect(r.motivo).toBe("presupuesto");
    expect(r.minimo).toBeGreaterThan(500_00);
  });
  it("con medidas en vez de talle usa la guía de cada prenda", async () => {
    // Con pecho 88 le va S; el jogger y la campera sólo hay en M: se pide sólo la parte de arriba.
    const r = (await pedir({ medidas: { pecho: 88, cintura: 72 }, presupuesto: 100_000_00, partes: ["arriba"] })).json();
    const qa = r.outfits.flatMap((x: { piezas: Array<{ slug: string; talle: string; talleRecomendado: boolean }> }) => x.piezas).filter((p: { slug: string }) => p.slug === "qa-adm-1");
    expect(qa.length).toBeGreaterThan(0);
    expect(qa.every((p: { talle: string; talleRecomendado: boolean }) => p.talle === "S" && p.talleRecomendado)).toBe(true);
    // El top sin guía no puede recomendarse por medidas.
    expect(JSON.stringify(r)).not.toContain("qa-adm-5");
  });
  it("preferencia de color: al menos una prenda de esa familia", async () => {
    const r = (await pedir({ talle: "M", familias: ["rojos"] })).json();
    for (const x of r.outfits) expect(x.piezas.some((p: { color: { hex: string } }) => p.color?.hex === "#c62828")).toBe(true);
  });
  it("cambiar una prenda: alternativas con lo que queda del presupuesto", async () => {
    const r = (await pedir({ talle: "M", presupuesto: 3_000_000, reemplazar: { parte: "arriba", fijos: ["QA-ADM-2-1"], excluir: [] } })).json();
    expect(r.alternativas.length).toBeGreaterThan(0);
    expect(r.alternativas.every((p: { precio: number; parte: string }) => p.precio <= 1_000_000 && p.parte === "arriba")).toBe(true);
  });
  it("valida: talle o medidas, presupuesto razonable", async () => {
    expect((await pedir({})).statusCode).toBe(400);
    expect((await pedir({ talle: "M", presupuesto: -1 })).statusCode).toBe(400);
    expect((await pedir({ talle: "M", medidas: { pecho: 9999 } })).statusCode).toBe(400);
  });
});

describe("pedidos", () => {
  const crear = async (estado: string, medio = "local") => {
    const r = await pool.query(
      `INSERT INTO tienda.pedidos (acceso_hash,email,nombre,apellido,telefono,dni,entrega,local_retiro,medio_pago,subtotal,total,estado,vence_en)
       VALUES ($1,'qa-adm-cli@test.com','Ana','QA','1','2','retiro','Flores',$2,1000000,1000000,$3, now() + interval '1 day') RETURNING numero`, ["c".repeat(64), medio, estado]);
    return r.rows[0].numero as string;
  };
  it("registrar el cobro en el local lo marca pagado y le avisa a Stocker", async () => {
    const n = await crear("a_pagar_en_local");
    enviados.length = 0;
    const r = await req("POST", `/v1/admin/pedidos/${n}/pago`, operador, { medio: "local", monto: 1000000, referencia: "caja-1" });
    expect(r.json()).toMatchObject({ estado: "pagado" });
    expect(enviados.some((e) => e.nombre === "pagado")).toBe(true);
    expect((await req("POST", `/v1/admin/pedidos/${n}/entrega`, operador, { estado: "entregado" })).json().error).toBe("transicion");
    expect((await req("POST", `/v1/admin/pedidos/${n}/entrega`, operador, { estado: "retirado" })).statusCode).toBe(200);
    const d = (await req("GET", `/v1/admin/pedidos/${n}`, operador)).json();
    expect(d.eventos.map((e: { estado: string }) => e.estado)).toEqual(["pagado", "retirado"]);
    expect(d.pedido.acceso_hash).toBeUndefined();
  });
  it("cancelar uno pendiente devuelve lo apartado en Stocker", async () => {
    const n = await crear("esperando_transferencia", "transferencia");
    const r = await req("POST", `/v1/admin/pedidos/${n}/cancelar`, operador, { motivo: "Lo pidió la clienta" });
    expect(r.json()).toMatchObject({ estado: "cancelado", reembolsar: false });
    expect(cancelados.has(n)).toBe(true);
    expect((await req("POST", `/v1/admin/pedidos/${n}/cancelar`, operador, { motivo: "otra vez" })).statusCode).toBe(409);
  });
  it("notas internas y buscador", async () => {
    const n = await crear("a_pagar_en_local");
    await req("POST", `/v1/admin/pedidos/${n}/notas`, operador, { notas: "Viene el sábado" });
    const l = (await req("GET", "/v1/admin/pedidos?q=qa-adm-cli", operador)).json();
    expect(l.total).toBeGreaterThanOrEqual(3);
    expect((await req("GET", `/v1/admin/pedidos/${n}`, operador)).json().pedido.notas_internas).toBe("Viene el sábado");
    // Comodines de LIKE escapados: "%" no trae todo.
    expect((await req("GET", "/v1/admin/pedidos?q=%25%25%25", operador)).json().total).toBe(0);
  });
});

describe("ajustes (sólo el dueño)", () => {
  it("valida cada clave y rechaza las desconocidas", async () => {
    const mal = await req("PUT", "/v1/admin/ajustes", dueno, { datosTransferencia: { titular: "X", cuit: "1", banco: "B", cbu: "123", alias: "a" } });
    expect(mal.statusCode).toBe(400);
    expect((await req("PUT", "/v1/admin/ajustes", dueno, { hackeado: true })).statusCode).toBe(400);
    expect((await req("PUT", "/v1/admin/ajustes", dueno, JSON.parse('{"__proto__": {"x": 1}}'))).statusCode).toBe(400);
    const ok = await req("PUT", "/v1/admin/ajustes", dueno, { avisoUltimas: 4 });
    expect(ok.json()).toEqual({ ok: true, guardados: ["avisoUltimas"] });
    expect((await app.inject("/v1/config")).json().avisoUltimas).toBe(4);
    await req("PUT", "/v1/admin/ajustes", dueno, { avisoUltimas: 3 });
  });
  it("la auditoría registra quién cambió qué", async () => {
    const a = (await req("GET", "/v1/admin/auditoria?entidad=ajuste", dueno)).json().registros;
    expect(a[0]).toMatchObject({ actor: "qa-adm-dueno@test.com", accion: "ajustes", ip: "10.9.9.9" });
  });
});

let lectura2 = "";
describe("cupones y promociones", () => {
  const base = { nombre: "QA adm 10% en todo", tipo: "porcentaje", valor: 10 };
  beforeAll(async () => {
    // La de lectura de más arriba quedó restablecida: una nueva para estas pruebas.
    const le = await req("POST", "/v1/admin/usuarios", dueno, { email: "qa-adm-lec2@test.com", nombre: "Lectura 2", rol: "lectura" });
    lectura2 = await ingresar("qa-adm-lec2@test.com", le.json().claveProvisoria);
  });
  it("crear, listar, editar; el código se guarda en mayúsculas y no se repite", async () => {
    const r = await req("POST", "/v1/admin/cupones", operador, { ...base, codigo: "qa-adm-10" });
    expect(r.statusCode, r.body).toBe(201);
    const id = r.json().id;
    expect((await req("POST", "/v1/admin/cupones", operador, { ...base, codigo: "QA-ADM-10" })).json()).toMatchObject({ error: "codigo_repetido" });
    const l = (await req("GET", "/v1/admin/cupones", lectura2)).json().cupones.find((c: { id: number }) => c.id === id);
    expect(l).toMatchObject({ codigo: "QA-ADM-10", vigente: true, usos: 0, pedidosPagados: 0, descontado: 0 });
    const e = await req("PUT", `/v1/admin/cupones/${id}`, operador, { ...base, codigo: "QA-ADM-10", nombre: "QA adm pausado", activo: false });
    expect(e.statusCode, e.body).toBe(200);
    expect((await req("GET", "/v1/admin/cupones", operador)).json().cupones.find((c: { id: number }) => c.id === id).vigente).toBe(false);
    const aud = (await req("GET", "/v1/admin/auditoria?entidad=cupon", dueno)).json().registros;
    expect(aud.slice(0, 2).map((a: { accion: string }) => a.accion)).toEqual(["editar_cupon", "crear_cupon"]);
  });
  it("valida: porcentaje 1-90, monto mínimo $1, promo sin código, cupón con código, fechas en orden, alcance con elementos", async () => {
    const mal = [
      { ...base, codigo: "QAADM1", valor: 95 },
      { ...base, codigo: "QAADM2", tipo: "monto", valor: 50 },
      { ...base, codigo: "QAADM3", automatico: true },
      { ...base },
      { ...base, codigo: "QA ADM" },
      { ...base, codigo: "QAADM4", desde: "2026-10-10T00:00:00Z", hasta: "2026-10-01T00:00:00Z" },
      { ...base, codigo: "QAADM5", alcance: "categorias", categoriaIds: [] },
      { ...base, codigo: "QAADM6", usos: 99 },
      { ...base, automatico: true, usosPorCliente: 1 },
    ];
    for (const b of mal) expect((await req("POST", "/v1/admin/cupones", operador, b)).statusCode, JSON.stringify(b)).toBe(400);
    const promo = await req("POST", "/v1/admin/cupones", operador, { nombre: "QA adm envío gratis desde $50.000", tipo: "envio_gratis", valor: 0, automatico: true, minimo: 5_000_000 });
    expect(promo.statusCode, promo.body).toBe(201);
  });
  it("lectura no crea; un cupón usado no se borra (se desactiva)", async () => {
    expect((await req("POST", "/v1/admin/cupones", lectura2, { ...base, codigo: "QAADMLEC" })).json().error).toBe("sin_permiso");
    const id = (await req("POST", "/v1/admin/cupones", operador, { ...base, codigo: "QAADMUSADO" })).json().id;
    const pedido = await pool.query(
      `INSERT INTO tienda.pedidos (acceso_hash, email, nombre, apellido, telefono, dni, entrega, local_retiro, medio_pago, subtotal, descuento_cupon, descuento, envio, total, estado, cupon_id, cupon_codigo)
       VALUES ('x','qa-adm-cup@test.com','A','B','1','1','retiro','L','local',1000000,100000,0,0,900000,'pagado',$1,'QAADMUSADO') RETURNING id`, [id]);
    expect(pedido.rowCount).toBe(1);
    expect((await req("DELETE", `/v1/admin/cupones/${id}`, operador)).statusCode).toBe(409);
    const sinUso = (await req("POST", "/v1/admin/cupones", operador, { ...base, codigo: "QAADMBORRAR" })).json().id;
    expect((await req("DELETE", `/v1/admin/cupones/${sinUso}`, operador)).statusCode).toBe(200);
  });
});

describe("colores y talles (importación del mayorista)", () => {
  it("renombrar un color lo fija; null lo devuelve a Stocker", async () => {
    const det = (await req("GET", `/v1/admin/productos/${ids["qa-adm-3"]}`, operador)).json();
    const c = det.colores[0];
    expect((await req("PATCH", `/v1/admin/colores/${c.id}`, operador, { nombre: "Negro azabache" })).statusCode).toBe(200);
    let d2 = (await req("GET", `/v1/admin/productos/${ids["qa-adm-3"]}`, operador)).json().colores[0];
    expect([d2.nombre, d2.nombreFijo, d2.hex]).toEqual(["Negro azabache", true, c.hex]);
    await req("PATCH", `/v1/admin/colores/${c.id}`, operador, { nombre: null });
    d2 = (await req("GET", `/v1/admin/productos/${ids["qa-adm-3"]}`, operador)).json().colores[0];
    expect(d2.nombreFijo).toBe(false);
    expect((await req("PATCH", `/v1/admin/colores/${c.id}`, operador, { nombre: "x" })).statusCode).toBe(400);
  });
  it("ocultar un talle lo saca de la tienda; mostrarlo lo vuelve a poner", async () => {
    const r = await req("PATCH", "/v1/admin/variantes/QA-ADM-5-2", operador, { oculta: true });
    expect(r.statusCode, r.body).toBe(200);
    const ficha = async () => (await app.inject("/v1/productos/qa-adm-5")).json();
    expect((await ficha()).variantes.map((v: { talle: string }) => v.talle)).toEqual(["M"]);
    await req("PATCH", "/v1/admin/variantes/QA-ADM-5-2", operador, { oculta: false });
    expect((await ficha()).variantes.map((v: { talle: string }) => v.talle)).toEqual(["M", "XXL"]);
    expect((await req("PATCH", "/v1/admin/variantes/NO-EXISTE-9", operador, { oculta: true })).statusCode).toBe(404);
    expect((await req("PATCH", "/v1/admin/variantes/QA-ADM-5-2", lectura2, { oculta: true })).json().error).toBe("sin_permiso");
  });
});

describe("redirecciones de la tienda anterior (SEO)", () => {
  const mapa = async () => (await app.inject({ url: "/v1/redirecciones", headers: IP })).json().mapa as Record<string, string>;
  it("trae las de Jumpseller de la migración, sin la raíz ni las que no cambian", async () => {
    const m = await mapa();
    expect(m["/contact"]).toBe("/locales");
    expect(m["/minorista/hombre/remeras"]).toBe("/hombre/remeras");
    expect(m["/"]).toBeUndefined();
    expect(m["/hombre"]).toBeUndefined();
  });
  it("con SKU va a la ficha mientras está publicada; si no, al plan B", async () => {
    const r = await req("POST", "/v1/admin/redirecciones", operador, { desde: "https://www.isuwaya.com/QA-ADM-Remera-Vieja/", hacia: "/mujer/remeras-y-tops", sku: "qa-adm-1" });
    expect(r.statusCode, r.body).toBe(201);
    expect((await mapa())["/qa-adm-remera-vieja"]).toBe("/producto/qa-adm-1");
    // También por el SKU de un talle (en Jumpseller a veces se cargó ése).
    await req("POST", "/v1/admin/redirecciones", operador, { desde: "/qa-adm-por-talle", hacia: "/", sku: "QA-ADM-2-1" });
    expect((await mapa())["/qa-adm-por-talle"]).toBe("/producto/qa-adm-2");
    await pool.query("UPDATE tienda.productos SET visible = false WHERE id = $1", [ids["qa-adm-1"]]);
    expect((await mapa())["/qa-adm-remera-vieja"]).toBe("/mujer/remeras-y-tops");
    await pool.query("UPDATE tienda.productos SET visible = true WHERE id = $1", [ids["qa-adm-1"]]);
    const lista = (await req("GET", "/v1/admin/redirecciones", lectura2)).json().redirecciones;
    expect(lista.find((x: { desde: string }) => x.desde === "/qa-adm-remera-vieja")).toMatchObject({ sku: "QA-ADM-1", origen: "manual", destino: "/producto/qa-adm-1", producto: { slug: "qa-adm-1", publicado: true } });
  });
  it("sigue las cadenas y no deja armar un círculo", async () => {
    await req("POST", "/v1/admin/redirecciones", operador, { desde: "/qa-adm-a", hacia: "/qa-adm-b" });
    await req("POST", "/v1/admin/redirecciones", operador, { desde: "/qa-adm-b", hacia: "/hombre" });
    expect((await mapa())["/qa-adm-a"]).toBe("/hombre"); // un solo salto
    const c = await req("POST", "/v1/admin/redirecciones", operador, { desde: "/qa-adm-hombre-c", hacia: "/qa-adm-a" });
    expect(c.statusCode).toBe(201);
    const b = (await req("GET", "/v1/admin/redirecciones", operador)).json().redirecciones.find((x: { desde: string }) => x.desde === "/qa-adm-b");
    const vuelta = await req("PUT", `/v1/admin/redirecciones/${b.id}`, operador, { desde: "/qa-adm-b", hacia: "/qa-adm-hombre-c", sku: null });
    expect(vuelta.statusCode).toBe(409);
    expect(vuelta.json().error).toBe("circulo");
  });
  it("rechaza destinos de otro sitio, duplicados y a quien no tiene permiso", async () => {
    for (const hacia of ["//evil.com", "/\\evil.com", "javascript:alert(1)", "hombre"]) {
      expect((await req("POST", "/v1/admin/redirecciones", operador, { desde: "/qa-adm-mala", hacia })).statusCode, hacia).toBe(400);
    }
    // Una dirección completa de otro dominio: se queda con la ruta (nunca redirige afuera).
    const r = await req("POST", "/v1/admin/redirecciones", operador, { desde: "/qa-adm-afuera", hacia: "https://evil.com/locales" });
    expect(r.statusCode).toBe(201);
    expect((await mapa())["/qa-adm-afuera"]).toBe("/locales");
    expect((await req("POST", "/v1/admin/redirecciones", operador, { desde: "/QA-ADM-afuera", hacia: "/" })).json().error).toBe("repetida");
    expect((await req("POST", "/v1/admin/redirecciones", operador, { desde: "/api/x", hacia: "/" })).statusCode).toBe(400);
    expect((await req("POST", "/v1/admin/redirecciones", lectura2, { desde: "/qa-adm-z", hacia: "/" })).json().error).toBe("sin_permiso");
    expect((await app.inject({ method: "GET", url: "/v1/admin/redirecciones", headers: IP })).statusCode).toBe(401);
  });
  it("editar y borrar queda en la auditoría", async () => {
    const r = (await req("GET", "/v1/admin/redirecciones", operador)).json().redirecciones.find((x: { desde: string }) => x.desde === "/qa-adm-afuera");
    expect((await req("PUT", `/v1/admin/redirecciones/${r.id}`, operador, { desde: "/qa-adm-afuera", hacia: "/mujer", sku: null })).statusCode).toBe(200);
    expect((await mapa())["/qa-adm-afuera"]).toBe("/mujer");
    expect((await req("DELETE", `/v1/admin/redirecciones/${r.id}`, operador)).statusCode).toBe(200);
    expect((await mapa())["/qa-adm-afuera"]).toBeUndefined();
    expect((await req("DELETE", `/v1/admin/redirecciones/${r.id}`, operador)).statusCode).toBe(404);
    const aud = await pool.query("SELECT accion FROM tienda.auditoria WHERE entidad = 'redireccion' AND entidad_id = $1 ORDER BY id", [String(r.id)]);
    expect(aud.rows.map((x) => x.accion)).toEqual(["crear_redireccion", "editar_redireccion", "borrar_redireccion"]);
  });
  it("el texto de una categoría llega a la tienda", async () => {
    const mujer = (await req("GET", "/v1/admin/categorias", operador)).json().categorias.find((c: { slug: string; padreId: number | null }) => c.slug === "mujer" && !c.padreId);
    const antes = { seoTitulo: mujer.seoTitulo, seoDescripcion: mujer.seoDescripcion, texto: mujer.texto };
    expect((await req("PATCH", `/v1/admin/categorias/${mujer.id}`, operador, { seoTitulo: "Ropa de mujer urbana", texto: "Párrafo uno.\n\nPárrafo dos." })).statusCode).toBe(200);
    const pub = (await app.inject("/v1/categorias")).json().find((c: { slug: string }) => c.slug === "mujer");
    expect(pub).toMatchObject({ seoTitulo: "Ropa de mujer urbana", texto: "Párrafo uno.\n\nPárrafo dos." });
    // Un cambio parcial no toca lo que no se mandó (el orden en el menú, si está visible).
    const despues = (await req("GET", "/v1/admin/categorias", operador)).json().categorias.find((c: { id: number }) => c.id === mujer.id);
    expect([despues.orden, despues.visible]).toEqual([mujer.orden, mujer.visible]);
    expect((await req("PATCH", `/v1/admin/categorias/${mujer.id}`, operador, { texto: "x".repeat(3001) })).statusCode).toBe(400);
    await req("PATCH", `/v1/admin/categorias/${mujer.id}`, operador, antes);
  });
});

// ── Etapa 8 ─────────────────────────────────────────────────────────
describe("packs", () => {
  const carrito = (items: Array<{ sku: string; cantidad: number }>) =>
    app.inject({ method: "POST", url: "/v1/carrito", headers: IP, payload: { items } });
  it("marcar una prenda como pack la muestra en Packs, con su composición, y prende el menú", async () => {
    expect((await app.inject("/v1/config")).json().hayPacks).toBe(false);
    expect((await req("PATCH", `/v1/admin/productos/${ids["qa-adm-1"]}`, operador, { pack: true, composicion: "100% algodón peinado" })).statusCode).toBe(200);
    // La migración 0015 pasó el ajuste de fábrica [10, 15, 18, 20] a la escala de 2 a 10.
    expect((await app.inject("/v1/config")).json()).toMatchObject({ hayPacks: true, packs: { minimo: 2, maximo: 10, porcentajes: [10, 15, 18, 20, 21, 22, 23, 24, 25] }, packsEn: ["mujer"] });
    const col = (await app.inject("/v1/productos?coleccion=packs")).json();
    expect(col.productos.map((p: { slug: string }) => p.slug)).toEqual(["qa-adm-1"]);
    expect(col.productos[0].pack).toBe(true);
    expect((await app.inject("/v1/productos/qa-adm-1")).json()).toMatchObject({ pack: true, composicion: "100% algodón peinado" });
    expect((await req("GET", "/v1/admin/productos?filtro=packs", operador)).json().productos.map((p: { id: number }) => p.id)).toEqual([ids["qa-adm-1"]]);
  });
  it("el % sale de cuántas unidades de la prenda hay en el carrito (cualquier talle y color)", async () => {
    const una = (await carrito([{ sku: "QA-ADM-1-1", cantidad: 1 }])).json();
    expect(una.lineas[0]).toMatchObject({ precio: 1_000_000, precioLista: null, pack: null });
    // 2 negras S + 1 roja M = pack de 3 → 15%.
    const tres = (await carrito([{ sku: "QA-ADM-1-1", cantidad: 2 }, { sku: "QA-ADM-1-3", cantidad: 1 }])).json();
    expect(tres.lineas.map((l: { precio: number; precioLista: number; pack: unknown }) => [l.precio, l.precioLista, l.pack])).toEqual([
      [850_000, 1_000_000, { unidades: 3, porcentaje: 15 }], [935_000, 1_100_000, { unidades: 3, porcentaje: 15 }],
    ]);
    expect(tres.subtotal).toBe(2 * 850_000 + 935_000);
    // 7 de la misma prenda → el % de 7. Una prenda que no es pack no suma.
    const muchas = (await carrito([{ sku: "QA-ADM-1-1", cantidad: 4 }, { sku: "QA-ADM-1-2", cantidad: 3 }, { sku: "QA-ADM-5-1", cantidad: 2 }])).json();
    expect(muchas.lineas.map((l: { pack: { porcentaje: number } | null }) => l.pack?.porcentaje ?? 0)).toEqual([22, 22, 0]);
  });
  it("no se suma a la rebaja de la prenda: gana el mayor", async () => {
    const d = await req("POST", "/v1/admin/descuentos", operador, { nombre: "QA adm rebaja remera", porcentaje: 25, alcance: "productos", productoIds: [ids["qa-adm-1"]] });
    const dos = (await carrito([{ sku: "QA-ADM-1-1", cantidad: 2 }])).json();
    expect(dos.lineas[0]).toMatchObject({ precio: 750_000, precioLista: 1_000_000, pack: null });
    await pool.query("DELETE FROM tienda.descuentos WHERE id = $1", [d.json().id]);
  });
  it("mínimo, máximo y % se cambian en Ajustes (nunca menos llevando más); con más del máximo, el del máximo", async () => {
    for (const malo of [
      { minimo: 2, maximo: 5, porcentajes: [10, 5, 20, 25] }, { minimo: 2, maximo: 5, porcentajes: [10, 15, 90, 95] },
      { minimo: 2, maximo: 5, porcentajes: [10, 15] }, { minimo: 1, maximo: 2, porcentajes: [5, 10] }, { minimo: 2, maximo: 30, porcentajes: Array(29).fill(5) },
      [10, 15, 18, 20],
    ]) expect((await req("PUT", "/v1/admin/ajustes", dueno, { packs: malo })).statusCode, JSON.stringify(malo)).toBe(400);
    for (const k of ["hayPacks", "packsEn", "hayLiquidacion", "liquidacionEn"]) expect((await req("PUT", "/v1/admin/ajustes", dueno, { [k]: false })).statusCode, k).toBe(400);
    expect((await req("PUT", "/v1/admin/ajustes", dueno, { packs: { minimo: 3, maximo: 4, porcentajes: [10, 20] } })).statusCode).toBe(200);
    // 2 ya no es pack; 4 es el máximo; 6, el % del máximo.
    const pct = async (n: number) => (await carrito([{ sku: "QA-ADM-1-1", cantidad: n }])).json().lineas[0].pack?.porcentaje ?? 0;
    expect([await pct(2), await pct(3), await pct(4), await pct(6)]).toEqual([0, 10, 20, 20]);
    expect((await app.inject("/v1/config")).json().packs).toEqual({ minimo: 3, maximo: 4, porcentajes: [10, 20] });
    await req("PUT", "/v1/admin/ajustes", dueno, { packs: { minimo: 2, maximo: 10, porcentajes: [10, 15, 18, 20, 21, 22, 23, 24, 25] } });
  });
  it("los packs se piden por categoría de arriba (/packs/mujer, /packs/ninos)", async () => {
    await req("PATCH", `/v1/admin/productos/${ids["qa-adm-4"]}`, operador, { pack: true });
    const de = async (c: string) => app.inject(`/v1/productos?coleccion=packs&categoria=${c}`);
    expect((await (await de("mujer")).json()).productos.map((p: { slug: string }) => p.slug)).toEqual(["qa-adm-1"]);
    expect((await (await de("ninos")).json()).productos.map((p: { slug: string }) => p.slug)).toEqual(["qa-adm-4"]);
    expect((await de("no-existe")).statusCode).toBe(404);
    expect((await app.inject("/v1/productos?coleccion=packs&categoria=Mujer'--")).statusCode).toBe(400);
    expect((await app.inject("/v1/config")).json().packsEn).toEqual(expect.arrayContaining(["mujer", "ninos"]));
    await req("PATCH", `/v1/admin/productos/${ids["qa-adm-4"]}`, operador, { pack: false });
  });
});

describe("liquidación (etapa 9)", () => {
  const lista = async (q: string) => (await app.inject(`/v1/productos?${q}`)).json().productos.map((p: { slug: string }) => p.slug);
  it("un descuento marcado como liquidación pone sus productos en Liquidación (por categoría), con la etiqueta", async () => {
    expect((await app.inject("/v1/config")).json()).toMatchObject({ hayLiquidacion: false, liquidacionEn: [] });
    const comun = await req("POST", "/v1/admin/descuentos", operador, { nombre: "QA adm rebaja común", porcentaje: 10, alcance: "productos", productoIds: [ids["qa-adm-2"]] });
    const d = await req("POST", "/v1/admin/descuentos", operador, { nombre: "QA adm liquidación", porcentaje: 30, alcance: "productos", productoIds: [ids["qa-adm-3"], ids["qa-adm-4"]], liquidacion: true });
    expect(d.statusCode, d.body).toBe(201);
    expect(await lista("coleccion=liquidacion")).toEqual(expect.arrayContaining(["qa-adm-3", "qa-adm-4"]));
    expect(await lista("coleccion=liquidacion")).not.toContain("qa-adm-2");
    expect(await lista("coleccion=liquidacion&categoria=ninos")).toEqual(["qa-adm-4"]);
    expect(await lista("coleccion=liquidacion&categoria=mujer")).toEqual(["qa-adm-3"]);
    const tarjeta = (await app.inject("/v1/productos?coleccion=liquidacion&categoria=mujer")).json().productos[0];
    expect(tarjeta).toMatchObject({ liquidacion: true, descuento: 30 });
    expect((await app.inject("/v1/productos/qa-adm-3")).json()).toMatchObject({ liquidacion: true, descuento: 30 });
    expect((await app.inject("/v1/productos/qa-adm-2")).json().liquidacion).toBe(false);
    expect((await app.inject("/v1/config")).json()).toMatchObject({ hayLiquidacion: true, liquidacionEn: expect.arrayContaining(["mujer", "ninos"]) });
    const admin = (await req("GET", "/v1/admin/descuentos", operador)).json().descuentos.find((x: { id: number }) => x.id === d.json().id);
    expect(admin).toMatchObject({ liquidacion: true });
    // Lo agotado no se liquida (no se muestra).
    await pool.query("UPDATE tienda.variantes SET stock = 0 WHERE producto_id = $1", [ids["qa-adm-4"]]);
    expect(await lista("coleccion=liquidacion&categoria=ninos")).toEqual([]);
    await pool.query("UPDATE tienda.variantes SET stock = 5 WHERE producto_id = $1", [ids["qa-adm-4"]]);
    // Vencida o pausada, sale de Liquidación.
    await req("PUT", `/v1/admin/descuentos/${d.json().id}`, operador, { nombre: "QA adm liquidación", porcentaje: 30, alcance: "productos", productoIds: [ids["qa-adm-3"], ids["qa-adm-4"]], liquidacion: true, desde: "2020-01-01T00:00:00Z", hasta: "2020-02-01T00:00:00Z" });
    expect(await lista("coleccion=liquidacion")).not.toContain("qa-adm-3");
    expect((await app.inject("/v1/config")).json().hayLiquidacion).toBe(false);
    await req("DELETE", `/v1/admin/descuentos/${d.json().id}`, operador);
    await req("DELETE", `/v1/admin/descuentos/${comun.json().id}`, operador);
  });
  it("por categorías (con sus subcategorías) también vale", async () => {
    const mujer = (await pool.query("SELECT id FROM tienda.categorias WHERE slug = 'mujer' AND padre_id IS NULL")).rows[0].id;
    const d = await req("POST", "/v1/admin/descuentos", operador, { nombre: "QA adm liquidación mujer", porcentaje: 40, alcance: "categorias", categoriaIds: [mujer], liquidacion: true });
    expect(await lista("coleccion=liquidacion&categoria=mujer")).toEqual(expect.arrayContaining(["qa-adm-1", "qa-adm-2", "qa-adm-3", "qa-adm-5"]));
    expect(await lista("coleccion=liquidacion&categoria=ninos")).toEqual([]);
    await req("DELETE", `/v1/admin/descuentos/${d.json().id}`, operador);
  });
});

describe("menú con fotos (etapa 9)", () => {
  it("1 o 2 prendas con foto y stock por categoría de arriba: primero las destacadas", async () => {
    // Fotos de muestra (sin archivo: el menú sólo necesita la clave).
    for (const [slug, clave] of [["qa-adm-5", "p/qa/menu-5"], ["qa-adm-2", "p/qa/menu-2"], ["qa-adm-4", "p/qa/menu-4"]] as const) {
      await pool.query("INSERT INTO tienda.fotos (producto_id, tipo, clave, ancho, alto, orden) VALUES ($1, 'exhibicion', $2, 800, 1000, 99) ON CONFLICT (clave) DO NOTHING", [ids[slug], clave]);
    }
    // Otras pruebas dejaron destacadas: se arranca de cero y al final se devuelven.
    const destacadas = (await pool.query<{ id: number }>("SELECT id FROM tienda.productos WHERE destacado AND slug LIKE 'qa-adm-%'")).rows.map((x) => x.id);
    await pool.query("UPDATE tienda.productos SET destacado = false WHERE id = ANY($1::int[])", [destacadas]);
    await req("PATCH", `/v1/admin/productos/${ids["qa-adm-5"]}`, operador, { destacado: true });
    const r = await app.inject("/v1/menu");
    expect(r.statusCode).toBe(200);
    const menu = Object.fromEntries(r.json().categorias.map((c: { categoria: string; productos: unknown[] }) => [c.categoria, c.productos]));
    expect(menu.mujer.length).toBeLessThanOrEqual(2);
    expect(menu.mujer[0]).toMatchObject({ slug: "qa-adm-5", foto: { ancho: 800, alto: 1000 } });
    expect(menu.ninos.map((p: { slug: string }) => p.slug)).toEqual(["qa-adm-4"]);
    // Sin stock no sale.
    await pool.query("UPDATE tienda.variantes SET stock = 0 WHERE producto_id = $1", [ids["qa-adm-4"]]);
    const sin = Object.fromEntries((await app.inject("/v1/menu")).json().categorias.map((c: { categoria: string; productos: unknown[] }) => [c.categoria, c.productos]));
    expect(sin.ninos ?? []).toEqual([]);
    await pool.query("UPDATE tienda.variantes SET stock = 5 WHERE producto_id = $1", [ids["qa-adm-4"]]);
    await req("PATCH", `/v1/admin/productos/${ids["qa-adm-5"]}`, operador, { destacado: false });
    await pool.query("UPDATE tienda.productos SET destacado = true WHERE id = ANY($1::int[])", [destacadas]);
    await pool.query("DELETE FROM tienda.fotos WHERE clave LIKE 'p/qa/menu-%'");
  });
});

describe("reseñas", () => {
  const firma = (n: string) => firmaOpinar(n, INTERNO);
  async function pedido(estado: string, items: Array<[string, number, string | null, string | null]>) {
    const r = await pool.query(
      `INSERT INTO tienda.pedidos (acceso_hash,email,nombre,apellido,telefono,dni,entrega,local_retiro,medio_pago,subtotal,total,estado)
       VALUES ($1,'qa-adm-resena@test.com','ana maría','García','1','2','retiro','Flores','local',1000000,1000000,$2) RETURNING id, numero`, ["d".repeat(64), estado]);
    for (const [slug, cantidad, color, talle] of items) {
      await pool.query("INSERT INTO tienda.pedido_items (pedido_id, sku, producto_id, nombre, color, talle, precio, cantidad) VALUES ($1,'X',$2,'Prenda',$3,$4,1000000,$5)",
        [r.rows[0].id, ids[slug], color, talle, cantidad]);
    }
    return r.rows[0] as { id: number; numero: string };
  }
  const opinar = (numero: string, t: string, payload?: unknown) =>
    app.inject({ method: payload ? "POST" : "GET", url: `/v1/opinar/${numero}?t=${t}`, headers: IP, ...(payload ? { payload: payload as object } : {}) });

  it("sólo con el enlace firmado y cuando el pedido ya llegó", async () => {
    const p = await pedido("pagado", [["qa-adm-1", 1, "negro", "M"], ["qa-adm-2", 1, "gris", "M"]]);
    expect((await opinar(p.numero, firma(p.numero))).json().error).toBe("sin_entregar");
    expect((await opinar(p.numero, "x".repeat(24))).statusCode).toBe(404);
    expect((await opinar(p.numero, firma("ISU-1"))).statusCode).toBe(404);
    expect((await opinar("ISU-99999999", firma("ISU-99999999"))).statusCode).toBe(404);
    expect((await opinar(p.numero, "corta")).statusCode).toBe(400);
    await pool.query("UPDATE tienda.pedidos SET estado = 'retirado' WHERE id = $1", [p.id]);
    // La base anota cuándo se cerró (para el mail de "¿Qué te pareció?").
    expect((await pool.query("SELECT cerrado_en IS NOT NULL AS c, resena_pedida_en FROM tienda.pedidos WHERE id = $1", [p.id])).rows[0]).toEqual({ c: true, resena_pedida_en: null });
    const g = (await opinar(p.numero, firma(p.numero))).json();
    expect(g).toMatchObject({ numero: p.numero, nombre: "ana", generalYaOpino: false });
    expect(g.productos.map((x: { slug: string; color: string; yaOpino: boolean }) => [x.slug, x.color, x.yaOpino])).toEqual([["qa-adm-1", "negro", false], ["qa-adm-2", "gris", false]]);
  });

  it("guarda una por prenda y una general, entra pendiente y no se repite", async () => {
    const p = await pedido("entregado", [["qa-adm-1", 2, "negro", "S"]]);
    const t = firma(p.numero);
    expect((await opinar(p.numero, t, { resenas: [{ productoId: ids["qa-adm-3"], estrellas: 5 }] })).json().error).toBe("prenda");
    expect((await opinar(p.numero, t, { resenas: [{ productoId: ids["qa-adm-1"], estrellas: 6 }] })).statusCode).toBe(400);
    expect((await opinar(p.numero, t, { resenas: [{ productoId: null, estrellas: 5, calce: "justo" }] })).statusCode).toBe(400);
    expect((await opinar(p.numero, t, { resenas: [{ productoId: ids["qa-adm-1"], estrellas: 5 }, { productoId: ids["qa-adm-1"], estrellas: 1 }] })).statusCode).toBe(400);
    const texto = "<script>alert(1)</script> Me encantó, el talle es justo y la tela suave.";
    const r = await opinar(p.numero, t, { resenas: [
      { productoId: ids["qa-adm-1"], estrellas: 5, texto, calce: "justo" },
      { productoId: null, estrellas: 4, texto: "   Llegó rapidísimo y bien empaquetado, gracias!   " },
    ] });
    expect(r.json()).toEqual({ guardadas: 2, yaEstaban: 0, publicadas: false });
    expect((await opinar(p.numero, t, { resenas: [{ productoId: ids["qa-adm-1"], estrellas: 1 }] })).json()).toMatchObject({ guardadas: 0, yaEstaban: 1 });
    const fila = (await pool.query("SELECT nombre, talle, color, estado, texto FROM tienda.resenas WHERE pedido_id = $1 AND producto_id IS NOT NULL", [p.id])).rows[0];
    // Nombre e inicial: nunca el apellido entero. El texto, tal cual (lo escapa la tienda al mostrarlo).
    expect(fila).toEqual({ nombre: "Ana G.", talle: "S", color: "negro", estado: "pendiente", texto });
    // Pendiente: todavía no se ve.
    expect((await app.inject("/v1/productos/qa-adm-1/resenas")).json().total).toBe(0);
    expect((await app.inject("/v1/productos/qa-adm-1")).json().resenas).toEqual({ promedio: null, cantidad: 0 });
  });

  it("el backoffice la publica, responde y la rechaza; el resumen sigue solo", async () => {
    const pend = (await req("GET", "/v1/admin/resenas?estado=pendiente&q=qa-adm", operador)).json();
    expect(pend.resenas.length).toBeGreaterThanOrEqual(0);
    const todas = (await req("GET", "/v1/admin/resenas?estado=pendiente", operador)).json().resenas.filter((r: { pedido: string; producto: string | null }) => r.producto !== undefined);
    const deRemera = todas.find((r: { productoId: number }) => r.productoId === ids["qa-adm-1"]);
    const general = todas.find((r: { productoId: number | null; texto: string }) => r.productoId === null && r.texto?.startsWith("Llegó"));
    expect(deRemera).toBeTruthy();
    expect((await req("PATCH", `/v1/admin/resenas/${deRemera.id}`, lectura2, { estado: "publicada" })).json().error).toBe("sin_permiso");
    enviados.length = 0;
    expect((await req("PATCH", `/v1/admin/resenas/${deRemera.id}`, operador, { estado: "publicada", respuesta: "¡Gracias, Ana!" })).statusCode).toBe(200);
    expect(enviados.some((e) => e.nombre === "invalidar" && (e.datos.slugs as string[]).includes("qa-adm-1"))).toBe(true);
    expect((await req("POST", "/v1/admin/resenas/masivo", operador, { ids: [general.id], estado: "publicada" })).json().cambiadas).toBe(1);

    const pub = (await app.inject("/v1/productos/qa-adm-1/resenas")).json();
    expect(pub.resumen).toMatchObject({ cantidad: 1, promedio: 5, estrellas: [0, 0, 0, 0, 1], calce: { chico: 0, justo: 1, grande: 0 } });
    expect(pub.resenas[0]).toMatchObject({ nombre: "Ana G.", estrellas: 5, talle: "S", color: "negro", calce: "justo", respuesta: "¡Gracias, Ana!" });
    expect((await app.inject("/v1/productos/qa-adm-1")).json().resenas).toEqual({ promedio: 5, cantidad: 1 });
    const tarjeta = (await app.inject("/v1/productos?coleccion=packs")).json().productos[0];
    expect(tarjeta.resenas).toEqual({ promedio: 5, cantidad: 1 });
    // El inicio: el promedio de todas (también la general) y las últimas.
    const ini = (await app.inject("/v1/resenas/inicio")).json();
    expect(ini.cantidad).toBeGreaterThanOrEqual(2);
    expect(ini.resenas.find((r: { id: number }) => r.id === deRemera.id).producto).toMatchObject({ slug: "qa-adm-1" });
    expect(ini.resenas.find((r: { id: number }) => r.id === general.id).producto).toBeNull();

    expect((await req("PATCH", `/v1/admin/resenas/${deRemera.id}`, operador, { estado: "rechazada" })).statusCode).toBe(200);
    expect((await app.inject("/v1/productos/qa-adm-1")).json().resenas).toEqual({ promedio: null, cantidad: 0 });
    expect((await req("PATCH", `/v1/admin/resenas/${deRemera.id}`, operador, {})).statusCode).toBe(400);
    expect((await req("PATCH", "/v1/admin/resenas/99999999", operador, { estado: "publicada" })).statusCode).toBe(404);
    const aud = await pool.query("SELECT accion FROM tienda.auditoria WHERE entidad = 'resena' AND entidad_id = $1 ORDER BY id", [String(deRemera.id)]);
    expect(aud.rows.map((x) => x.accion)).toEqual(["moderar_resena", "moderar_resena"]);
    expect((await req("GET", "/v1/admin/resumen", operador)).json().resenasPorModerar).toBeGreaterThanOrEqual(0);
  });

  it("con «publicar solas» se ven al momento", async () => {
    expect((await req("PUT", "/v1/admin/ajustes", dueno, { resenas: { publicarSolas: true, pedirDias: 0 } })).statusCode).toBe(400);
    expect((await req("PUT", "/v1/admin/ajustes", dueno, { resenas: { publicarSolas: true, pedirDias: 3 } })).statusCode).toBe(200);
    const p = await pedido("entregado", [["qa-adm-5", 1, "blanco", "M"]]);
    enviados.length = 0;
    const r = await opinar(p.numero, firma(p.numero), { resenas: [{ productoId: ids["qa-adm-5"], estrellas: 3, calce: "chico" }] });
    expect(r.json()).toMatchObject({ guardadas: 1, publicadas: true });
    expect(enviados.some((e) => e.nombre === "invalidar")).toBe(true);
    expect((await app.inject("/v1/productos/qa-adm-5")).json().resenas).toEqual({ promedio: 3, cantidad: 1 });
    await req("PUT", "/v1/admin/ajustes", dueno, { resenas: { publicarSolas: false, pedirDias: 4 } });
  });

  it("frena a quien prueba enlaces a ciegas, por la IP del cliente (no la de la tienda)", async () => {
    const deIp = (ip: string) => app.inject({
      method: "POST", url: `/v1/opinar/ISU-12345?t=${"z".repeat(24)}`, headers: { "x-isu-interno": INTERNO, "x-isu-ip": ip },
      payload: { resenas: [{ productoId: null, estrellas: 5 }] },
    });
    for (let i = 0; i < 10; i++) expect((await deIp("10.7.7.7")).statusCode).toBe(404);
    expect((await deIp("10.7.7.7")).statusCode).toBe(429);
    // Otro cliente que entra por el mismo servidor de la tienda sigue pudiendo opinar.
    expect((await deIp("10.7.7.8")).statusCode).toBe(404);
  });
});

describe("portada (banners del inicio)", () => {
  const foto = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: "#2c5f91" } }).jpeg().toBuffer();
  const subir = async (id: number, tipo: string, cuerpo: Buffer) =>
    app.inject({ method: "POST", url: `/v1/admin/banners/${id}/foto?tipo=${tipo}`, headers: { ...IP, "x-isu-admin": operador, "content-type": "image/jpeg" }, payload: cuerpo });

  it("sólo enlaces de esta tienda", async () => {
    for (const enlace of ["//evil.com", "https://evil.com/x", "javascript:alert(1)", "/\\evil.com", "/ espacio", "packs"]) {
      expect((await req("POST", "/v1/admin/banners", operador, { alt: "QA adm malo", enlace })).statusCode, enlace).toBe(400);
    }
    expect((await req("POST", "/v1/admin/banners", lectura2, { alt: "QA adm sin permiso" })).json().error).toBe("sin_permiso");
  });

  it("alta, foto para compu y celular, se ve en el inicio, se apaga y se borra con sus archivos", async () => {
    const b = (await req("POST", "/v1/admin/banners", operador, { alt: "QA adm packs de remeras", enlace: "/packs", orden: 1 })).json().banner;
    // Sin foto todavía: no sale en el inicio.
    expect((await app.inject("/v1/portada")).json().banners.some((x: { id: number }) => x.id === b.id)).toBe(false);
    expect((await subir(b.id, "escritorio", await foto(400, 200))).json().error).toBe("foto_invalida");
    expect((await subir(b.id, "escritorio", await foto(4000, 600))).json().error).toBe("foto_invalida");
    const e = await subir(b.id, "escritorio", await foto(1800, 700));
    expect(e.statusCode, e.body).toBe(200);
    expect(e.json().clave).toMatch(/^b\/\d+\/[a-f0-9]{16}$/);
    expect(e.json().clave.startsWith(`b/${b.id}/`)).toBe(true);
    const m = await subir(b.id, "movil", await foto(900, 1200));
    expect(m.statusCode).toBe(200);
    const archivos = await readdir(path.join(dirFotos, "b", String(b.id)));
    expect(archivos.length).toBe(6);
    const portada = (await app.inject("/v1/portada")).json().banners.find((x: { id: number }) => x.id === b.id);
    expect(portada).toMatchObject({ alt: "QA adm packs de remeras", enlace: "/packs", foto: { clave: e.json().clave, ancho: 1800, alto: 700 }, fotoMovil: { clave: m.json().clave } });
    // En disco (desarrollo), la API la sirve como las fotos de los productos.
    expect((await app.inject(`/fotos/${e.json().clave}-800.webp`)).statusCode).toBe(200);
    // Cambiar el orden no la apaga (sin valores por defecto al editar).
    await req("PATCH", `/v1/admin/banners/${b.id}`, operador, { orden: 3 });
    expect((await req("GET", "/v1/admin/banners", operador)).json().banners.find((x: { id: number }) => x.id === b.id)).toMatchObject({ orden: 3, activo: true });
    expect((await req("PATCH", `/v1/admin/banners/${b.id}`, operador, { desde: "2030-01-02T00:00:00Z", hasta: "2030-01-01T00:00:00Z" })).statusCode).toBe(400);
    await req("PATCH", `/v1/admin/banners/${b.id}`, operador, { activo: false });
    expect((await app.inject("/v1/portada")).json().banners.some((x: { id: number }) => x.id === b.id)).toBe(false);
    expect((await req("DELETE", `/v1/admin/banners/${b.id}`, operador)).statusCode).toBe(200);
    expect(await readdir(path.join(dirFotos, "b", String(b.id)))).toEqual([]);
  });
});

describe("transferencias recibidas (lo que no se pudo asignar solo)", () => {
  async function pedido(total: number, estado = "esperando_transferencia") {
    const r = await pool.query(
      `INSERT INTO tienda.pedidos (acceso_hash,email,nombre,apellido,telefono,dni,entrega,local_retiro,medio_pago,subtotal,total,estado,transferencia_via,transferencia_monto)
       VALUES ($1,'qa-adm-transf@test.com','Ana','García','1','2','retiro','Flores','transferencia',$2,$2,$3,'mercadopago',$2 + 37) RETURNING id, numero`,
      ["e".repeat(64), total, estado]);
    return r.rows[0] as { id: number; numero: string };
  }
  async function recibida(externo: string, monto: number, estado = "sin_pedido") {
    const r = await pool.query(
      `INSERT INTO tienda.transferencias_recibidas (via, externo, monto, pagador, recibida_en, estado) VALUES ('mercadopago', $1, $2, 'Carla Pérez', now(), $3) RETURNING id`,
      [externo, monto, estado]);
    return r.rows[0].id as number;
  }

  it("la lista: lo que falta resolver primero, y qué está prendido", async () => {
    const id = await recibida("qa-adm-lista", 1_234_500);
    const r = (await req("GET", "/v1/admin/transferencias", lectura2)).json();
    expect(r.transferencias.find((t: { id: number }) => t.id === id)).toMatchObject({ via: "mercadopago", monto: 1_234_500, pagador: "Carla Pérez", estado: "sin_pedido", pedido: null });
    expect(r.porResolver).toBeGreaterThanOrEqual(1);
    expect(r.estado).toEqual({ talo: { prendido: false, configurado: false }, mercadoPago: { prendido: expect.any(Boolean), configurado: expect.any(Boolean) } });
    expect((await req("GET", "/v1/admin/resumen", operador)).json().transferenciasPorResolver).toBeGreaterThanOrEqual(1);
    expect((await req("GET", "/v1/admin/transferencias")).statusCode).toBe(401);
    expect((await req("GET", "/v1/admin/transferencias?estado=pendiente", operador)).statusCode).toBe(400);
  });

  it("asignar a mano: sólo operador, confirma el pedido, queda auditado y no se repite", async () => {
    const p = await pedido(1_000_000);
    const id = await recibida("qa-adm-asignar", 1_000_000);
    expect((await req("POST", `/v1/admin/transferencias/${id}/asignar`, lectura2, { pedido: p.numero })).json().error).toBe("sin_permiso");
    expect((await req("POST", `/v1/admin/transferencias/${id}/asignar`, operador, { pedido: "1234" })).statusCode).toBe(400);
    enviados.length = 0;
    const r = await req("POST", `/v1/admin/transferencias/${id}/asignar`, operador, { pedido: p.numero.toLowerCase() });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ estado: "pagado" });
    expect(enviados.some((e) => e.nombre === "pagado")).toBe(true);
    const t = (await pool.query("SELECT estado, pedido_id, resuelta_por FROM tienda.transferencias_recibidas WHERE id = $1", [id])).rows[0];
    expect(t).toMatchObject({ estado: "aplicada", pedido_id: p.id, resuelta_por: expect.stringMatching(/^qa-adm/) });
    const aud = await pool.query("SELECT accion FROM tienda.auditoria WHERE entidad = 'transferencia' AND entidad_id = $1", [String(id)]);
    expect(aud.rows.map((x) => x.accion)).toEqual(["asignar_transferencia"]);
    expect((await req("POST", `/v1/admin/transferencias/${id}/asignar`, operador, { pedido: p.numero })).json().error).toBe("ya_resuelta");
  });

  it("no se asigna a un pedido ya cobrado, ni una que no alcanza (queda sin resolver)", async () => {
    const pagado = await pedido(1_000_000, "pagado");
    const id = await recibida("qa-adm-cobrado", 1_000_000);
    expect((await req("POST", `/v1/admin/transferencias/${id}/asignar`, operador, { pedido: pagado.numero })).json().error).toBe("ya_pagado");
    const p = await pedido(2_000_000);
    const r = await req("POST", `/v1/admin/transferencias/${id}/asignar`, operador, { pedido: p.numero });
    expect(r.json()).toMatchObject({ error: "no_alcanza" });
    expect((await pool.query("SELECT estado FROM tienda.pedidos WHERE id = $1", [p.id])).rows[0].estado).toBe("esperando_transferencia");
    expect((await pool.query("SELECT estado FROM tienda.transferencias_recibidas WHERE id = $1", [id])).rows[0].estado).toBe("sin_pedido");
    expect((await req("POST", `/v1/admin/transferencias/${id}/asignar`, operador, { pedido: "ISU-99999999" })).statusCode).toBe(404);
  });

  it("descartar (algo que no es una compra): con nota, una sola vez", async () => {
    const id = await recibida("qa-adm-descartar", 50_000);
    expect((await req("POST", `/v1/admin/transferencias/${id}/descartar`, lectura2, {})).json().error).toBe("sin_permiso");
    expect((await req("POST", `/v1/admin/transferencias/${id}/descartar`, operador, { nota: "Me devolvió un préstamo" })).statusCode).toBe(200);
    expect((await pool.query("SELECT estado, nota FROM tienda.transferencias_recibidas WHERE id = $1", [id])).rows[0]).toEqual({ estado: "descartada", nota: "Me devolvió un préstamo" });
    expect((await req("POST", `/v1/admin/transferencias/${id}/descartar`, operador, {})).statusCode).toBe(404);
    expect((await req("POST", "/v1/admin/transferencias/99999999/descartar", operador, {})).statusCode).toBe(404);
  });

  it("el ajuste se prende desde Ajustes (sólo el dueño) y con el formato justo", async () => {
    expect((await req("PUT", "/v1/admin/ajustes", operador, { transferenciasAuto: { talo: false, mercadoPago: true } })).json().error).toBe("sin_permiso");
    expect((await req("PUT", "/v1/admin/ajustes", dueno, { transferenciasAuto: { talo: "si", mercadoPago: true } })).statusCode).toBe(400);
    expect((await req("PUT", "/v1/admin/ajustes", dueno, { transferenciasAuto: { talo: false, mercadoPago: true, extra: 1 } })).statusCode).toBe(400);
    expect((await req("PUT", "/v1/admin/ajustes", dueno, { transferenciasAuto: { talo: false, mercadoPago: true } })).statusCode).toBe(200);
    expect((await req("GET", "/v1/admin/transferencias", operador)).json().estado.mercadoPago.prendido).toBe(true);
    await req("PUT", "/v1/admin/ajustes", dueno, { transferenciasAuto: { talo: false, mercadoPago: false } });
  });
});
