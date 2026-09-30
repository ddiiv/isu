import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { crearPool, migrar } from "@isu/db";
import { construirApp, CANAL_INVALIDAR } from "../src/app.js";
import { leerEntorno } from "../src/entorno.js";
import { consultaDeBusqueda } from "../src/modulos/productos/consultas.js";

/*
 * Catálogo público contra Postgres real. Los datos se cargan como los deja el
 * worker después de sincronizar con Stocker.
 */
const DB = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:5433/stocker_test";
const REDIS = process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6380/5";
const BASE = 7_200_000;
const pool = crearPool({ url: DB, max: 5 });
const redis = new Redis(REDIS, { maxRetriesPerRequest: 1 });
let app: Awaited<ReturnType<typeof construirApp>>;
let dirFotos = "";

async function cargarProducto(o: {
  n: number; nombre: string; cat: string; visible?: boolean; enStocker?: boolean; padre?: string; creado?: string;
  variantes: Array<{ color: string; talle: string; precio: number; stock: number; activo?: boolean }>;
  fotos?: Array<{ tipo: "color" | "exhibicion"; color?: string }>;
}) {
  const slug = o.nombre.toLowerCase().replaceAll(" ", "-");
  const p = await pool.query(
    `INSERT INTO tienda.productos (stocker_id, stocker_padre, nombre, slug, visible, en_stocker, categoria_id, stocker_descripcion, creado_en)
     VALUES ($1,$2,$3,$4,$5,$6,(SELECT h.id FROM tienda.categorias h JOIN tienda.categorias p ON p.id = h.padre_id WHERE p.slug || '/' || h.slug = $7),
             'Descripción de Stocker', COALESCE($8::timestamptz, now())) RETURNING id, categoria_id`,
    [BASE + o.n, o.padre ?? `QA-API-${o.n}`, o.nombre, slug, o.visible ?? true, o.enStocker ?? true, o.cat, o.creado ?? null],
  );
  const id = p.rows[0].id;
  await pool.query("INSERT INTO tienda.producto_categorias VALUES ($1, $2)", [id, p.rows[0].categoria_id]);
  const colores = new Map<string, number>();
  for (const v of o.variantes) {
    if (!colores.has(v.color)) {
      const c = await pool.query("INSERT INTO tienda.producto_colores (producto_id, clave, nombre, hex, orden) VALUES ($1,$2,$3,'#111111',$4) RETURNING id",
        [id, v.color, v.color[0]!.toUpperCase() + v.color.slice(1), colores.size]);
      colores.set(v.color, c.rows[0].id);
    }
  }
  let i = 0;
  for (const v of o.variantes) {
    i++;
    await pool.query(
      "INSERT INTO tienda.variantes (producto_id, color_id, stocker_id, sku, talle, precio, stock, orden, activo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [id, colores.get(v.color), BASE * 10 + o.n * 100 + i, `QA-API-${o.n}-${i}`, v.talle, v.precio, v.stock, i, v.activo ?? true],
    );
  }
  let f = 0;
  for (const foto of o.fotos ?? []) {
    f++;
    await pool.query("INSERT INTO tienda.fotos (producto_id, tipo, color_id, clave, orden, ancho, alto) VALUES ($1,$2,$3,$4,$5,1200,1500)",
      [id, foto.tipo, foto.color ? colores.get(foto.color) : null, `p/${id}/qaapi${o.n}x${f}aaaa`, f]);
  }
  return { id, slug };
}

const limpiar = () => pool.query("DELETE FROM tienda.productos WHERE stocker_id >= $1 AND stocker_id < $2", [BASE, BASE + 1000]);

beforeAll(async () => {
  await migrar(pool);
  await limpiar();
  await redis.flushdb();
  dirFotos = await mkdtemp(path.join(os.tmpdir(), "fotos-"));
  app = await construirApp({
    env: leerEntorno({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: DB, REDIS_URL: REDIS, CACHE_SEGUNDOS: "60", FOTOS_DIR: dirFotos }),
    pool, redis,
  });
  await app.ready();

  await cargarProducto({
    n: 1, nombre: "Remera qa oversize", cat: "mujer/remeras-y-tops", creado: "2020-01-01",
    variantes: [
      { color: "negro", talle: "M", precio: 1200000, stock: 50 },
      { color: "negro", talle: "S", precio: 1200000, stock: 2 },
      { color: "blanco", talle: "XL", precio: 1350000, stock: 0 },
      { color: "rojo", talle: "L", precio: 999, stock: 9, activo: false },
    ],
    fotos: [{ tipo: "color", color: "negro" }, { tipo: "exhibicion", color: "negro" }, { tipo: "color", color: "blanco" }],
  });
  await cargarProducto({ n: 2, nombre: "Calza qa agotada", cat: "mujer/pantalones-y-calzas", variantes: [{ color: "negro", talle: "M", precio: 800000, stock: 0 }] });
  await cargarProducto({ n: 3, nombre: "Buzo qa oculto", cat: "mujer/buzos-y-camperas", visible: false, variantes: [{ color: "gris", talle: "M", precio: 1, stock: 5 }] });
  await cargarProducto({ n: 4, nombre: "Buzo qa de baja", cat: "mujer/buzos-y-camperas", enStocker: false, variantes: [{ color: "gris", talle: "M", precio: 1, stock: 5 }] });
  await cargarProducto({ n: 5, nombre: "Jogger qa hombre", cat: "hombre/pantalones", padre: "ISU-9876", variantes: [{ color: "gris", talle: "L", precio: 1500000, stock: 4 }] });
});
afterAll(async () => {
  await limpiar();
  await app.close();
  await redis.quit();
  await pool.end();
});

const get = (url: string) => app.inject(url);
type Tarjeta = { nombre: string; agotado: boolean };
const qa = (ps: Tarjeta[]) => ps.filter((p) => / qa /.test(p.nombre));

describe("grilla por categoría", () => {
  it("la categoría de arriba incluye sus subcategorías; ocultos y de baja no salen", async () => {
    const r = await get("/v1/productos?categoria=mujer");
    expect(r.statusCode).toBe(200);
    expect(qa(r.json().productos).map((p: { nombre: string }) => p.nombre)).toEqual(["Remera qa oversize", "Calza qa agotada"]);
  });
  it("la tarjeta: precio con stock, talles con stock ordenados, colores con foto y si hay", async () => {
    const p = (await get("/v1/productos?categoria=mujer&sub=remeras-y-tops")).json().productos.find((x: { nombre: string }) => x.nombre === "Remera qa oversize");
    expect(p).toMatchObject({ precio: 1200000, precioHasta: 1200000, talles: ["S", "M"], agotado: false, nuevo: false });
    expect(p.colores.map((c: { clave: string; hay: boolean }) => [c.clave, c.hay])).toEqual([["negro", true], ["blanco", false]]);
    expect(p.colores[0].foto.clave).toMatch(/^p\/\d+\/qaapi1x1/);
    // Principal: la de exhibición; al pasar el mouse, la de color.
    expect(p.foto.clave).toMatch(/x2aaaa$/);
    expect(p.fotoHover.clave).toMatch(/x1aaaa$/);
  });
  it("los agotados van al final, marcados", async () => {
    const ps = qa((await get("/v1/productos?categoria=mujer")).json().productos);
    expect(ps.at(-1)).toMatchObject({ nombre: "Calza qa agotada", agotado: true });
  });
  it("con mostrarAgotados = false, no aparecen", async () => {
    await pool.query("UPDATE tienda.ajustes SET valor = 'false' WHERE clave = 'mostrarAgotados'");
    await redis.publish(CANAL_INVALIDAR, "{}");
    await new Promise((r) => setTimeout(r, 150));
    try {
      const ps = qa((await get("/v1/productos?categoria=mujer")).json().productos);
      expect(ps.map((p: { nombre: string }) => p.nombre)).toEqual(["Remera qa oversize"]);
    } finally {
      await pool.query("UPDATE tienda.ajustes SET valor = 'true' WHERE clave = 'mostrarAgotados'");
      await redis.publish(CANAL_INVALIDAR, "{}");
      await new Promise((r) => setTimeout(r, 150));
    }
  });
  it("categoría inexistente → 404; parámetros raros → 400", async () => {
    expect((await get("/v1/productos?categoria=no-existe")).statusCode).toBe(404);
    expect((await get("/v1/productos?categoria=mujer&sub=nada")).statusCode).toBe(404);
    expect((await get("/v1/productos?categoria=mujer'%20OR%201=1--")).statusCode).toBe(400);
    expect((await get("/v1/productos?categoria=mujer&otra=1")).statusCode).toBe(400);
    expect((await get("/v1/productos")).statusCode).toBe(400);
    expect((await get("/v1/productos?nuevos=1000")).statusCode).toBe(400);
  });
  it("nuevos: sólo con stock", async () => {
    const ps = qa((await get("/v1/productos?nuevos=24")).json().productos);
    expect(ps.every((p: { agotado: boolean }) => !p.agotado)).toBe(true);
    expect(ps.map((p: { nombre: string }) => p.nombre)).toContain("Jogger qa hombre");
  });
});

describe("ficha", () => {
  it("trae colores con sus fotos, exhibición, variantes activas y migas", async () => {
    const r = await get("/v1/productos/remera-qa-oversize");
    expect(r.statusCode).toBe(200);
    const p = r.json();
    expect(p.migas).toEqual([{ nombre: "Mujer", ruta: "/mujer" }, { nombre: "Remeras y tops", ruta: "/mujer/remeras-y-tops" }]);
    expect(p.colores.map((c: { clave: string; fotos: unknown[] }) => [c.clave, c.fotos.length])).toEqual([["negro", 1], ["blanco", 1]]);
    expect(p.exhibicion).toHaveLength(1);
    expect(p.exhibicion[0].color).toBe("negro");
    expect(p.variantes.map((v: { sku: string }) => v.sku)).toEqual(["QA-API-1-1", "QA-API-1-2", "QA-API-1-3"]);
    expect(p.descripcion).toBe("Descripción de Stocker");
  });
  it("el stock exacto no viaja: tope de 10", async () => {
    const p = (await get("/v1/productos/remera-qa-oversize")).json();
    expect(p.variantes.map((v: { stock: number }) => v.stock)).toEqual([10, 2, 0]);
  });
  it("no viajan datos internos", async () => {
    const t = (await get("/v1/productos/remera-qa-oversize")).body;
    for (const campo of ["stocker_id", "stockerId", "stock_en", "en_stocker", "visible"]) expect(t).not.toContain(campo);
  });
  it("oculto, de baja o inexistente → 404", async () => {
    for (const s of ["buzo-qa-oculto", "buzo-qa-de-baja", "no-existe"]) expect((await get(`/v1/productos/${s}`)).statusCode).toBe(404);
    expect((await get("/v1/productos/..%2F..%2Fetc")).statusCode).toBe(400);
  });
  it("un cambio de stock se ve al instante tras el aviso del worker", async () => {
    const antes = (await get("/v1/productos/jogger-qa-hombre")).json();
    expect(antes.agotado).toBe(false);
    await pool.query("UPDATE tienda.variantes SET stock = 0 WHERE sku = 'QA-API-5-1'");
    // Con caché de 60 s todavía se ve el viejo…
    expect((await get("/v1/productos/jogger-qa-hombre")).json().agotado).toBe(false);
    // …hasta que llega el aviso.
    await redis.publish(CANAL_INVALIDAR, JSON.stringify({ etiquetas: ["producto:jogger-qa-hombre"] }));
    await new Promise((r) => setTimeout(r, 150));
    expect((await get("/v1/productos/jogger-qa-hombre")).json().agotado).toBe(true);
  });
});

describe("búsqueda", () => {
  it("por prefijo, sin tildes ni mayúsculas", async () => {
    const r = await get("/v1/buscar?q=REMÉ%20overs");
    expect(qa(r.json().productos).map((p: { nombre: string }) => p.nombre)).toEqual(["Remera qa oversize"]);
  });
  it("por SKU padre (lo que dice la etiqueta)", async () => {
    expect(qa((await get("/v1/buscar?q=isu-9876")).json().productos).map((p: { nombre: string }) => p.nombre)).toEqual(["Jogger qa hombre"]);
  });
  it("no encuentra lo oculto", async () => {
    expect(qa((await get("/v1/buscar?q=oculto")).json().productos)).toEqual([]);
  });
  it("caracteres de tsquery o SQL no rompen nada", async () => {
    for (const q of ["a:*|b", "') OR 1=1 --", "!!&&||", "<script>", "%_%"]) {
      const r = await get(`/v1/buscar?q=${encodeURIComponent(q)}`);
      expect(r.statusCode, q).toBe(200);
    }
    expect(consultaDeBusqueda("remera:* | !negra")).toBe("remera:* & negra:*");
    expect(consultaDeBusqueda("!!!")).toBeNull();
  });
  it("muy corta o muy larga → 400", async () => {
    expect((await get("/v1/buscar?q=a")).statusCode).toBe(400);
    expect((await get(`/v1/buscar?q=${"a".repeat(61)}`)).statusCode).toBe(400);
  });
});

describe("sitemap", () => {
  it("sólo lo publicable", async () => {
    const slugs = (await get("/v1/productos-slugs")).json().map((s: { slug: string }) => s.slug);
    expect(slugs).toContain("remera-qa-oversize");
    expect(slugs).not.toContain("buzo-qa-oculto");
    expect(slugs).not.toContain("buzo-qa-de-baja");
  });
});

describe("fotos en desarrollo", () => {
  it("sirve sólo archivos con el formato exacto", async () => {
    await mkdir(path.join(dirFotos, "p/1"), { recursive: true });
    await writeFile(path.join(dirFotos, "p/1/abcdef12-800.webp"), "RIFF");
    await writeFile(path.join(dirFotos, "secreto.txt"), "no");
    const ok = await get("/fotos/p/1/abcdef12-800.webp");
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["content-type"]).toBe("image/webp");
    for (const u of ["/fotos/secreto.txt", "/fotos/p/1/../../secreto.txt", "/fotos/p/1/%2e%2e/%2e%2e/secreto.txt", "/fotos/p/1/abcdef12-800.png", "/fotos/p/1/noexiste1-800.webp"]) {
      expect((await get(u)).statusCode, u).toBe(404);
    }
  });
  it("sin FOTOS_DIR, la ruta no existe", async () => {
    const otra = await construirApp({ env: leerEntorno({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: DB, REDIS_URL: REDIS }), pool, redis });
    expect((await otra.inject("/fotos/p/1/abcdef12-800.webp")).statusCode).toBe(404);
    await otra.close();
  });
});
