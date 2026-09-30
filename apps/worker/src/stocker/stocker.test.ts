import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import pg from "pg";
import { crearPool, migrar } from "@isu/db";
import { aplicarCatalogo, aplicarStock, categoriasPara, registrar } from "./sincronizar.js";
import { crearClienteStocker, type CatalogoStocker } from "./cliente.js";
import { escucharStocker, CANAL } from "./escucha.js";

const URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:5433/stocker_test";
const pool = crearPool({ url: URL, max: 4 });
const BASE = 7_100_000; // ids de Stocker de mentira, lejos de cualquier dato real

const ahora = (ms = 0) => new Date(Date.now() + ms).toISOString();
function catalogo(productos: CatalogoStocker["productos"], generado = ahora()): CatalogoStocker {
  return { negocio: 1, generado, sinLocalesOnline: false, productos };
}
const remera = (extra: Partial<CatalogoStocker["productos"][number]> = {}) => ({
  id: BASE + 1, sku: "QA-W-REM", titulo: "Remera Oversize Algodón", descripcion: "Algodón peinado", categoria: "Remeras", genero: "Mujer",
  modelo: null, precio: 1200000,
  variantes: [
    { id: BASE + 11, sku: "QA-W-REM-NEG-M", color: "Negro", talle: "M", precio: 1200000, cantidad: 5 },
    { id: BASE + 12, sku: "QA-W-REM-NEG-L", color: "Negro", talle: "L", precio: 1200000, cantidad: 0 },
    { id: BASE + 13, sku: "QA-W-REM-BLA-M", color: "Blanco", talle: "M", precio: 1350000, cantidad: 2 },
  ],
  ...extra,
});

const limpiar = async () => {
  await pool.query("DELETE FROM tienda.productos WHERE stocker_id >= $1 AND stocker_id < $2", [BASE, BASE + 1000]);
};

beforeAll(async () => { await migrar(pool); });
beforeEach(limpiar);
afterAll(async () => { await limpiar(); await pool.end(); });

const prod = async (stockerId: number) =>
  (await pool.query("SELECT * FROM tienda.productos WHERE stocker_id = $1", [stockerId])).rows[0];
const vars = async (stockerId: number) =>
  (await pool.query(
    `SELECT v.sku, v.talle, v.precio, v.stock, v.activo, c.clave AS color FROM tienda.variantes v
       JOIN tienda.productos p ON p.id = v.producto_id LEFT JOIN tienda.producto_colores c ON c.id = v.color_id
      WHERE p.stocker_id = $1 ORDER BY v.orden`, [stockerId])).rows;

describe("catálogo", () => {
  it("crea producto, colores, variantes y categorías", async () => {
    const r = await aplicarCatalogo(pool, catalogo([remera()]));
    expect(r).toMatchObject({ productos: 1, variantes: 3, nuevos: 1 });
    const p = await prod(BASE + 1);
    expect(p).toMatchObject({ nombre: "Remera Oversize Algodón", slug: "remera-oversize-algodon", visible: true, en_stocker: true });
    expect(await vars(BASE + 1)).toEqual([
      { sku: "QA-W-REM-NEG-M", talle: "M", precio: 1200000, stock: 5, activo: true, color: "negro" },
      { sku: "QA-W-REM-NEG-L", talle: "L", precio: 1200000, stock: 0, activo: true, color: "negro" },
      { sku: "QA-W-REM-BLA-M", talle: "M", precio: 1350000, stock: 2, activo: true, color: "blanco" },
    ]);
    const colores = (await pool.query("SELECT clave, hex FROM tienda.producto_colores WHERE producto_id = $1 ORDER BY orden", [p.id])).rows;
    expect(colores).toEqual([{ clave: "negro", hex: "#111111" }, { clave: "blanco", hex: "#ffffff" }]);
    const cats = (await pool.query(
      `SELECT pa.slug || '/' || c.slug AS ruta FROM tienda.producto_categorias pc JOIN tienda.categorias c ON c.id = pc.categoria_id
         JOIN tienda.categorias pa ON pa.id = c.padre_id WHERE pc.producto_id = $1`, [p.id])).rows;
    expect(cats).toEqual([{ ruta: "mujer/remeras-y-tops" }]);
  });

  it("la segunda pasada igual no escribe nada", async () => {
    await aplicarCatalogo(pool, catalogo([remera()]));
    const r = await aplicarCatalogo(pool, catalogo([remera()]));
    expect(r.cambios).toBe(0);
    expect(r.afectados).toEqual([]);
  });

  it("un cambio de precio se aplica y marca el producto como afectado", async () => {
    await aplicarCatalogo(pool, catalogo([remera()]));
    const p2 = remera();
    p2.variantes[0]!.precio = 1500000;
    const r = await aplicarCatalogo(pool, catalogo([p2]));
    expect(r.afectados).toEqual(["remera-oversize-algodon"]);
    expect((await vars(BASE + 1))[0].precio).toBe(1500000);
  });

  it("no pisa lo que es de la tienda: slug, nombre fijado, categorías corregidas, hex corregido", async () => {
    await aplicarCatalogo(pool, catalogo([remera()]));
    const p = await prod(BASE + 1);
    await pool.query("UPDATE tienda.productos SET nombre = 'Nombre propio', nombre_fijo = true, categorias_fijas = true WHERE id = $1", [p.id]);
    await pool.query("DELETE FROM tienda.producto_categorias WHERE producto_id = $1", [p.id]);
    await pool.query("UPDATE tienda.producto_colores SET hex = '#000001' WHERE producto_id = $1 AND clave = 'negro'", [p.id]);
    await aplicarCatalogo(pool, catalogo([remera({ titulo: "Otro título en Stocker", genero: "Hombre" })]));
    const q = await prod(BASE + 1);
    expect([q.nombre, q.slug]).toEqual(["Nombre propio", "remera-oversize-algodon"]);
    expect((await pool.query("SELECT count(*)::int n FROM tienda.producto_categorias WHERE producto_id = $1", [p.id])).rows[0].n).toBe(0);
    expect((await pool.query("SELECT hex FROM tienda.producto_colores WHERE producto_id = $1 AND clave = 'negro'", [p.id])).rows[0].hex).toBe("#000001");
  });

  it("un stock más viejo no pisa uno más nuevo", async () => {
    await aplicarCatalogo(pool, catalogo([remera()], ahora(-60_000)));
    // Llega el aviso de una venta con hora actual…
    await aplicarStock(pool, { generado: ahora(), stock: { "QA-W-REM-NEG-M": 4 } });
    // …y después termina de viajar un catálogo que se sacó antes de la venta.
    await aplicarCatalogo(pool, catalogo([remera()], ahora(-30_000)));
    expect((await vars(BASE + 1))[0].stock).toBe(4);
  });

  it("lo que se va de Stocker queda escondido (no borrado)", async () => {
    await aplicarCatalogo(pool, catalogo([remera()]));
    const r = await aplicarCatalogo(pool, catalogo([]));
    expect(r.bajas).toBeGreaterThanOrEqual(1);
    const p = await prod(BASE + 1);
    expect(p.en_stocker).toBe(false);
    expect((await vars(BASE + 1)).every((v) => !v.activo)).toBe(true);
    // Vuelve: se reactiva con el mismo slug.
    await aplicarCatalogo(pool, catalogo([remera()]));
    expect(await prod(BASE + 1)).toMatchObject({ en_stocker: true, slug: "remera-oversize-algodon" });
  });

  it("una variante que desaparece se desactiva; un color que desaparece también", async () => {
    await aplicarCatalogo(pool, catalogo([remera()]));
    const p2 = remera();
    p2.variantes = p2.variantes.filter((v) => v.color === "Negro");
    await aplicarCatalogo(pool, catalogo([p2]));
    expect((await vars(BASE + 1)).map((v) => [v.sku, v.activo])).toEqual([
      ["QA-W-REM-NEG-M", true], ["QA-W-REM-NEG-L", true], ["QA-W-REM-BLA-M", false],
    ]);
    const p = await prod(BASE + 1);
    const c = (await pool.query("SELECT clave, activo FROM tienda.producto_colores WHERE producto_id = $1 ORDER BY orden", [p.id])).rows;
    expect(c).toEqual([{ clave: "negro", activo: true }, { clave: "blanco", activo: false }]);
  });

  it("sin color en Stocker → color «Único» (para poder cargarle fotos)", async () => {
    await aplicarCatalogo(pool, catalogo([{
      id: BASE + 2, sku: "QA-W-GOR", titulo: "Gorra Hombre", descripcion: null, categoria: null, genero: null, modelo: null, precio: 500000,
      variantes: [{ id: BASE + 21, sku: "QA-W-GOR-U", color: null, talle: null, precio: null, cantidad: 3 }],
    }]));
    expect(await vars(BASE + 2)).toEqual([{ sku: "QA-W-GOR-U", talle: null, precio: 500000, stock: 3, activo: true, color: "unico" }]);
  });

  it("sin precio en ningún lado no entra", async () => {
    await aplicarCatalogo(pool, catalogo([{
      id: BASE + 3, sku: "QA-W-SINP", titulo: "Sin precio", descripcion: null, categoria: null, genero: null, modelo: null, precio: null,
      variantes: [{ id: BASE + 31, sku: "QA-W-SINP-1", color: null, talle: null, precio: null, cantidad: 3 }],
    }]));
    expect(await prod(BASE + 3)).toBeUndefined();
  });

  it("títulos repetidos → slugs distintos y estables", async () => {
    const a = { ...remera(), id: BASE + 4, variantes: [{ id: BASE + 41, sku: "QA-W-A", color: "Rojo", talle: "S", precio: 100, cantidad: 1 }] };
    const b = { ...remera(), id: BASE + 5, variantes: [{ id: BASE + 51, sku: "QA-W-B", color: "Rojo", talle: "S", precio: 100, cantidad: 1 }] };
    await aplicarCatalogo(pool, catalogo([a, b]));
    const sa = (await prod(BASE + 4)).slug, sb = (await prod(BASE + 5)).slug;
    expect(sa).not.toBe(sb);
    await aplicarCatalogo(pool, catalogo([b, a]));
    expect([(await prod(BASE + 4)).slug, (await prod(BASE + 5)).slug]).toEqual([sa, sb]);
  });

  it("un SKU que en Stocker pasó a otra variante no rompe la sincronización", async () => {
    await aplicarCatalogo(pool, catalogo([remera()]));
    const p2 = remera();
    p2.variantes[0] = { ...p2.variantes[0]!, id: BASE + 19 }; // mismo SKU, variante nueva
    await aplicarCatalogo(pool, catalogo([p2]));
    const { rows } = await pool.query("SELECT stocker_id FROM tienda.variantes WHERE sku = 'QA-W-REM-NEG-M'");
    expect(rows).toEqual([{ stocker_id: BASE + 19 }]);
  });

  it("con publicarNuevos = false lo nuevo entra oculto", async () => {
    await pool.query("UPDATE tienda.ajustes SET valor = 'false' WHERE clave = 'publicarNuevos'");
    try {
      await aplicarCatalogo(pool, catalogo([remera()]));
      expect((await prod(BASE + 1)).visible).toBe(false);
    } finally {
      await pool.query("UPDATE tienda.ajustes SET valor = 'true' WHERE clave = 'publicarNuevos'");
    }
  });

  it("categorías: unisex en dos, sin subcategoría queda arriba", async () => {
    const arbol = { raiz: new Map([["hombre", 1], ["mujer", 2]]), hija: new Map([["hombre/buzos-y-camperas", 11]]) };
    expect(categoriasPara({ categoria: "Buzos", genero: "Unisex", titulo: "Buzo" }, arbol)).toEqual([11, 2]);
  });
});

describe("stock por aviso", () => {
  it("aplica sólo lo que cambió y dice qué SKU no conoce", async () => {
    await aplicarCatalogo(pool, catalogo([remera()], ahora(-10_000)));
    const r = await aplicarStock(pool, { generado: ahora(), stock: { "QA-W-REM-NEG-M": 5, "QA-W-REM-NEG-L": 3, "QA-W-NUEVO": 1 } });
    expect(r.afectados).toEqual(["remera-oversize-algodon"]);
    expect(r.desconocidos).toEqual(["QA-W-NUEVO"]);
    expect((await vars(BASE + 1)).map((v) => v.stock)).toEqual([5, 3, 2]);
  });
  it("un aviso viejo no pisa", async () => {
    await aplicarCatalogo(pool, catalogo([remera()]));
    const r = await aplicarStock(pool, { generado: ahora(-60_000), stock: { "QA-W-REM-NEG-M": 99 } });
    expect(r.cambios).toBe(0);
    expect((await vars(BASE + 1))[0].stock).toBe(5);
  });
  it("deja el renglón de la pasada, también si falla", async () => {
    await expect(registrar(pool, "stock", async () => { throw new Error("Stocker caído"); })).rejects.toThrow();
    const { rows } = await pool.query("SELECT error, fin IS NOT NULL AS termino FROM tienda.sincronizaciones ORDER BY id DESC LIMIT 1");
    expect(rows[0]).toEqual({ error: "Stocker caído", termino: true });
  });
});

describe("cliente de Stocker", () => {
  let server: http.Server;
  let url = "";
  let respuesta: { status: number; cuerpo: unknown; location?: string } = { status: 200, cuerpo: {} };
  const vistos: Array<{ url?: string; auth?: string }> = [];
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      vistos.push({ url: req.url, auth: req.headers.authorization });
      res.writeHead(respuesta.status, { "content-type": "application/json", ...(respuesta.location ? { location: respuesta.location } : {}) });
      res.end(JSON.stringify(respuesta.cuerpo));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  const cli = () => crearClienteStocker({ url, token: "t".repeat(43) });

  it("manda la credencial y convierte pesos a centavos", async () => {
    respuesta = { status: 200, cuerpo: { negocio: 1, generado: ahora(), sinLocalesOnline: false, productos: [{
      id: 1, sku: "A", titulo: "A", descripcion: null, categoria: null, genero: null, modelo: null, precio: "12000.50",
      variantes: [{ id: 2, sku: "A-1", color: " ", talle: "M", precio: null, cantidad: 1 }],
    }] } };
    const c = await cli().catalogo();
    expect(vistos.at(-1)).toEqual({ url: "/api/integraciones/tienda/catalogo", auth: `Bearer ${"t".repeat(43)}` });
    expect(c.productos[0]!.precio).toBe(1200050);
    expect(c.productos[0]!.variantes[0]!.color).toBeNull();
  });
  it("un formato inesperado es un error claro, no basura en la base", async () => {
    respuesta = { status: 200, cuerpo: { negocio: 1, generado: ahora(), sinLocalesOnline: false, productos: [{ id: "x" }] } };
    await expect(cli().catalogo()).rejects.toThrow(/formato inesperado/);
  });
  it("401 dice que la credencial está mal", async () => {
    respuesta = { status: 401, cuerpo: { message: "Credencial inválida." } };
    await expect(cli().catalogo()).rejects.toThrow(/STOCKER_TOKEN/);
  });
  it("no sigue redirecciones con la credencial", async () => {
    respuesta = { status: 302, cuerpo: {}, location: "http://evil.example/robar" };
    await expect(cli().catalogo()).rejects.toThrow(/no responde/);
  });
  it("stock: pide los SKU y valida la respuesta", async () => {
    respuesta = { status: 200, cuerpo: { generado: ahora(), stock: { "A-1": 3 } } };
    const s = await cli().stock(["A-1", "B,2"]);
    expect(s.stock).toEqual({ "A-1": 3 });
    expect(vistos.at(-1)?.url).toBe("/api/integraciones/tienda/stock?skus=A-1%2CB%2C2");
    await expect(cli().stock(Array.from({ length: 201 }, (_, i) => `S${i}`))).rejects.toThrow(RangeError);
  });
});

describe("escucha de avisos", () => {
  const notificar = (cuerpo: string) => pool.query("SELECT pg_notify($1, $2)", [CANAL, cuerpo]);
  const esperarQue = async (cond: () => boolean, ms = 5000) => {
    const hasta = Date.now() + ms;
    while (!cond() && Date.now() < hasta) await new Promise((r) => setTimeout(r, 25));
  };

  it("junta los avisos seguidos, filtra por negocio e ignora basura", async () => {
    const tandas: string[][] = [];
    const e = escucharStocker({ url: URL, negocio: async () => 1, alCambiar: (s) => { tandas.push(s.sort()); }, alReconectar: () => {}, esperaMs: 150, log: { warn() {}, error() {} } });
    await esperarQue(() => e.conectado());
    await new Promise((r) => setTimeout(r, 100));
    await notificar(JSON.stringify({ b: 1, s: ["A", "B"] }));
    await notificar(JSON.stringify({ b: 1, s: ["B", "C"] }));
    await notificar(JSON.stringify({ b: 2, s: ["DE-OTRO"] }));
    await notificar("{no es json");
    await notificar(JSON.stringify({ b: 1, s: "no es lista" }));
    await esperarQue(() => tandas.length > 0);
    await e.parar();
    expect(tandas).toEqual([["A", "B", "C"]]);
  });

  it("si se corta la conexión, reconecta y pide el catálogo", async () => {
    let reconexiones = 0;
    const tandas: string[][] = [];
    const e = escucharStocker({ url: URL, negocio: async () => null, alCambiar: (s) => { tandas.push(s); }, alReconectar: () => { reconexiones++; }, esperaMs: 50, log: { warn() {}, error() {} } });
    await esperarQue(() => e.conectado());
    // Se le corta la conexión desde el servidor (como un reinicio de Postgres o un corte de red).
    await pool.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'isu-tienda-escucha'");
    await esperarQue(() => reconexiones > 0, 8000);
    expect(reconexiones).toBe(1);
    await new Promise((r) => setTimeout(r, 100));
    await notificar(JSON.stringify({ b: 9, s: ["X"] }));
    await esperarQue(() => tandas.length > 0);
    await e.parar();
    expect(tandas).toEqual([["X"]]);
  });
});

void pg;
