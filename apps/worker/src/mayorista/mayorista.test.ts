import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { crearPool, migrar } from "@isu/db";
import { almacenEnDisco, PATRON_FOTOS } from "../fotos/almacen.js";
import { aplicarCatalogo } from "../stocker/sincronizar.js";
import type { CatalogoStocker } from "../stocker/cliente.js";
import { aplicar, CatalogoMayorista, conCache, descargadorDe, informe, planificar, type Descargar } from "./importar.js";

const URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:5433/stocker_test";
const pool = crearPool({ url: URL, max: 4 });
const BASE = 7_450_000;

/* Stocker: tres productos. Los SKU de variante son los de las combinaciones del mayorista. */
const variante = (id: number, sku: string, color: string | null, talle: string) => ({ id, sku, color, talle, precio: 1_000_000, cantidad: 3 });
const stocker: CatalogoStocker = {
  negocio: 1, generado: new Date().toISOString(), truncado: false, sinLocalesOnline: false,
  productos: [
    { id: BASE + 1, sku: "ISUCLOREM", titulo: "Cloe Musculosa Dama", descripcion: null, categoria: "Remeras", genero: "Mujer", modelo: null, precio: 1_000_000,
      variantes: [variante(BASE + 11, "ISUCLOREMNEGS", "Negro", "S"), variante(BASE + 12, "ISUCLOREMNEGUNI", "Negro", "Único"), variante(BASE + 13, "ISUCLOREMBLAUNI", "Blanco", "Único")] },
    { id: BASE + 2, sku: "ISUABYCAM-STK", titulo: "Abyys Campera Hombre", descripcion: null, categoria: "Camperas", genero: "Hombre", modelo: null, precio: 1_000_000,
      // En Stocker tiene otro SKU padre: se engancha por las variantes. Color "Único".
      variantes: [variante(BASE + 21, "ISUABYCAMNEGS", "Único", "S"), variante(BASE + 22, "ISUABYCAMNEGM", "Único", "M")] },
    { id: BASE + 3, sku: "QA-NENA-SHO", titulo: "Short nena", descripcion: null, categoria: "Shorts", genero: null, modelo: null, precio: 1_000_000,
      variantes: [variante(BASE + 31, "QA-NENA-SHO-ROJ-4", "Rojo", "4")] },
  ],
};

const f = (id: string, color?: string) => ({ ruta: `/fotos/${id}.jpg`, color: color ?? null });
const mayorista = CatalogoMayorista.parse({
  categorias: [{ id: 31, nombre: "Shorts" }],
  productos: [
    { sku: "isuclorem", titulo: "Cloe Musculosa Dama", genero: "Mujer", foto: "/fotos/cloe00000002.jpg",
      fotos: [f("cloe00000001", "Negro"), f("cloe00000002", "Blanco"), f("cloe00000003"), f("cloe00000004", "Negro"), f("cloe00000005", "Fucsia")],
      colores: [{ nombre: "Negro", hex: "#0A0A0A" }, { nombre: "Blanco", hex: "#ffffff" }, { nombre: "Fucsia", hex: "#ff00ff" }],
      combinaciones: [{ sku: "ISUCLOREMNEGS", color: "Negro", talle: "S" }, { sku: "ISUCLOREMNEGUNI", color: "Negro", talle: "Único" }, { sku: "ISUCLOREMBLAUNI", color: "Blanco", talle: "Único" }] },
    { sku: "ISUABYCAM", titulo: "Abyys Campera Hombre", foto: "/fotos/abyy00000001.jpg",
      fotos: Array.from({ length: 7 }, (_, i) => f(`abyy0000000${i + 1}`)),
      colores: [{ nombre: "Único", hex: "#D8D8D8" }],
      combinaciones: [{ sku: "ISUABYCAMNEGS", color: "Único", talle: "S" }, { sku: "ISUABYCAMNEGM", color: "Único", talle: "M" }] },
    { sku: "QA-NENA-SHO", titulo: "Mara Short Nena", categoriaId: 31, genero: "Nena", foto: null, fotos: [], colores: [{ nombre: "Rojo", hex: "#cc0000" }],
      combinaciones: [{ sku: "QA-NENA-SHO-ROJ-4", color: "Rojo", talle: "4" }] },
    { sku: "NO-ESTA", titulo: "Algo que Stocker no tiene", fotos: [], colores: [], combinaciones: [] },
  ],
});

const jpg = sharp({ create: { width: 600, height: 800, channels: 3, background: "#335577" } }).jpeg().toBuffer();
const pedidas: string[] = [];
const descargar: Descargar = async (ruta) => { pedidas.push(ruta); return jpg; };

const limpiar = () => pool.query("DELETE FROM tienda.productos WHERE stocker_id >= $1 AND stocker_id < $2", [BASE, BASE + 100]);
const id = async (stockerId: number) => (await pool.query("SELECT id FROM tienda.productos WHERE stocker_id = $1", [stockerId])).rows[0].id as number;
const fotos = async (stockerId: number) => (await pool.query(
  `SELECT f.tipo, c.nombre AS color, f.orden, f.origen FROM tienda.fotos f LEFT JOIN tienda.producto_colores c ON c.id = f.color_id
    WHERE f.producto_id = $1 ORDER BY f.tipo DESC, c.nombre NULLS FIRST, f.orden`, [await id(stockerId)])).rows;

let dir: string;
beforeAll(async () => { await migrar(pool); dir = await mkdtemp(path.join(os.tmpdir(), "mayorista-")); });
beforeEach(async () => { await limpiar(); await aplicarCatalogo(pool, stocker); pedidas.length = 0; });
afterAll(async () => { await limpiar(); await pool.end(); });

describe("importar del mayorista", () => {
  it("engancha por SKU padre (sin importar mayúsculas) o por las variantes; lo que Stocker no tiene, lo informa", async () => {
    const plan = await planificar(pool, mayorista);
    expect(plan.productos.map((p) => [p.sku, p.productoId])).toEqual([
      ["isuclorem", await id(BASE + 1)], ["ISUABYCAM", await id(BASE + 2)], ["QA-NENA-SHO", await id(BASE + 3)],
    ]);
    expect(plan.sinProducto).toEqual([{ sku: "NO-ESTA", titulo: "Algo que Stocker no tiene" }]);
    expect(informe(plan)).toContain("3 productos enganchados");
  });

  it("categorías: las confirmadas por SKU; un SKU nuevo se deduce («Nena» es de niños)", async () => {
    const plan = await planificar(pool, mayorista);
    expect(plan.productos.map((p) => p.categorias)).toEqual([["mujer/remeras-y-tops"], ["hombre/buzos-y-camperas"], ["ninos/shorts"]]);
    await aplicar(pool, almacenEnDisco(dir, PATRON_FOTOS), plan, descargar);
    const { rows } = await pool.query(
      `SELECT p.categorias_fijas, array_agg(pa.slug || '/' || c.slug) AS rutas FROM tienda.productos p
         JOIN tienda.producto_categorias pc ON pc.producto_id = p.id JOIN tienda.categorias c ON c.id = pc.categoria_id
         JOIN tienda.categorias pa ON pa.id = c.padre_id WHERE p.id = $1 GROUP BY 1`, [await id(BASE + 3)]);
    expect(rows).toEqual([{ categorias_fijas: true, rutas: ["ninos/shorts"] }]);
  });

  it("fotos: la principal primero (con su color), las de color a su color, las sin color generales; la de un color que no se vende no entra", async () => {
    const plan = await planificar(pool, mayorista);
    const r = await aplicar(pool, almacenEnDisco(dir, PATRON_FOTOS), plan, descargar);
    expect(await fotos(BASE + 1)).toEqual([
      { tipo: "exhibicion", color: null, orden: 3, origen: "mayorista:cloe00000003" },
      { tipo: "exhibicion", color: "Blanco", orden: 1, origen: "mayorista:cloe00000002" },
      { tipo: "color", color: "Negro", orden: 2, origen: "mayorista:cloe00000001" },
      { tipo: "color", color: "Negro", orden: 4, origen: "mayorista:cloe00000004" },
    ]);
    expect(pedidas[0]).toBe("/fotos/cloe00000002.jpg");
    expect(plan.productos[0]!.avisos).toContain("el color «Fucsia» no está en Stocker");
    // Abyys: un solo color → 5 fotos como mucho (la principal incluida).
    expect((await fotos(BASE + 2)).length).toBe(5);
    expect(r.fotosSubidas).toBe(9);
  });

  it("Abyys: «Único» pasa a llamarse Negro y la sincronización con Stocker no lo pisa; el hex es el del mayorista", async () => {
    await aplicar(pool, almacenEnDisco(dir, PATRON_FOTOS), await planificar(pool, mayorista), descargar);
    await aplicarCatalogo(pool, { ...stocker, generado: new Date(Date.now() + 1000).toISOString() });
    const c = async (sid: number) => (await pool.query("SELECT nombre, hex, nombre_fijo FROM tienda.producto_colores WHERE producto_id = $1 ORDER BY orden", [await id(sid)])).rows;
    expect(await c(BASE + 2)).toEqual([{ nombre: "Negro", hex: "#111111", nombre_fijo: true }]);
    expect(await c(BASE + 1)).toEqual([{ nombre: "Negro", hex: "#0a0a0a", nombre_fijo: false }, { nombre: "Blanco", hex: "#ffffff", nombre_fijo: false }]);
  });

  it("Cloe: sólo talle Único a la venta; el resto sigue oculto después de sincronizar", async () => {
    await aplicar(pool, almacenEnDisco(dir, PATRON_FOTOS), await planificar(pool, mayorista), descargar);
    await aplicarCatalogo(pool, { ...stocker, generado: new Date(Date.now() + 1000).toISOString() });
    const { rows } = await pool.query("SELECT sku, oculta, activo FROM tienda.variantes WHERE producto_id = $1 ORDER BY orden", [await id(BASE + 1)]);
    expect(rows).toEqual([
      { sku: "ISUCLOREMNEGS", oculta: true, activo: false },
      { sku: "ISUCLOREMNEGUNI", oculta: false, activo: true },
      { sku: "ISUCLOREMBLAUNI", oculta: false, activo: true },
    ]);
  });

  it("sin fotos queda oculto; volver a correrlo no duplica nada", async () => {
    const almacen = almacenEnDisco(dir, PATRON_FOTOS);
    const r1 = await aplicar(pool, almacen, await planificar(pool, mayorista), descargar);
    expect(r1.ocultados).toEqual(["QA-NENA-SHO"]);
    const antes = (await fotos(BASE + 1)).length;
    pedidas.length = 0;
    const plan2 = await planificar(pool, mayorista);
    expect(plan2.productos.map((p) => [p.fotos.length, p.yaEstaban])).toEqual([[0, 4], [0, 5], [0, 0]]);
    const r2 = await aplicar(pool, almacen, plan2, descargar);
    expect([r2.fotosSubidas, pedidas.length, (await fotos(BASE + 1)).length]).toEqual([0, 0, antes]);
  });

  it("si una corrida queda a medias (el mayorista no contestó), la siguiente completa y la principal vuelve a ser la primera", async () => {
    const almacen = almacenEnDisco(dir, PATRON_FOTOS);
    const falla: Descargar = async (ruta) => { if (ruta === "/fotos/cloe00000002.jpg") throw new Error("503"); return jpg; };
    const r1 = await aplicar(pool, almacen, await planificar(pool, mayorista), falla);
    expect(r1.fotosOmitidas.map((o) => o.foto)).toEqual(["/fotos/cloe00000002.jpg"]);
    await aplicar(pool, almacen, await planificar(pool, mayorista), descargar);
    const primera = await pool.query(
      "SELECT origen FROM tienda.fotos WHERE producto_id = $1 ORDER BY (tipo = 'exhibicion') DESC, orden, id LIMIT 1", [await id(BASE + 1)]);
    expect(primera.rows[0].origen).toBe("mayorista:cloe00000002");
  });

  it("un producto con fotos cargadas a mano no se toca (salvo --reemplazar)", async () => {
    const pid = await id(BASE + 1);
    await pool.query("INSERT INTO tienda.fotos (producto_id, tipo, clave) VALUES ($1, 'exhibicion', $2)", [pid, `p/${pid}/amanoamano01`]);
    const plan = await planificar(pool, mayorista);
    expect(plan.productos[0]).toMatchObject({ conFotosPropias: true, fotos: [] });
    const plan2 = await planificar(pool, mayorista, { reemplazar: true });
    await aplicar(pool, almacenEnDisco(dir, PATRON_FOTOS), plan2, descargar, { reemplazar: true });
    expect((await fotos(BASE + 1)).map((x) => x.origen)).not.toContain(null);
  });

  it("el descargador sólo pide /fotos/… del mismo sitio", async () => {
    const d = descargadorDe("https://mayorista.test/cualquier/cosa");
    for (const mala of ["//evil.test/x.jpg", "/fotos/../api/x.jpg", "/fotos/x.svg", "https://evil.test/fotos/aaaaaaaa.jpg"]) {
      await expect(d(mala)).rejects.toThrow("ruta de foto inválida");
    }
  });

  it("valida la forma del catálogo del mayorista", () => {
    expect(() => CatalogoMayorista.parse({ productos: [{ sku: "x", titulo: "y" }] })).toThrow();
    expect(() => CatalogoMayorista.parse({ productos: "no" })).toThrow();
  });
});

describe("descargar del mayorista", () => {
  it("si contesta 503 reintenta con espera; un 404 no se reintenta", async () => {
    const http = await import("node:http");
    let pedidos = 0;
    const srv = http.createServer((req, res) => {
      pedidos++;
      if (req.url === "/fotos/noexiste01.jpg") { res.writeHead(404); return res.end(); }
      if (pedidos <= 2) { res.writeHead(503); return res.end(); }
      res.writeHead(200, { "content-type": "image/jpeg" });
      res.end(Buffer.from("jpg"));
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    try {
      const d = descargadorDe(base, { pausaMs: 1, esperas: [5, 5, 5] });
      expect((await d("/fotos/abcdef01.jpg")).toString()).toBe("jpg");
      expect(pedidos).toBe(3);
      pedidos = 10;
      await expect(d("/fotos/noexiste01.jpg")).rejects.toThrow("contestó 404");
      expect(pedidos).toBe(11);
      // Se da por vencido después de los reintentos.
      const sinFin = descargadorDe(base, { pausaMs: 1, esperas: [1, 1] });
      pedidos = -100;
      await expect(sinFin("/fotos/abcdef01.jpg")).rejects.toThrow("contestó 503");
      expect(pedidos).toBe(-97);
    } finally {
      srv.close();
    }
  });

  it("con caché, la segunda vez no se pide", async () => {
    let n = 0;
    const d = conCache(async () => { n++; return Buffer.from("x"); }, await mkdtemp(path.join(os.tmpdir(), "cache-")));
    await d("/fotos/abcdef01.jpg");
    await d("/fotos/abcdef01.jpg");
    expect(n).toBe(1);
    await expect(d("/fotos/../../etc/passwd.jpg")).rejects.toThrow("ruta de foto inválida");
  });
});
