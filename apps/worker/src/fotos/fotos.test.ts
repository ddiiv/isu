import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { crearPool, migrar } from "@isu/db";
import { procesarFoto, FotoInvalida } from "./procesar.js";
import { importarCarpeta } from "./importar.js";
import { almacenEnDisco, PATRON_FOTOS, type Almacen } from "./almacen.js";
import { PATRON_BANNERS } from "@isu/almacen";
import { pasarFotosSinIds } from "./sin-ids.js";

const URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:5433/stocker_test";
const pool = crearPool({ url: URL, max: 3 });
const BASE = 7_300_000;
afterAll(async () => { await pool.end(); });

const imagen = (w: number, h: number, extra?: (s: sharp.Sharp) => sharp.Sharp) => {
  let s = sharp({ create: { width: w, height: h, channels: 3, background: "#2c5f91" } }).jpeg();
  if (extra) s = extra(s);
  return s.toBuffer();
};

describe("procesar una foto", () => {
  it("genera 400/800/1200 en webp, sin agrandar", async () => {
    const r = await procesarFoto(await imagen(1000, 1250));
    expect(r.tamanos.map((t) => t.ancho)).toEqual([400, 800, 1200]);
    const anchos = await Promise.all(r.tamanos.map(async (t) => (await sharp(t.datos).metadata()).width));
    expect(anchos).toEqual([400, 800, 1000]);
    expect((await sharp(r.tamanos[0]!.datos).metadata()).format).toBe("webp");
    expect([r.ancho, r.alto]).toEqual([1000, 1250]);
  });
  it("gira según EXIF y borra los metadatos (GPS incluido)", async () => {
    const conExif = await imagen(600, 900, (s) => s.withMetadata({ orientation: 6, exif: { IFD0: { Copyright: "secreto", Make: "Celular" } } }));
    const r = await procesarFoto(conExif);
    const m = await sharp(r.tamanos[2]!.datos).metadata();
    expect(m.exif).toBeUndefined();
    expect(m.orientation).toBeUndefined();
    // 600 × 900 girada 90° → 900 × 600
    expect([m.width, m.height]).toEqual([900, 600]);
  });
  it("rechaza lo que no es imagen, lo muy chico y lo desproporcionado", async () => {
    await expect(procesarFoto(Buffer.from("<?php system($_GET['c']); ?>"))).rejects.toThrow(FotoInvalida);
    await expect(procesarFoto(await imagen(200, 200))).rejects.toThrow(/Muy chica/);
    await expect(procesarFoto(await imagen(4000, 400))).rejects.toThrow(/Proporción/);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><script>alert(1)</script></svg>');
    await expect(procesarFoto(svg)).rejects.toThrow(/Formato no admitido/);
  });
  it("una bomba de píxeles no se descomprime", async () => {
    // PNG liviano (todo del mismo color comprime a casi nada) de 60 megapíxeles.
    const bomba = await sharp({ create: { width: 10000, height: 6000, channels: 3, background: "#000" } }).png({ compressionLevel: 9 }).toBuffer();
    await expect(procesarFoto(bomba)).rejects.toThrow(FotoInvalida);
  });
});

describe("importar una carpeta", () => {
  let dirFotos: string;
  let dirOrigen: string;
  let producto: number;

  beforeAll(async () => { await migrar(pool); });
  beforeEach(async () => {
    await pool.query("DELETE FROM tienda.productos WHERE stocker_id >= $1 AND stocker_id < $2", [BASE, BASE + 100]);
    const p = await pool.query("INSERT INTO tienda.productos (stocker_id, stocker_padre, nombre, slug) VALUES ($1,'QA-FOTO','Remera foto','qa-remera-foto') RETURNING id", [BASE + 1]);
    producto = p.rows[0].id;
    await pool.query("INSERT INTO tienda.producto_colores (producto_id, clave, nombre) VALUES ($1,'negro','Negro'),($1,'verde-militar','Verde Militar')", [producto]);
    dirFotos = await mkdtemp(path.join(os.tmpdir(), "fotos-dst-"));
    dirOrigen = await mkdtemp(path.join(os.tmpdir(), "fotos-src-"));
  });
  afterAll(async () => {
    await pool.query("DELETE FROM tienda.productos WHERE stocker_id >= $1 AND stocker_id < $2", [BASE, BASE + 100]);
  });

  const poner = async (rel: string, n: number) => {
    await mkdir(path.join(dirOrigen, rel), { recursive: true });
    for (let i = 1; i <= n; i++) await writeFile(path.join(dirOrigen, rel, `${String(i).padStart(2, "0")}.jpg`), await imagen(500, 600));
  };
  const cuantas = async () => (await pool.query("SELECT tipo, color_id IS NOT NULL AS con_color, count(*)::int n FROM tienda.fotos WHERE producto_id = $1 GROUP BY 1,2 ORDER BY 1,2", [producto])).rows;

  it("sube por color y de exhibición; el color se reconoce con espacios y mayúsculas", async () => {
    await poner("qa-foto/Negro", 2);
    await poner("qa-foto/verde militar", 1);
    await poner("qa-foto/Exhibicion", 1);
    await poner("qa-foto/Exhibicion/negro", 1);
    const r = await importarCarpeta(pool, almacenEnDisco(dirFotos, PATRON_FOTOS), dirOrigen);
    expect(r).toEqual({ subidas: 5, omitidas: [], productos: ["qa-remera-foto"] });
    expect(await cuantas()).toEqual([{ tipo: "color", con_color: true, n: 3 }, { tipo: "exhibicion", con_color: false, n: 1 }, { tipo: "exhibicion", con_color: true, n: 1 }]);
    const { rows } = await pool.query("SELECT clave FROM tienda.fotos WHERE producto_id = $1", [producto]);
    // Etapa 12: la dirección no lleva el id del producto (una carpeta al azar por foto).
    for (const r of rows) expect(r.clave).toMatch(/^p\/[a-f0-9]{12}\/[a-f0-9]{16}$/);
    const [, carpeta, id] = rows[0].clave.split("/");
    expect((await readdir(path.join(dirFotos, "p", carpeta))).sort()).toEqual([`${id}-1200.webp`, `${id}-400.webp`, `${id}-800.webp`]);
  });

  it("los topes los pone la base: la 6ª del color no entra, y el producto llega a 10 como mucho", async () => {
    await poner("QA-FOTO/negro", 7);
    await poner("QA-FOTO/exhibicion", 6);
    const r = await importarCarpeta(pool, almacenEnDisco(dirFotos, PATRON_FOTOS), dirOrigen);
    expect(r.subidas).toBe(10);
    expect(r.omitidas.map((o) => o.motivo)).toEqual([
      "Este color ya tiene 5 fotos", "Este color ya tiene 5 fotos",
      "El producto ya tiene 10 fotos (5 por cada uno de sus 2 colores)",
    ]);
  });

  it("si falla la subida, no queda la fila", async () => {
    await poner("QA-FOTO/negro", 1);
    const roto: Almacen = { guardar: async () => { throw new Error("R2 caído"); }, leer: async () => null, borrar: async () => {} };
    const r = await importarCarpeta(pool, roto, dirOrigen);
    expect(r.subidas).toBe(0);
    expect(await cuantas()).toEqual([]);
  });

  it("SKU o color desconocido: avisa y sigue", async () => {
    await poner("NO-EXISTE/negro", 1);
    await poner("QA-FOTO/fucsia", 1);
    await poner("QA-FOTO/negro", 1);
    const r = await importarCarpeta(pool, almacenEnDisco(dirFotos, PATRON_FOTOS), dirOrigen);
    expect(r.subidas).toBe(1);
    expect(r.omitidas.map((o) => o.archivo)).toEqual(["NO-EXISTE", "QA-FOTO/fucsia"]);
  });

  it("--reemplazar borra las anteriores (filas y archivos)", async () => {
    await poner("QA-FOTO/negro", 3);
    await importarCarpeta(pool, almacenEnDisco(dirFotos, PATRON_FOTOS), dirOrigen);
    const r = await importarCarpeta(pool, almacenEnDisco(dirFotos, PATRON_FOTOS), dirOrigen, { reemplazar: true });
    expect(r.subidas).toBe(3);
    expect(await cuantas()).toEqual([{ tipo: "color", con_color: true, n: 3 }]);
    const claves = (await pool.query("SELECT clave FROM tienda.fotos WHERE producto_id = $1", [producto])).rows.map((r) => r.clave as string);
    let archivos = 0;
    for (const c of (await readdir(path.join(dirFotos, "p")))) archivos += (await readdir(path.join(dirFotos, "p", c))).length;
    expect(archivos).toBe(9);
    for (const c of claves) expect(await readdir(path.join(dirFotos, ...c.split("/").slice(0, 2)))).toHaveLength(3);
  });
});

describe("fotos y banners sin ids en la dirección (pnpm fotos:sin-ids)", () => {
  const BASE_SIN = BASE + 50;
  let dir: string;
  let producto: number;
  const tam = (clave: string, ws: number[]) => ws.map((w) => `${clave}-${w}.webp`);

  beforeAll(async () => { await migrar(pool); });
  beforeEach(async () => {
    await pool.query("DELETE FROM tienda.productos WHERE stocker_id >= $1 AND stocker_id < $2", [BASE_SIN, BASE_SIN + 10]);
    await pool.query("DELETE FROM tienda.banners WHERE alt LIKE 'QA sin ids%'");
    dir = await mkdtemp(path.join(os.tmpdir(), "fotos-sin-ids-"));
    producto = (await pool.query("INSERT INTO tienda.productos (stocker_id, stocker_padre, nombre, slug) VALUES ($1,'QA-SIN-IDS','Remera sin ids','qa-remera-sin-ids') RETURNING id", [BASE_SIN])).rows[0].id;
    await pool.query("INSERT INTO tienda.producto_colores (producto_id, clave, nombre) VALUES ($1,'negro','Negro')", [producto]);
  });
  afterAll(async () => {
    await pool.query("DELETE FROM tienda.productos WHERE stocker_id >= $1 AND stocker_id < $2", [BASE_SIN, BASE_SIN + 10]);
    await pool.query("DELETE FROM tienda.banners WHERE alt LIKE 'QA sin ids%'");
  });

  it("copia cada foto a una dirección nueva, cambia la base y (si se pide) borra la vieja; se puede volver a correr", async () => {
    const fotos = almacenEnDisco(dir, PATRON_FOTOS);
    const banners = almacenEnDisco(dir, PATRON_BANNERS);
    const vieja = `p/${producto}/abcdef0123456789`;
    for (const f of tam(vieja, [400, 800, 1200])) await fotos.guardar(f, Buffer.from(f), "image/webp");
    await pool.query("INSERT INTO tienda.fotos (producto_id, tipo, clave) VALUES ($1, 'exhibicion', $2)", [producto, vieja]);
    // Una foto vieja que ya no tiene sus archivos: queda como está.
    const perdida = `p/${producto}/0000aaaa1111bbbb`;
    await pool.query("INSERT INTO tienda.fotos (producto_id, tipo, clave) VALUES ($1, 'exhibicion', $2)", [producto, perdida]);
    const b = (await pool.query("INSERT INTO tienda.banners (alt, activo) VALUES ('QA sin ids', false) RETURNING id")).rows[0].id;
    await pool.query("UPDATE tienda.banners SET foto = $2 WHERE id = $1", [b, `b/${b}/1234567890abcdef`]);
    for (const f of tam(`b/${b}/1234567890abcdef`, [800, 1600, 2400])) await banners.guardar(f, Buffer.from(f), "image/webp");

    const r = await pasarFotosSinIds(pool, { fotos, banners }, { borrarViejas: true });
    expect(r).toEqual({ fotos: 1, banners: 1, faltantes: [perdida], productos: ["qa-remera-sin-ids"] });
    const nueva = (await pool.query("SELECT clave FROM tienda.fotos WHERE producto_id = $1 AND clave <> $2", [producto, perdida])).rows[0].clave as string;
    expect(nueva).toMatch(/^p\/[a-f0-9]{12}\/[a-f0-9]{16}$/);
    expect(nueva).not.toContain(String(producto));
    // El contenido es el mismo, en la dirección nueva; la vieja ya no está.
    expect(String(await fotos.leer(`${nueva}-800.webp`))).toBe(`${vieja}-800.webp`);
    expect(await fotos.leer(`${vieja}-800.webp`)).toBeNull();
    const fb = (await pool.query("SELECT foto FROM tienda.banners WHERE id = $1", [b])).rows[0].foto as string;
    expect(fb).toMatch(/^b\/[a-f0-9]{12}\/[a-f0-9]{16}$/);
    expect(await banners.leer(`${fb}-2400.webp`)).not.toBeNull();
    // Otra vez: no queda nada por pasar (la perdida sigue avisándose).
    expect(await pasarFotosSinIds(pool, { fotos, banners })).toEqual({ fotos: 0, banners: 0, faltantes: [perdida], productos: [] });
  });

  it("sin --borrar-viejas, los archivos viejos quedan (lo que Google ya guardó sigue andando)", async () => {
    const fotos = almacenEnDisco(dir, PATRON_FOTOS);
    const vieja = `p/${producto}/fedcba9876543210`;
    for (const f of tam(vieja, [400, 800, 1200])) await fotos.guardar(f, Buffer.from(f), "image/webp");
    await pool.query("INSERT INTO tienda.fotos (producto_id, tipo, clave) VALUES ($1, 'exhibicion', $2)", [producto, vieja]);
    const r = await pasarFotosSinIds(pool, { fotos, banners: almacenEnDisco(dir, PATRON_BANNERS) });
    expect(r.fotos).toBe(1);
    expect(await fotos.leer(`${vieja}-1200.webp`)).not.toBeNull();
  });
});
