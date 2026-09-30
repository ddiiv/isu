import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { crearPool, migrar } from "@isu/db";
import { procesarFoto, FotoInvalida } from "./procesar.js";
import { importarCarpeta } from "./importar.js";
import { almacenEnDisco, PATRON_FOTOS, type Almacen } from "./almacen.js";

const URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:5433/stocker_test";
const pool = crearPool({ url: URL, max: 3 });
const BASE = 7_300_000;

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
    await pool.end();
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
    const { rows } = await pool.query("SELECT clave FROM tienda.fotos WHERE producto_id = $1 LIMIT 1", [producto]);
    const [, , id] = rows[0].clave.split("/");
    expect((await readdir(path.join(dirFotos, "p", String(producto)))).filter((f) => f.startsWith(id)).sort()).toEqual([`${id}-1200.webp`, `${id}-400.webp`, `${id}-800.webp`]);
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
    expect((await readdir(path.join(dirFotos, "p", String(producto)))).length).toBe(9);
  });
});
