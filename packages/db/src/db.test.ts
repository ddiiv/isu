import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, writeFile, cp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crearPool } from "./conexion.js";
import { migrar } from "./migrar.js";

/*
 * Contra una base REAL que ya tiene las tablas de Stocker (stocker_test), que
 * es como va a estar en producción: la tienda vive al lado, en su esquema.
 */
const URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:5433/stocker_test";
const pool = crearPool({ url: URL, max: 6 });
const MIGRACIONES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migraciones");

async function tablasDe(esquema: string) {
  const { rows } = await pool.query<{ t: string; h: string }>(
    `SELECT c.relname AS t, md5(string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' ORDER BY a.attnum)) AS h
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      WHERE n.nspname = $1 AND c.relkind = 'r' GROUP BY c.relname ORDER BY c.relname`,
    [esquema],
  );
  return rows;
}

let publicAntes: Awaited<ReturnType<typeof tablasDe>>;

beforeAll(async () => {
  publicAntes = await tablasDe("public");
  await pool.query("DROP SCHEMA IF EXISTS tienda CASCADE");
});
afterAll(async () => { await pool.end(); });

describe("migraciones", () => {
  it("aplica todo la primera vez y nada la segunda", async () => {
    const r1 = await migrar(pool);
    expect(r1.aplicadas.length).toBeGreaterThanOrEqual(3);
    const r2 = await migrar(pool);
    expect(r2.aplicadas).toEqual([]);
    expect(r2.yaEstaban.length).toBe(r1.aplicadas.length);
  });

  it("no toca ni una tabla de Stocker (esquema public)", async () => {
    expect(publicAntes.length).toBeGreaterThan(0); // la base de prueba sí tiene Stocker
    expect(await tablasDe("public")).toEqual(publicAntes);
  });

  it("dos réplicas migrando a la vez no chocan", async () => {
    await pool.query("DROP SCHEMA tienda CASCADE");
    const [a, b] = await Promise.all([migrar(pool), migrar(pool)]);
    expect(a.aplicadas.length + b.aplicadas.length).toBe(a.aplicadas.length || b.aplicadas.length);
  });

  it("frena si alguien edita una migración ya aplicada", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "mig-"));
    await cp(MIGRACIONES, dir, { recursive: true });
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- carpeta temporal del test
    await writeFile(path.join(dir, "0001_base.sql"), "-- editada\n");
    await expect(migrar(pool, dir)).rejects.toThrow(/cambió después de aplicada/);
  });

  it("carga los ajustes y las categorías iniciales", async () => {
    const { rows } = await pool.query("SELECT clave FROM tienda.ajustes ORDER BY clave");
    expect(rows.map((r) => r.clave)).toContain("whatsapp");
    const { rows: cats } = await pool.query("SELECT count(*)::int AS n FROM tienda.categorias WHERE padre_id IS NULL");
    expect(cats[0].n).toBe(3);
  });
});

describe("categorías", () => {
  it("dos niveles como máximo", async () => {
    const { rows } = await pool.query("SELECT id FROM tienda.categorias WHERE padre_id IS NOT NULL LIMIT 1");
    await expect(
      pool.query("INSERT INTO tienda.categorias (padre_id, nombre, slug) VALUES ($1, 'Nieta', 'nieta')", [rows[0].id]),
    ).rejects.toThrow(/dos niveles/);
  });
  it("una categoría con hijas no puede volverse subcategoría", async () => {
    const { rows } = await pool.query("SELECT id FROM tienda.categorias WHERE slug IN ('hombre','mujer') ORDER BY slug");
    await expect(
      pool.query("UPDATE tienda.categorias SET padre_id = $1 WHERE id = $2", [rows[1].id, rows[0].id]),
    ).rejects.toThrow(/no puede pasar a ser subcategoría/);
  });
  it("slug inválido rechazado", async () => {
    await expect(pool.query("INSERT INTO tienda.categorias (nombre, slug) VALUES ('X', 'Con Espacios')")).rejects.toThrow();
  });
});

describe("fotos: 5 por color, 5 × colores por producto", () => {
  let producto: number;
  let negro: number;
  let blanco: number;

  beforeAll(async () => {
    const p = await pool.query("INSERT INTO tienda.productos (stocker_padre, nombre, slug) VALUES ('ISUTEST', 'Test', 'test') RETURNING id");
    producto = p.rows[0].id;
    const c = await pool.query(
      "INSERT INTO tienda.producto_colores (producto_id, clave, nombre) VALUES ($1,'negro','Negro'),($1,'blanco','Blanco') RETURNING id",
      [producto],
    );
    [negro, blanco] = c.rows.map((r) => r.id);
  });

  let n = 0;
  const foto = (tipo: string, color: number | null) =>
    pool.query("INSERT INTO tienda.fotos (producto_id, tipo, color_id, clave) VALUES ($1,$2,$3,$4)", [producto, tipo, color, `t/${++n}.jpg`]);

  it("una de color necesita color", async () => {
    await expect(foto("color", null)).rejects.toThrow();
  });

  it("la sexta foto de un color no entra", async () => {
    for (let i = 0; i < 5; i++) await foto("color", negro);
    await expect(foto("color", negro)).rejects.toThrow(/ya tiene 5 fotos/);
  });

  it("las de exhibición cuentan para el tope del padre (2 colores → 10)", async () => {
    await foto("color", blanco);
    await foto("color", blanco);
    await foto("exhibicion", null);
    await foto("exhibicion", negro); // la modelo lleva el negro
    await foto("exhibicion", null); // 5 + 2 + 3 = 10: la décima entra
    await expect(foto("exhibicion", null)).rejects.toThrow(/ya tiene 10 fotos/);
    await expect(foto("color", blanco)).rejects.toThrow(/ya tiene 10 fotos/);
  });

  it("no se puede usar el color de otro producto", async () => {
    const otro = await pool.query("INSERT INTO tienda.productos (stocker_padre, nombre, slug) VALUES ('ISUOTRO','Otro','otro') RETURNING id");
    await expect(
      pool.query("INSERT INTO tienda.fotos (producto_id, tipo, color_id, clave) VALUES ($1,'color',$2,'x/1.jpg')", [otro.rows[0].id, negro]),
    ).rejects.toThrow(/no es de este producto/);
  });

  it("subidas simultáneas no se saltean el tope", async () => {
    const p = await pool.query("INSERT INTO tienda.productos (stocker_padre, nombre, slug) VALUES ('ISUCARRERA','C','carrera') RETURNING id");
    const c = await pool.query("INSERT INTO tienda.producto_colores (producto_id, clave, nombre) VALUES ($1,'rojo','Rojo') RETURNING id", [p.rows[0].id]);
    const intentos = Array.from({ length: 12 }, (_, i) =>
      pool.query("INSERT INTO tienda.fotos (producto_id, tipo, color_id, clave) VALUES ($1,'color',$2,$3)", [p.rows[0].id, c.rows[0].id, `carrera/${i}.jpg`])
        .then(() => "ok", () => "no"),
    );
    const r = await Promise.all(intentos);
    expect(r.filter((x) => x === "ok").length).toBe(5);
  });
});

describe("auditoría", () => {
  it("se agrega pero no se edita ni se borra", async () => {
    await pool.query("INSERT INTO tienda.auditoria (actor, accion, entidad) VALUES ('qa','prueba','test')");
    await expect(pool.query("UPDATE tienda.auditoria SET actor = 'otro'")).rejects.toThrow(/no se modifica/);
    await expect(pool.query("DELETE FROM tienda.auditoria")).rejects.toThrow(/no se modifica/);
  });
});
