import { randomBytes } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type pg from "pg";
import { aSlug, FOTOS_POR_COLOR } from "@isu/shared";
import type { Almacen } from "./almacen.js";
import { FotoInvalida, MAX_BYTES, procesarFoto, type FotoProcesada } from "./procesar.js";

/*
 * Importa fotos desde una carpeta con esta forma:
 *
 *   <carpeta>/<SKU padre>/<color>/01.jpg …          prenda sola (estirada/percha) de ese color
 *   <carpeta>/<SKU padre>/exhibicion/01.jpg …       con modelo, sin color
 *   <carpeta>/<SKU padre>/exhibicion/<color>/01.jpg con modelo que lleva ese color
 *
 * El color se busca por nombre ("Verde Militar", "verde-militar" y "verde
 * militar" son el mismo). Los archivos entran en orden alfabético.
 *
 * Cada foto entra en su propia transacción (ver guardarFoto): si la subida
 * falla, la fila no queda; si la fila no entra por el tope (5 por color y
 * 5 × colores por producto), no se sube nada.
 */
const EXTENSIONES = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".avif"]);

export interface Informe {
  subidas: number;
  omitidas: Array<{ archivo: string; motivo: string }>;
  /** slugs de los productos que cambiaron (para regenerar sus páginas) */
  productos: string[];
}

async function carpetas(dir: string) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- carpeta elegida por quien corre el comando
  return (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory() && !d.name.startsWith(".")).map((d) => d.name).sort();
}
async function imagenes(dir: string) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- carpeta elegida por quien corre el comando
  return (await readdir(dir, { withFileTypes: true }))
    .filter((d) => d.isFile() && EXTENSIONES.has(path.extname(d.name).toLowerCase()))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b, "es", { numeric: true }));
}

export interface NuevaFoto {
  productoId: number;
  tipo: "color" | "exhibicion";
  colorId: number | null;
  alt: string;
  /** de dónde salió ("mayorista:<id>"), para no importarla dos veces */
  origen?: string | null;
}

/*
 * Guarda una foto ya procesada: la fila se inserta ANTES de subir el archivo
 * (así el trigger de la base aplica los topes) y se confirma DESPUÉS de
 * subirlo. Va al final de su grupo (mismo tipo y color). Devuelve null si
 * entró o el motivo si no.
 */
export async function guardarFoto(pool: pg.Pool, almacen: Almacen, f: NuevaFoto, proc: FotoProcesada): Promise<string | null> {
  const clave = `p/${f.productoId}/${randomBytes(8).toString("hex")}`;
  const cli = await pool.connect();
  try {
    await cli.query("BEGIN");
    const orden = await cli.query<{ n: number }>(
      "SELECT COALESCE(max(orden) + 1, 0)::int AS n FROM tienda.fotos WHERE producto_id = $1 AND tipo = $2 AND color_id IS NOT DISTINCT FROM $3",
      [f.productoId, f.tipo, f.colorId],
    );
    await cli.query(
      "INSERT INTO tienda.fotos (producto_id, tipo, color_id, orden, clave, ancho, alto, alt, origen) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [f.productoId, f.tipo, f.colorId, orden.rows[0]!.n, clave, proc.ancho, proc.alto, f.alt.slice(0, 160), f.origen ?? null],
    );
    for (const t of proc.tamanos) await almacen.guardar(`${clave}-${t.ancho}.webp`, t.datos, "image/webp");
    await cli.query("COMMIT");
    return null;
  } catch (e) {
    await cli.query("ROLLBACK").catch(() => {});
    const pg = e as { code?: string; message: string };
    for (const w of [400, 800, 1200]) await almacen.borrar(`${clave}-${w}.webp`).catch(() => {});
    return pg.code === "23514" ? pg.message : pg.code === "23505" ? "ya estaba importada" : `falló: ${pg.message}`;
  } finally {
    cli.release();
  }
}

export async function importarCarpeta(
  pool: pg.Pool,
  almacen: Almacen,
  raiz: string,
  opciones: { reemplazar?: boolean; log?: (s: string) => void } = {},
): Promise<Informe> {
  const log = opciones.log ?? (() => {});
  const informe: Informe = { subidas: 0, omitidas: [], productos: [] };
  const omitir = (archivo: string, motivo: string) => { informe.omitidas.push({ archivo, motivo }); log(`  ✗ ${archivo}: ${motivo}`); };

  for (const sku of await carpetas(raiz)) {
    const prods = await pool.query<{ id: number; nombre: string; slug: string }>(
      "SELECT id, nombre, slug FROM tienda.productos WHERE upper(stocker_padre) = upper($1)", [sku],
    );
    if (prods.rowCount !== 1) {
      omitir(sku, prods.rowCount ? "hay más de un producto con ese SKU padre" : "no hay un producto con ese SKU padre (¿ya se sincronizó con Stocker?)");
      continue;
    }
    const producto = prods.rows[0]!;
    log(`${sku} · ${producto.nombre}`);
    informe.productos.push(producto.slug);
    const colores = new Map(
      (await pool.query<{ id: number; clave: string }>("SELECT id, clave FROM tienda.producto_colores WHERE producto_id = $1", [producto.id]))
        .rows.map((c) => [c.clave, c.id]),
    );

    // [carpeta, tipo, color]
    const lotes: Array<[string, "color" | "exhibicion", number | null, string]> = [];
    for (const sub of await carpetas(path.join(raiz, sku))) {
      const dir = path.join(raiz, sku, sub);
      if (aSlug(sub) === "exhibicion") {
        lotes.push([dir, "exhibicion", null, `${sku}/${sub}`]);
        for (const c of await carpetas(dir)) {
          const id = colores.get(aSlug(c, 40));
          if (!id) { omitir(`${sku}/${sub}/${c}`, `el producto no tiene el color «${c}»`); continue; }
          lotes.push([path.join(dir, c), "exhibicion", id, `${sku}/${sub}/${c}`]);
        }
      } else {
        const id = colores.get(aSlug(sub, 40));
        if (!id) { omitir(`${sku}/${sub}`, `el producto no tiene el color «${sub}» (colores: ${[...colores.keys()].join(", ")})`); continue; }
        lotes.push([dir, "color", id, `${sku}/${sub}`]);
      }
    }

    // Primero las de color: son las que arman el selector, y el cupo del producto es compartido.
    lotes.sort((x, y) => Number(x[1] === "exhibicion") - Number(y[1] === "exhibicion"));

    if (opciones.reemplazar && lotes.length) {
      const viejas = await pool.query<{ clave: string }>("DELETE FROM tienda.fotos WHERE producto_id = $1 RETURNING clave", [producto.id]);
      for (const v of viejas.rows) for (const w of [400, 800, 1200]) await almacen.borrar(`${v.clave}-${w}.webp`).catch(() => {});
    }

    for (const [dir, tipo, colorId, nombre] of lotes) {
      const archivos = await imagenes(dir);
      if (tipo === "color" && archivos.length > FOTOS_POR_COLOR) {
        log(`  ! ${nombre}: ${archivos.length} fotos; entran las primeras ${FOTOS_POR_COLOR}`);
      }
      for (const a of archivos) {
        const ruta = path.join(dir, a);
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- archivo de la carpeta elegida
        const st = await stat(ruta);
        if (st.size > MAX_BYTES) { omitir(`${nombre}/${a}`, "pesa más de 25 MB"); continue; }
        let proc;
        try {
          // eslint-disable-next-line security/detect-non-literal-fs-filename -- archivo de la carpeta elegida
          proc = await procesarFoto(await readFile(ruta));
        } catch (e) {
          omitir(`${nombre}/${a}`, e instanceof FotoInvalida ? e.message : "no se pudo procesar");
          continue;
        }
        const error = await guardarFoto(pool, almacen, { productoId: producto.id, tipo, colorId, alt: producto.nombre }, proc);
        if (error) omitir(`${nombre}/${a}`, error);
        else { informe.subidas++; log(`  ✓ ${nombre}/${a}`); }
      }
    }
  }
  return informe;
}
