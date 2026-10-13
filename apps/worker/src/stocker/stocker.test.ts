import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import pg from "pg";
import { crearPool, migrar } from "@isu/db";
import { aplicarCatalogo, aplicarStock, categoriasPara, registrar } from "./sincronizar.js";
import { crearClienteStocker, type CatalogoStocker } from "./cliente.js";
import { escucharStocker, CANAL } from "./escucha.js";
import { crearProcesadores, type Dependencias } from "../procesadores.js";

const URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:5433/stocker_test";
const pool = crearPool({ url: URL, max: 4 });
const BASE = 7_100_000; // ids de Stocker de mentira, lejos de cualquier dato real

const ahora = (ms = 0) => new Date(Date.now() + ms).toISOString();
function catalogo(productos: CatalogoStocker["productos"], generado = ahora()): CatalogoStocker {
  return { negocio: 1, generado, truncado: false, sinLocalesOnline: false, productos };
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

  it("con la lista cortada (truncado) no da de baja lo que no vino", async () => {
    await aplicarCatalogo(pool, catalogo([remera()]));
    const r = await aplicarCatalogo(pool, { ...catalogo([]), truncado: true });
    expect(r.bajas).toBe(0);
    expect((await prod(BASE + 1)).en_stocker).toBe(true);
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

describe("trabajo stocker/stock (aviso stock_cambio)", () => {
  it("traduce la variante a su SKU, no toca el stock de lo que Stocker no conoce y pide el catálogo por lo nuevo", async () => {
    await aplicarCatalogo(pool, catalogo([remera()], ahora(-10_000)));
    await pool.query("UPDATE tienda.variantes SET stock = 4 WHERE sku = 'QA-W-REM-NEG-L'");
    const pedidos: string[][] = [];
    const encolados: string[] = [];
    const deps = {
      pool,
      redis: {} as Dependencias["redis"],
      invalidar: async () => {},
      cola: { add: async (n: string) => { encolados.push(n); return {} as never; } },
      stocker: {
        stock: async (skus: string[]) => {
          pedidos.push([...skus].sort());
          return { generado: ahora(), stock: { "QA-W-REM-NEG-M": 1 }, desconocidos: ["QA-W-REM-NEG-L"] };
        },
      },
    } as unknown as Dependencias;
    const stock = crearProcesadores(deps).stocker!.stock!;
    const log = console.warn;
    console.warn = () => {};
    try {
      // 11 y 12 son de la tienda; 999 es una variante que la tienda todavía no tiene.
      const r = await stock({ data: { variantes: [BASE + 11, BASE + 12, BASE + 999] } } as never) as Record<string, number>;
      expect(pedidos).toEqual([["QA-W-REM-NEG-L", "QA-W-REM-NEG-M"]]);
      expect(r).toMatchObject({ variantesNuevas: 1, desconocidosEnStocker: 1 });
    } finally { console.warn = log; }
    expect(encolados).toContain("catalogo");
    const v = Object.fromEntries((await vars(BASE + 1)).map((x) => [x.sku, x.stock]));
    // El que Stocker no conoce queda como estaba: no pasa a «sin stock».
    expect(v).toMatchObject({ "QA-W-REM-NEG-M": 1, "QA-W-REM-NEG-L": 4, "QA-W-REM-BLA-M": 2 });
  });
});

describe("cliente de Stocker", () => {
  let server: http.Server;
  let url = "";
  let respuesta: { status: number; cuerpo: unknown; location?: string } = { status: 200, cuerpo: {} };
  const vistos: Array<{ url?: string; auth?: string }> = [];
  const cuerpos: Array<{ metodo?: string; url?: string; cuerpo: Record<string, unknown> | null }> = [];
  beforeAll(async () => {
    server = http.createServer(async (req, res) => {
      vistos.push({ url: req.url, auth: req.headers.authorization });
      let b = ""; for await (const c of req) b += c;
      cuerpos.push({ metodo: req.method, url: req.url, cuerpo: b ? JSON.parse(b) : null });
      res.writeHead(respuesta.status, { "content-type": "application/json", ...(respuesta.location ? { location: respuesta.location } : {}) });
      res.end(JSON.stringify(respuesta.cuerpo));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  const cli = () => crearClienteStocker({ url, token: "t".repeat(43) });

  it("manda la credencial y convierte pesos a centavos", async () => {
    respuesta = { status: 200, cuerpo: { negocio: 1, generadoEn: ahora(), truncado: false, sinLocalesOnline: false, productos: [{
      id: 1, skuAgrupador: "A", titulo: "A", descripcion: null, categoria: null, genero: null, modelo: null, precioMinorista: "12000.50", precioMayorista: 6000,
      variantes: [{ id: 2, sku: "A-1", color: " ", talle: "M", precioMinorista: null, precioMayorista: null, publicable: 1, activo: true }],
    }] } };
    const c = await cli().catalogo();
    expect(vistos.at(-1)).toEqual({ url: "/api/integraciones/tienda/catalogo", auth: `Bearer ${"t".repeat(43)}` });
    expect(c.productos[0]!.precio).toBe(1200050);
    expect(c.productos[0]!.sku).toBe("A");
    expect(c.productos[0]!.variantes[0]!.color).toBeNull();
    expect(c.productos[0]!.variantes[0]!.cantidad).toBe(1);
  });
  it("lee la respuesta real de Stocker (contrato v1): publicable, activo y precio minorista", async () => {
    // Recorte de GET /api/integraciones/tienda/catalogo de Stocker (04/10/2026).
    respuesta = { status: 200, cuerpo: {
      negocio: 2, truncado: false, sinLocalesOnline: false, generadoEn: "2026-10-04T06:48:40.252Z",
      productos: [{
        id: 16, skuAgrupador: "ISUABEPAN", titulo: "Abel Pantalón Hombre", precioMinorista: 32000, precioMayorista: 16000,
        descripcion: null, categoria: "Pantalones", modelo: "ABEL", genero: null,
        variantes: [
          { id: 101, sku: "ISUABEPANNEGL", color: "Negro", talle: "L", precioMinorista: 32000, precioMayorista: 16000, publicable: 1002, activo: true },
          { id: 102, sku: "ISUABEPANMOLL", color: "Moline", talle: "L", precioMinorista: 32000, precioMayorista: 16000, publicable: 0, activo: true },
          { id: 103, sku: "ISUABEPANTOPL", color: "Topo", talle: "L", precioMinorista: 32000, precioMayorista: 16000, publicable: -2, activo: true },
          { id: 104, sku: "ISUABEPANCACL", color: "CAC", talle: "L", precioMinorista: 32000, precioMayorista: 16000, publicable: 5, activo: false },
        ],
      }],
    } };
    const c = await cli().catalogo();
    expect(c.negocio).toBe(2);
    expect(c.generado).toBe("2026-10-04T06:48:40.252Z");
    expect(c.truncado).toBe(false);
    const p = c.productos[0]!;
    expect({ sku: p.sku, precio: p.precio, modelo: p.modelo, genero: p.genero }).toEqual({ sku: "ISUABEPAN", precio: 3_200_000, modelo: "ABEL", genero: null });
    // La dada de baja no viene; el publicable negativo (más reservado que stock) es 0.
    expect(p.variantes.map((v) => [v.sku, v.cantidad, v.precio])).toEqual([["ISUABEPANNEGL", 1002, 3_200_000], ["ISUABEPANMOLL", 0, 3_200_000], ["ISUABEPANTOPL", 0, 3_200_000]]);
  });
  it("sólo entran productos padre: ni de evento, ni packs, ni combos", async () => {
    const v = (id: number, extra = {}) => ({ id, sku: `S${id}`, color: "Negro", talle: "M", precioMinorista: 1000, publicable: 3, activo: true, ...extra });
    const p = (id: number, extra = {}, variantes = [v(id * 10)]) => ({ id, skuAgrupador: `P${id}`, titulo: `P${id}`, descripcion: null, categoria: null, genero: null, modelo: null, precioMinorista: 1000, variantes, ...extra });
    respuesta = { status: 200, cuerpo: { negocio: 1, generadoEn: ahora(), productos: [
      p(1),
      p(2, { esFeria: true }),
      p(3, { esEvento: true }),
      p(4, { esCombo: true }),
      p(5, { definicionCombo: "{\"eje\":\"Talle\"}" }),
      p(6, { tipo: "pack" }),
      p(7, { tipo: "padre", esFeria: null, definicionCombo: null }),
      // Un padre con una variante de pack y otra de combo: quedan las comunes.
      p(8, {}, [v(81), v(82, { esPack: true }), v(83, { esCombo: true })]),
    ] } };
    const c = await cli().catalogo();
    expect(c.productos.map((x) => x.sku)).toEqual(["P1", "P7", "P8"]);
    expect(c.productos[2]!.variantes.map((x) => x.sku)).toEqual(["S81"]);
  });
  it("un catálogo cortado (truncado) se avisa", async () => {
    respuesta = { status: 200, cuerpo: { negocio: 1, generadoEn: ahora(), truncado: true, sinLocalesOnline: false, productos: [] } };
    expect((await cli().catalogo()).truncado).toBe(true);
  });
  it("un formato inesperado es un error claro, no basura en la base", async () => {
    respuesta = { status: 200, cuerpo: { negocio: 1, generadoEn: ahora(), sinLocalesOnline: false, productos: [{ id: "x" }] } };
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
    respuesta = { status: 200, cuerpo: { generadoEn: ahora(), stock: { "A-1": 3 }, desconocidos: ["B,2"] } };
    const s = await cli().stock(["A-1", "B,2"]);
    expect(s.stock).toEqual({ "A-1": 3 });
    // El desconocido no vuelve como 0: queda aparte.
    expect(s.desconocidos).toEqual(["B,2"]);
    expect(vistos.at(-1)?.url).toBe("/api/integraciones/tienda/stock?skus=A-1%2CB%2C2");
    await expect(cli().stock(Array.from({ length: 201 }, (_, i) => `S${i}`))).rejects.toThrow(RangeError);
  });

  // ── Pedidos: contrato v1 de Stocker v3.39 (tanda 2) ──
  const nuevo = {
    numero: "ISU-1003", ocurrioEn: "2026-10-09T12:00:00.000Z", items: [{ sku: "A-1", cantidad: 2, precioUnitario: 18000 }],
    comprador: { nombre: "Ana Prueba", email: "a@b.c", documento: "30111222" }, total: 36000, pagoPendiente: true,
    pagoDetalle: "Transferencia · vence 11/10 12:00", pagoVenceEn: "2026-10-11T15:00:00.000Z", envio: { tipo: "andreani" },
  };
  it("pedido: va en el sobre con el número en pedidoExterno (lo que faltaba: Stocker contestaba 400)", async () => {
    respuesta = { status: 201, cuerpo: { pedidoExterno: "ISU-1003", estado: "aceptado", motivo: null, repetido: false } };
    const r = await cli().crearPedido(nuevo);
    expect(r).toMatchObject({ status: 201, estado: "aceptado", repetido: false, faltantes: [] });
    const enviado = cuerpos.at(-1)!;
    expect([enviado.metodo, enviado.url]).toEqual(["POST", "/api/integraciones/tienda/pedidos"]);
    expect(enviado.cuerpo).toEqual({
      contrato: 1, tipo: "venta", id: "isu:ISU-1003", ocurrioEn: "2026-10-09T12:00:00.000Z",
      datos: {
        pedidoExterno: "ISU-1003", items: nuevo.items, comprador: nuevo.comprador, total: 36000, pagoPendiente: true,
        pagoDetalle: nuevo.pagoDetalle, pagoVenceEn: "2026-10-11T15:00:00.000Z", envio: { tipo: "andreani" },
      },
    });
  });
  it("pedido: 409 sin stock es una respuesta (no un error) y dice qué faltó", async () => {
    respuesta = { status: 409, cuerpo: { pedidoExterno: "ISU-1003", estado: "rechazado", motivo: "Sin stock para despachar. A-1: pide 2 y faltan 1; B-2: pide 1 y faltan 1.", repetido: false } };
    const r = await cli().crearPedido(nuevo);
    expect([r.status, r.estado]).toEqual([409, "rechazado"]);
    expect(r.faltantes).toEqual([{ sku: "A-1", pide: 2, hay: 1 }, { sku: "B-2", pide: 1, hay: 0 }]);
    respuesta = { status: 409, cuerpo: { pedidoExterno: "ISU-1003", estado: "rechazado", motivo: "Sin stock para despachar. A-1: se apartó para otro pedido mientras se procesaba éste.", repetido: true } };
    expect((await cli().crearPedido(nuevo)).faltantes).toEqual([{ sku: "A-1", pide: null, hay: null }]);
  });
  it("pedido: 202 (guardado sin resolver) vuelve con su estado; un 400 es un error con el mensaje de Stocker", async () => {
    respuesta = { status: 202, cuerpo: { pedidoExterno: "ISU-1003", estado: "pendiente", motivo: null, repetido: true } };
    expect(await cli().crearPedido(nuevo)).toMatchObject({ status: 202, estado: "pendiente" });
    respuesta = { status: 400, cuerpo: { message: "El pedido necesita el id que le dio la plataforma." } };
    await expect(cli().crearPedido(nuevo)).rejects.toThrow(/400: El pedido necesita el id/);
  });
  it("cancelar: sobre de cancelación; contesta qué hizo; 404 = Stocker no lo tiene", async () => {
    respuesta = { status: 200, cuerpo: { accion: "cancelado", pedidoId: 9, liberadas: 2, yaSalio: false } };
    expect(await cli().cancelarPedido("ISU-1003", "No se pagó a tiempo")).toEqual({ accion: "cancelado", liberadas: 2, yaSalio: false });
    expect(cuerpos.at(-1)).toMatchObject({ url: "/api/integraciones/tienda/pedidos/ISU-1003/cancelar", cuerpo: { contrato: 1, tipo: "cancelacion", id: "isu:ISU-1003", datos: { motivo: "No se pagó a tiempo" } } });
    respuesta = { status: 404, cuerpo: { message: "Ese pedido no está en la cola." } };
    expect(await cli().cancelarPedido("ISU-1003", "x")).toBeNull();
  });
  it("cobro: el id es del cobro y el pedido va en ventaId; aplicado false no es un error", async () => {
    respuesta = { status: 201, cuerpo: { movimientoExterno: "ISU-1003-C7", pedidoExterno: "ISU-1003", aplicado: true, motivo: null, pagoEstado: "pagado", cobrado: "36000.00", repetido: false } };
    const r = await cli().registrarCobro({ numero: "ISU-1003", cobro: "7", importe: 36000, medio: "mercadopago", operacion: "123456789", ocurrioEn: "2026-10-09T13:00:00.000Z" });
    expect(r).toMatchObject({ aplicado: true, pagoEstado: "pagado", cobrado: 36000 });
    expect(cuerpos.at(-1)).toEqual({ metodo: "POST", url: "/api/integraciones/tienda/cobros", cuerpo: {
      contrato: 1, tipo: "cobro", id: "isu:ISU-1003-C7", ocurrioEn: "2026-10-09T13:00:00.000Z",
      datos: { ventaId: "isu:ISU-1003", importe: 36000, medio: "mercadopago", operacion: "123456789" },
    } });
    respuesta = { status: 201, cuerpo: { movimientoExterno: "ISU-1003-C8", pedidoExterno: "ISU-1003", aplicado: false, motivo: "Cobró sobre un pedido cancelado: hay que devolver el dinero.", pagoEstado: "pendiente", cobrado: 0, repetido: false } };
    expect(await cli().registrarCobro({ numero: "ISU-1003", cobro: "8", importe: 100, medio: "transferencia", ocurrioEn: new Date() })).toMatchObject({ aplicado: false, motivo: /devolver el dinero/ });
  });
  it("envío: sólo lo que viene; lee la respuesta nueva", async () => {
    respuesta = { status: 200, cuerpo: { pedidoExterno: "ISU-1003", seguimiento: "CA123456789AR", envioTipo: "correo_argentino", despacharAntesDe: null } };
    expect(await cli().cargarEnvio("ISU-1003", { tipo: "correo_argentino", seguimiento: "CA123456789AR" })).toEqual({ pedidoExterno: "ISU-1003", seguimiento: "CA123456789AR", envioTipo: "correo_argentino", despacharAntesDe: null });
    expect(cuerpos.at(-1)?.cuerpo).toEqual({ tipo: "correo_argentino", seguimiento: "CA123456789AR" });
  });
  it("novedades: sin cursor no manda desde; con cursor lo manda tal cual", async () => {
    respuesta = { status: 200, cuerpo: { cursor: "2026-10-09T12:00:00.000Z|0", cambios: [] } };
    expect(await cli().resoluciones(null)).toEqual({ cursor: "2026-10-09T12:00:00.000Z|0", cambios: [], hayMas: false });
    expect(vistos.at(-1)?.url).toBe("/api/integraciones/tienda/pedidos/resoluciones?limite=100");
    respuesta = { status: 200, cuerpo: { cursor: "2026-10-09T12:05:00.000Z|41", hayMas: true, cambios: [{
      pedidoExterno: "ISU-1003", cambio: "despachado", estado: "aceptado", estadoEnvio: "despachado", pagoEstado: "pagado", seguimiento: "CA1", envioTipo: "correo_argentino",
      despachadoEn: "2026-10-09T12:04:00.000Z", canceladoEn: null, motivo: null, en: "2026-10-09T12:04:00.000Z",
    }] } };
    const r = await cli().resoluciones("2026-10-09T12:00:00.000Z|0", 200);
    expect([r.hayMas, r.cambios[0]!.cambio, r.cambios[0]!.despachadoEn]).toEqual([true, "despachado", "2026-10-09T12:04:00.000Z"]);
    expect(vistos.at(-1)?.url).toBe("/api/integraciones/tienda/pedidos/resoluciones?limite=200&desde=2026-10-09T12%3A00%3A00.000Z%7C0");
  });
});

describe("escucha de avisos", () => {
  const notificar = (cuerpo: string) => pool.query("SELECT pg_notify($1, $2)", [CANAL, cuerpo]);
  const esperarQue = async (cond: () => boolean, ms = 5000) => {
    const hasta = Date.now() + ms;
    while (!cond() && Date.now() < hasta) await new Promise((r) => setTimeout(r, 25));
  };

  it("junta los avisos seguidos, filtra por negocio e ignora basura", async () => {
    const tandas: number[][] = [];
    const e = escucharStocker({ url: URL, negocio: async () => 1, alCambiar: (s) => { tandas.push(s.sort((a, b) => a - b)); }, alReconectar: () => {}, esperaMs: 150, log: { warn() {}, error() {} } });
    await esperarQue(() => e.conectado());
    await new Promise((r) => setTimeout(r, 100));
    await notificar("1:11");
    await notificar("1:12");
    await notificar("1:11");
    await notificar("2:99");
    await notificar("{no es el formato");
    await notificar("1:-3");
    await notificar("1:abc");
    await esperarQue(() => tandas.length > 0);
    await e.parar();
    expect(tandas).toEqual([[11, 12]]);
  });

  it("si se corta la conexión, reconecta y pide el catálogo", async () => {
    let reconexiones = 0;
    const tandas: number[][] = [];
    const e = escucharStocker({ url: URL, negocio: async () => null, alCambiar: (s) => { tandas.push(s); }, alReconectar: () => { reconexiones++; }, esperaMs: 50, log: { warn() {}, error() {} } });
    await esperarQue(() => e.conectado());
    // Se le corta la conexión desde el servidor (como un reinicio de Postgres o un corte de red).
    await pool.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'isu-tienda-escucha'");
    await esperarQue(() => reconexiones > 0, 8000);
    expect(reconexiones).toBe(1);
    await new Promise((r) => setTimeout(r, 100));
    await notificar("9:77");
    await esperarQue(() => tandas.length > 0);
    await e.parar();
    expect(tandas).toEqual([[77]]);
  });
});

void pg;
