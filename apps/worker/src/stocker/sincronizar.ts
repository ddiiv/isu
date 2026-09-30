import type pg from "pg";
import { aSlug, hexDeColor, proponerCategorias } from "@isu/shared";
import type { CatalogoStocker, ProductoStocker, StockStocker } from "./cliente.js";

/*
 * Aplica lo que manda Stocker sobre la copia de la tienda.
 *
 * Reglas que no se negocian:
 *
 *   · Lo que es de la tienda no se pisa: slug (cambiarlo rompe enlaces y
 *     SEO), fotos, textos propios, categorías corregidas a mano y el nombre
 *     si alguien lo fijó.
 *   · Un stock más viejo no pisa uno más nuevo (`stock_en`).
 *   · Sólo se escribe lo que cambió. La base es la de Stocker: reescribir
 *     cinco mil filas iguales cada diez minutos es carga y WAL que le
 *     sacamos a las ventas.
 *   · Por tandas cortas y en transacción: si algo falla a la mitad, lo ya
 *     aplicado queda bien y lo demás se reintenta en la próxima pasada.
 */

export const COLOR_UNICO = { clave: "unico", nombre: "Único" } as const;
const TANDA = 50;

export interface ResultadoCatalogo {
  productos: number;
  variantes: number;
  nuevos: number;
  bajas: number;
  cambios: number;
  /** slugs de productos con algún cambio visible, para invalidar sus páginas */
  afectados: string[];
}

interface Arbol {
  raiz: Map<string, number>;
  hija: Map<string, number>; // "padre/hija" → id
}

async function leerArbol(db: pg.PoolClient | pg.Pool): Promise<Arbol> {
  const { rows } = await db.query<{ id: number; slug: string; padre: string | null }>(
    `SELECT c.id, c.slug, p.slug AS padre FROM tienda.categorias c LEFT JOIN tienda.categorias p ON p.id = c.padre_id`,
  );
  const arbol: Arbol = { raiz: new Map(), hija: new Map() };
  for (const r of rows) {
    if (r.padre === null) arbol.raiz.set(r.slug, r.id);
    else arbol.hija.set(`${r.padre}/${r.slug}`, r.id);
  }
  return arbol;
}

/** Ids de categoría para un producto: la subcategoría si existe, si no la de arriba. */
export function categoriasPara(p: Pick<ProductoStocker, "categoria" | "genero" | "titulo">, arbol: Arbol): number[] {
  const ids: number[] = [];
  for (const [padre, hija] of proponerCategorias(p.categoria, p.genero, p.titulo)) {
    const id = (hija && arbol.hija.get(`${padre}/${hija}`)) || arbol.raiz.get(padre);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function claveColor(nombre: string | null): { clave: string; nombre: string } {
  if (!nombre) return COLOR_UNICO;
  const clave = aSlug(nombre, 40);
  return clave ? { clave, nombre: nombre.slice(0, 60) } : COLOR_UNICO;
}

/** Slug nuevo y libre para un producto. Una vez asignado no cambia nunca. */
function slugLibre(titulo: string, stockerId: number, usados: Set<string>): string {
  const base = aSlug(titulo, 70) || `producto-${stockerId}`;
  let s = base;
  for (let i = 2; usados.has(s); i++) s = i === 2 ? `${base}-${stockerId}` : `${base}-${stockerId}-${i}`;
  usados.add(s);
  return s;
}

async function ajuste<T>(db: pg.Pool, clave: string, porDefecto: T): Promise<T> {
  const { rows } = await db.query<{ valor: T }>("SELECT valor FROM tienda.ajustes WHERE clave = $1", [clave]);
  return rows[0]?.valor ?? porDefecto;
}

export async function aplicarCatalogo(pool: pg.Pool, cat: CatalogoStocker): Promise<ResultadoCatalogo> {
  const publicarNuevos = await ajuste(pool, "publicarNuevos", true);
  const arbol = await leerArbol(pool);
  const existentes = new Map<number, { id: number; slug: string }>();
  const usados = new Set<string>();
  {
    const { rows } = await pool.query<{ id: number; slug: string; stocker_id: number | null }>(
      "SELECT id, slug, stocker_id FROM tienda.productos",
    );
    for (const r of rows) {
      usados.add(r.slug);
      if (r.stocker_id !== null) existentes.set(r.stocker_id, { id: r.id, slug: r.slug });
    }
  }

  const res: ResultadoCatalogo = { productos: 0, variantes: 0, nuevos: 0, bajas: 0, cambios: 0, afectados: [] };
  const afectados = new Set<string>();
  // Un producto sin ninguna variante con precio no se puede vender: no entra (y si estaba, sale).
  const vendibles = cat.productos
    .map((p) => ({ ...p, variantes: p.variantes.filter((v) => (v.precio ?? p.precio) !== null) }))
    .filter((p) => p.variantes.length > 0);

  for (let i = 0; i < vendibles.length; i += TANDA) {
    const tanda = vendibles.slice(i, i + TANDA);
    const cli = await pool.connect();
    try {
      await cli.query("BEGIN");
      for (const p of tanda) {
        const cambios = await aplicarProducto(cli, p, cat.generado, { existentes, usados, arbol, publicarNuevos });
        res.productos++;
        res.variantes += p.variantes.length;
        if (cambios.nuevo) res.nuevos++;
        if (cambios.n > 0) { res.cambios += cambios.n; afectados.add(cambios.slug); }
      }
      await cli.query("COMMIT");
    } catch (e) {
      await cli.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      cli.release();
    }
  }

  // Lo que ya no viene de Stocker (baja, pasó a feria, quedó sin precio) se esconde. No se borra:
  // conserva sus fotos y su slug por si vuelve.
  const ids = vendibles.map((p) => p.id);
  const bajas = await pool.query<{ slug: string }>(
    `UPDATE tienda.productos SET en_stocker = false, actualizado_en = now()
      WHERE stocker_id IS NOT NULL AND en_stocker AND NOT (stocker_id = ANY($1::int[]))
      RETURNING slug`,
    [ids],
  );
  if (bajas.rowCount) {
    await pool.query(
      `UPDATE tienda.variantes v SET activo = false, actualizado_en = now()
         FROM tienda.productos p WHERE p.id = v.producto_id AND NOT p.en_stocker AND v.activo`,
    );
    for (const b of bajas.rows) afectados.add(b.slug);
  }
  res.bajas = bajas.rowCount ?? 0;
  res.cambios += res.bajas;
  res.afectados = [...afectados];
  return res;
}

async function aplicarProducto(
  cli: pg.PoolClient,
  p: ProductoStocker,
  generado: string,
  ctx: { existentes: Map<number, { id: number; slug: string }>; usados: Set<string>; arbol: Arbol; publicarNuevos: boolean },
): Promise<{ n: number; nuevo: boolean; slug: string }> {
  let n = 0;
  let nuevo = false;
  let actual = ctx.existentes.get(p.id);

  if (!actual) {
    const slug = slugLibre(p.titulo, p.id, ctx.usados);
    const { rows } = await cli.query<{ id: number }>(
      `INSERT INTO tienda.productos
         (stocker_id, stocker_padre, nombre, slug, visible, stocker_descripcion, stocker_categoria, stocker_genero, en_stocker, sincronizado_en)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,now()) RETURNING id`,
      [p.id, p.sku, p.titulo, slug, ctx.publicarNuevos, p.descripcion, p.categoria, p.genero],
    );
    actual = { id: rows[0]!.id, slug };
    ctx.existentes.set(p.id, actual);
    nuevo = true;
    n++;
  } else {
    const r = await cli.query(
      `UPDATE tienda.productos SET
          stocker_padre = $2,
          nombre = CASE WHEN nombre_fijo THEN nombre ELSE $3 END,
          stocker_descripcion = $4, stocker_categoria = $5, stocker_genero = $6,
          en_stocker = true, sincronizado_en = now(), actualizado_en = now()
        WHERE id = $1 AND (
          CASE WHEN nombre_fijo THEN nombre ELSE $3 END, $4, $5, $6, true
        ) IS DISTINCT FROM (nombre, stocker_descripcion, stocker_categoria, stocker_genero, en_stocker)`,
      [actual.id, p.sku, p.titulo, p.descripcion, p.categoria, p.genero],
    );
    if (r.rowCount) n++;
    // El SKU padre no se muestra: si cambia solo, se guarda pero no cuenta como cambio visible.
    await cli.query("UPDATE tienda.productos SET stocker_padre = $2 WHERE id = $1 AND stocker_padre IS DISTINCT FROM $2", [actual.id, p.sku]);
  }
  const productoId = actual.id;

  // ── Categorías (salvo que alguien las haya corregido a mano) ──
  const cats = categoriasPara(p, ctx.arbol);
  const fijas = await cli.query<{ categorias_fijas: boolean }>("SELECT categorias_fijas FROM tienda.productos WHERE id = $1", [productoId]);
  if (!fijas.rows[0]?.categorias_fijas) {
    const antes = await cli.query<{ categoria_id: number }>(
      "SELECT categoria_id FROM tienda.producto_categorias WHERE producto_id = $1 ORDER BY categoria_id", [productoId],
    );
    const a = antes.rows.map((r) => r.categoria_id).join(",");
    const b = [...cats].sort((x, y) => x - y).join(",");
    if (a !== b) {
      await cli.query("DELETE FROM tienda.producto_categorias WHERE producto_id = $1", [productoId]);
      if (cats.length) {
        await cli.query(
          "INSERT INTO tienda.producto_categorias (producto_id, categoria_id) SELECT $1, unnest($2::int[])",
          [productoId, cats],
        );
      }
      await cli.query("UPDATE tienda.productos SET categoria_id = $2 WHERE id = $1", [productoId, cats[0] ?? null]);
      n++;
    }
  }

  // ── Colores ──
  const colores = new Map<string, { nombre: string; orden: number }>();
  for (const v of p.variantes) {
    const c = claveColor(v.color);
    if (!colores.has(c.clave)) colores.set(c.clave, { nombre: c.nombre, orden: colores.size });
  }
  const claves = [...colores.keys()];
  const col = await cli.query<{ id: number; clave: string; cambiado: boolean }>(
    `INSERT INTO tienda.producto_colores AS pc (producto_id, clave, nombre, hex, orden, activo)
       SELECT $1, x.clave, x.nombre, x.hex, x.orden, true
         FROM unnest($2::text[], $3::text[], $4::text[], $5::int[]) AS x(clave, nombre, hex, orden)
     ON CONFLICT (producto_id, clave) DO UPDATE SET
         nombre = EXCLUDED.nombre, orden = EXCLUDED.orden, activo = true,
         -- el hex lo puede corregir el backoffice: sólo se completa si falta
         hex = COALESCE(pc.hex, EXCLUDED.hex)
       WHERE (pc.nombre, pc.orden, pc.activo, pc.hex) IS DISTINCT FROM (EXCLUDED.nombre, EXCLUDED.orden, true, COALESCE(pc.hex, EXCLUDED.hex))
     RETURNING id, clave, true AS cambiado`,
    [productoId, claves, claves.map((k) => colores.get(k)!.nombre), claves.map((k) => (k === COLOR_UNICO.clave ? null : hexDeColor(colores.get(k)!.nombre))), claves.map((k) => colores.get(k)!.orden)],
  );
  n += col.rowCount ?? 0;
  const off = await cli.query(
    "UPDATE tienda.producto_colores SET activo = false WHERE producto_id = $1 AND activo AND NOT (clave = ANY($2::text[]))",
    [productoId, claves],
  );
  n += off.rowCount ?? 0;
  const idsColor = new Map<string, number>();
  {
    const { rows } = await cli.query<{ id: number; clave: string }>(
      "SELECT id, clave FROM tienda.producto_colores WHERE producto_id = $1", [productoId],
    );
    for (const r of rows) idsColor.set(r.clave, r.id);
  }

  // ── Variantes ──
  // Un SKU que en Stocker pasó a otra variante (se borró y se volvió a crear): la fila vieja se va.
  await cli.query(
    "DELETE FROM tienda.variantes WHERE sku = ANY($1::text[]) AND NOT (stocker_id = ANY($2::int[]))",
    [p.variantes.map((v) => v.sku), p.variantes.map((v) => v.id)],
  );
  const vs = p.variantes.map((v, orden) => ({
    stockerId: v.id,
    sku: v.sku,
    colorId: idsColor.get(claveColor(v.color).clave) ?? null,
    talle: v.talle,
    precio: (v.precio ?? p.precio) as number,
    stock: v.cantidad,
    orden,
  }));
  const vr = await cli.query(
    `INSERT INTO tienda.variantes AS v (producto_id, stocker_id, sku, color_id, talle, precio, stock, stock_en, orden, activo)
       SELECT $1, x.sid, x.sku, x.color, x.talle, x.precio, x.stock, $8::timestamptz, x.orden, true
         FROM unnest($2::int[], $3::text[], $4::int[], $5::text[], $6::int[], $7::int[], $9::int[])
              AS x(sid, sku, color, talle, precio, stock, orden)
     ON CONFLICT (stocker_id) DO UPDATE SET
         producto_id = EXCLUDED.producto_id, sku = EXCLUDED.sku, color_id = EXCLUDED.color_id,
         talle = EXCLUDED.talle, precio = EXCLUDED.precio, orden = EXCLUDED.orden, activo = true,
         stock    = CASE WHEN v.stock_en <= EXCLUDED.stock_en THEN EXCLUDED.stock ELSE v.stock END,
         stock_en = GREATEST(v.stock_en, EXCLUDED.stock_en),
         actualizado_en = now()
       WHERE (v.producto_id, v.sku, v.color_id, v.talle, v.precio, v.orden, v.activo,
              CASE WHEN v.stock_en <= EXCLUDED.stock_en THEN EXCLUDED.stock ELSE v.stock END)
         IS DISTINCT FROM
             (EXCLUDED.producto_id, EXCLUDED.sku, EXCLUDED.color_id, EXCLUDED.talle, EXCLUDED.precio, EXCLUDED.orden, true, v.stock)`,
    [
      productoId,
      vs.map((v) => v.stockerId), vs.map((v) => v.sku), vs.map((v) => v.colorId), vs.map((v) => v.talle),
      vs.map((v) => v.precio), vs.map((v) => v.stock), generado, vs.map((v) => v.orden),
    ],
  );
  n += vr.rowCount ?? 0;
  const vOff = await cli.query(
    "UPDATE tienda.variantes SET activo = false, actualizado_en = now() WHERE producto_id = $1 AND activo AND NOT (stocker_id = ANY($2::int[]))",
    [productoId, vs.map((v) => v.stockerId)],
  );
  n += vOff.rowCount ?? 0;

  return { n, nuevo, slug: actual.slug };
}

export interface ResultadoStock {
  cambios: number;
  afectados: string[];
  /** SKU que Stocker avisó y la tienda no conoce: producto nuevo → hace falta el catálogo. */
  desconocidos: string[];
}

export async function aplicarStock(pool: pg.Pool, s: StockStocker): Promise<ResultadoStock> {
  const skus = Object.keys(s.stock);
  if (!skus.length) return { cambios: 0, afectados: [], desconocidos: [] };
  const conocidos = await pool.query<{ sku: string }>("SELECT sku FROM tienda.variantes WHERE sku = ANY($1::text[])", [skus]);
  const set = new Set(conocidos.rows.map((r) => r.sku));
  const { rows } = await pool.query<{ slug: string }>(
    `WITH cambiadas AS (
       UPDATE tienda.variantes v SET stock = x.stock, stock_en = $3::timestamptz, actualizado_en = now()
         FROM unnest($1::text[], $2::int[]) AS x(sku, stock)
        WHERE v.sku = x.sku AND v.stock_en <= $3::timestamptz AND v.stock IS DISTINCT FROM x.stock
        RETURNING v.producto_id)
     SELECT DISTINCT p.slug FROM cambiadas c JOIN tienda.productos p ON p.id = c.producto_id`,
    [skus, skus.map((k) => s.stock[k]), s.generado],
  );
  // Aunque el número no cambie, queda registrado que a esta hora era ese (para no pisarlo con uno viejo).
  await pool.query(
    "UPDATE tienda.variantes SET stock_en = $2::timestamptz WHERE sku = ANY($1::text[]) AND stock_en < $2::timestamptz",
    [skus, s.generado],
  );
  return { cambios: rows.length, afectados: rows.map((r) => r.slug), desconocidos: skus.filter((k) => !set.has(k)) };
}

/** Deja el renglón de la pasada (para el backoffice y el chequeo de salud). */
export async function registrar<T extends { cambios: number }>(
  pool: pg.Pool, tipo: "catalogo" | "stock", fn: () => Promise<T & { productos?: number; variantes?: number }>,
): Promise<T> {
  const { rows } = await pool.query<{ id: number }>("INSERT INTO tienda.sincronizaciones (tipo) VALUES ($1) RETURNING id", [tipo]);
  const id = rows[0]!.id;
  try {
    const r = await fn();
    await pool.query(
      "UPDATE tienda.sincronizaciones SET fin = now(), productos = $2, variantes = $3, cambios = $4 WHERE id = $1",
      [id, r.productos ?? null, r.variantes ?? null, r.cambios],
    );
    return r;
  } catch (e) {
    await pool.query("UPDATE tienda.sincronizaciones SET fin = now(), error = $2 WHERE id = $1", [id, String((e as Error).message).slice(0, 500)]).catch(() => {});
    throw e;
  }
}
