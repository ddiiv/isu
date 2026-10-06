import type pg from "pg";
import { conRebaja, type Descuentos } from "../../lib/descuentos.js";
import {
  compararTalles, normalizar, STOCK_VISIBLE_MAX, GuiaTalles, guiaPublica,
  type FotoPublica, type GuiaPublica, type ProductoDetalle, type ProductoTarjeta,
} from "@isu/shared";

/*
 * Consultas del catálogo público.
 *
 * Todo lo que se muestra cumple las tres condiciones: visible (lo decide la
 * tienda), en_stocker (sigue en el catálogo de Stocker) y al menos una
 * variante activa. El armado de la tarjeta se hace en cuatro consultas por
 * índice (productos, variantes, colores, fotos) en vez de una gigante: es
 * más fácil de leer y cada una usa su índice.
 */


interface FilaProducto { id: number; slug: string; nombre: string; creado_en: Date; nuevo: boolean }
interface FilaVariante { producto_id: number; color_id: number | null; talle: string | null; precio: number; stock: number }
interface FilaColor { id: number; producto_id: number; clave: string; nombre: string; hex: string | null }
interface FilaFoto { producto_id: number; tipo: "color" | "exhibicion"; color_id: number | null; clave: string; ancho: number | null; alto: number | null; alt: string | null }

const foto = (f: FilaFoto | undefined): FotoPublica | null =>
  f ? { clave: f.clave, ancho: f.ancho, alto: f.alto, alt: f.alt } : null;

export async function tarjetas(pool: pg.Pool, productos: FilaProducto[], mostrarAgotados: boolean, desc: Descuentos): Promise<ProductoTarjeta[]> {
  if (!productos.length) return [];
  const ids = productos.map((p) => p.id);
  const [vs, cs, fs, extra] = await Promise.all([
    pool.query<FilaVariante>(
      "SELECT producto_id, color_id, talle, precio, stock FROM tienda.variantes WHERE producto_id = ANY($1::int[]) AND activo ORDER BY orden",
      [ids],
    ),
    pool.query<FilaColor>(
      "SELECT id, producto_id, clave, nombre, hex FROM tienda.producto_colores WHERE producto_id = ANY($1::int[]) AND activo ORDER BY orden, id",
      [ids],
    ),
    pool.query<FilaFoto>(
      `SELECT producto_id, tipo, color_id, clave, ancho, alto, alt FROM tienda.fotos
        WHERE producto_id = ANY($1::int[]) ORDER BY (tipo = 'exhibicion') DESC, orden, id`,
      [ids],
    ),
    // Etapa 8: si se vende en pack y el resumen de sus reseñas.
    pool.query<{ id: number; pack: boolean; resenas_cantidad: number; resenas_promedio: string | null }>(
      "SELECT id, pack, resenas_cantidad, resenas_promedio FROM tienda.productos WHERE id = ANY($1::int[])", [ids],
    ),
  ]);
  const E = new Map(extra.rows.map((r) => [r.id, r]));
  const agrupar = <T extends { producto_id: number }>(filas: T[]) => {
    const m = new Map<number, T[]>();
    for (const f of filas) m.set(f.producto_id, [...(m.get(f.producto_id) ?? []), f]);
    return m;
  };
  const V = agrupar(vs.rows), C = agrupar(cs.rows), F = agrupar(fs.rows);
  const rebajas = await desc.para(ids);

  const salida: ProductoTarjeta[] = [];
  for (const p of productos) {
    const variantes = V.get(p.id) ?? [];
    if (!variantes.length) continue;
    const conStock = variantes.filter((v) => v.stock > 0);
    const agotado = conStock.length === 0;
    if (agotado && !mostrarAgotados) continue;
    const pct = rebajas.get(p.id) ?? 0;
    const precios = (agotado ? variantes : conStock).map((v) => conRebaja(v.precio, pct));
    const preciosLista = (agotado ? variantes : conStock).map((v) => v.precio);
    const fotos = F.get(p.id) ?? [];
    const usados = new Set(variantes.map((v) => v.color_id));
    const colores = (C.get(p.id) ?? []).filter((c) => usados.has(c.id)).map((c) => ({
      clave: c.clave,
      nombre: c.nombre,
      hex: c.hex,
      foto: foto(fotos.find((f) => f.tipo === "color" && f.color_id === c.id)),
      hay: conStock.some((v) => v.color_id === c.id),
    }));
    // Principal: la primera de exhibición; si no hay, la de color del primer color con stock.
    const primerColor = colores.find((c) => c.hay) ?? colores[0];
    const idPrimer = (C.get(p.id) ?? []).find((c) => c.clave === primerColor?.clave)?.id;
    const ordenadas = [
      ...fotos.filter((f) => f.tipo === "exhibicion"),
      ...fotos.filter((f) => f.tipo === "color" && f.color_id === idPrimer),
      ...fotos.filter((f) => f.tipo === "color" && f.color_id !== idPrimer),
    ];
    salida.push({
      id: p.id,
      slug: p.slug,
      nombre: p.nombre,
      precio: Math.min(...precios),
      precioHasta: Math.max(...precios),
      precioLista: pct ? Math.min(...preciosLista) : null,
      descuento: pct || null,
      foto: foto(ordenadas[0]),
      fotoHover: foto(ordenadas[1]),
      colores,
      talles: [...new Set(conStock.map((v) => v.talle).filter((t): t is string => !!t))].sort(compararTalles),
      agotado,
      // "Nuevo" lo marca el backoffice con una casilla.
      nuevo: p.nuevo,
      creadoEn: p.creado_en.toISOString(),
      pack: E.get(p.id)?.pack ?? false,
      resenas: resumen(E.get(p.id)),
    });
  }
  // Lo que hay primero; dentro de cada grupo, lo más nuevo primero (el orden de la consulta).
  return salida.sort((a, b) => Number(a.agotado) - Number(b.agotado));
}

const PUBLICABLE = "p.visible AND p.en_stocker";

/** numeric de Postgres llega como texto: "4.67" → 4.7 (una decimal alcanza). */
export const resumen = (r: { resenas_cantidad: number; resenas_promedio: string | null } | undefined) => ({
  cantidad: r?.resenas_cantidad ?? 0,
  promedio: r?.resenas_promedio && r.resenas_cantidad ? Math.round(Number(r.resenas_promedio) * 10) / 10 : null,
});

export async function productosDeCategoria(pool: pg.Pool, categoriaId: number, limite = 1000, soloConStock = false): Promise<FilaProducto[]> {
  // La categoría y sus hijas: /mujer muestra todo lo de Mujer.
  const { rows } = await pool.query<FilaProducto>(
    `SELECT DISTINCT p.id, p.slug, p.nombre, p.creado_en, p.nuevo
       FROM tienda.productos p
       JOIN tienda.producto_categorias pc ON pc.producto_id = p.id
       JOIN tienda.categorias c ON c.id = pc.categoria_id AND c.visible
      WHERE ${PUBLICABLE} AND (c.id = $1 OR c.padre_id = $1)
        AND (NOT $3 OR EXISTS (SELECT 1 FROM tienda.variantes v WHERE v.producto_id = p.id AND v.activo AND v.stock > 0))
      ORDER BY p.creado_en DESC, p.id DESC
      LIMIT $2`,
    [categoriaId, Math.min(limite, 1000), soloConStock],
  );
  return rows;
}

/*
 * Colecciones elegidas a mano en el backoffice. "Nuevos": lo marcado como
 * nuevo, lo último marcado primero. "Destacados": por el orden que le dieron.
 */
export async function coleccion(pool: pg.Pool, cual: "nuevos" | "destacados" | "packs", limite: number): Promise<FilaProducto[]> {
  const { rows } = await pool.query<FilaProducto>(
    cual === "packs"
      ? `SELECT p.id, p.slug, p.nombre, p.creado_en, p.nuevo FROM tienda.productos p
          WHERE p.pack AND p.visible AND p.en_stocker ORDER BY p.pack_orden, p.id DESC LIMIT $1`
      : cual === "nuevos"
      ? `SELECT p.id, p.slug, p.nombre, p.creado_en, p.nuevo FROM tienda.productos p
          WHERE p.nuevo AND p.visible AND p.en_stocker ORDER BY p.nuevo_desde DESC NULLS LAST, p.id DESC LIMIT $1`
      : `SELECT p.id, p.slug, p.nombre, p.creado_en, p.nuevo FROM tienda.productos p
          WHERE p.destacado AND p.visible AND p.en_stocker ORDER BY p.destacado_orden, p.id DESC LIMIT $1`,
    [limite],
  );
  return rows;
}

export async function productosNuevos(pool: pg.Pool, limite: number): Promise<FilaProducto[]> {
  const { rows } = await pool.query<FilaProducto>(
    `SELECT p.id, p.slug, p.nombre, p.creado_en, p.nuevo FROM tienda.productos p
      WHERE ${PUBLICABLE} AND EXISTS (SELECT 1 FROM tienda.variantes v WHERE v.producto_id = p.id AND v.activo AND v.stock > 0)
      ORDER BY p.creado_en DESC, p.id DESC LIMIT $1`,
    [limite],
  );
  return rows;
}

/*
 * Búsqueda: cada palabra como prefijo ("rem neg" encuentra "Remera negra"),
 * sin tildes. El texto del usuario NUNCA se arma dentro del SQL: se reduce a
 * [a-z0-9] y va como parámetro. También busca por SKU padre exacto (lo que
 * dice la etiqueta del local).
 */
export function consultaDeBusqueda(q: string): string | null {
  const palabras = normalizar(q).split(/[^a-z0-9]+/).filter((p) => p.length >= 1).slice(0, 8);
  if (!palabras.length) return null;
  return palabras.map((p) => `${p}:*`).join(" & ");
}

export async function buscar(pool: pg.Pool, q: string, limite: number): Promise<FilaProducto[]> {
  const ts = consultaDeBusqueda(q);
  if (!ts) return [];
  const { rows } = await pool.query<FilaProducto>(
    `SELECT p.id, p.slug, p.nombre, p.creado_en, p.nuevo FROM tienda.productos p
      WHERE ${PUBLICABLE} AND (p.busqueda @@ to_tsquery('simple', $1) OR upper(p.stocker_padre) = upper($2))
      ORDER BY (upper(p.stocker_padre) = upper($2)) DESC, ts_rank(p.busqueda, to_tsquery('simple', $1)) DESC, p.creado_en DESC
      LIMIT $3`,
    [ts, q.trim().slice(0, 60), limite],
  );
  return rows;
}

export async function detalle(pool: pg.Pool, slug: string, desc: Descuentos): Promise<ProductoDetalle | null> {
  const { rows } = await pool.query<{
    id: number; slug: string; nombre: string; descripcion: string | null; seo_titulo: string | null; seo_descripcion: string | null;
    stocker_padre: string; categoria_id: number | null; actualizado_en: Date;
    guia: Record<string, unknown> | null; guia_en: Date | null;
    pack: boolean; composicion: string | null; resenas_cantidad: number; resenas_promedio: string | null;
  }>(
    `SELECT p.id, p.slug, p.nombre, COALESCE(p.descripcion, p.stocker_descripcion) AS descripcion, p.seo_titulo, p.seo_descripcion,
            p.stocker_padre, p.categoria_id, p.actualizado_en, p.pack, p.composicion, p.resenas_cantidad, p.resenas_promedio,
            CASE WHEN g.id IS NULL THEN NULL ELSE jsonb_build_object('nombre', g.nombre, 'tipo', g.tipo, 'medidas', g.medidas, 'filas', g.filas, 'nota', g.nota) END AS guia,
            g.actualizado_en AS guia_en
       FROM tienda.productos p LEFT JOIN tienda.guias_talles g ON g.id = p.guia_talles_id
      WHERE p.slug = $1 AND ${PUBLICABLE}`,
    [slug],
  );
  const p = rows[0];
  if (!p) return null;

  const [vs, cs, fs, migas] = await Promise.all([
    pool.query<{ sku: string; color_id: number | null; talle: string | null; precio: number; stock: number; actualizado_en: Date }>(
      "SELECT sku, color_id, talle, precio, stock, actualizado_en FROM tienda.variantes WHERE producto_id = $1 AND activo ORDER BY orden, id",
      [p.id],
    ),
    pool.query<FilaColor>("SELECT id, producto_id, clave, nombre, hex FROM tienda.producto_colores WHERE producto_id = $1 AND activo ORDER BY orden, id", [p.id]),
    pool.query<FilaFoto>("SELECT producto_id, tipo, color_id, clave, ancho, alto, alt FROM tienda.fotos WHERE producto_id = $1 ORDER BY orden, id", [p.id]),
    pool.query<{ nombre: string; slug: string; padre_nombre: string | null; padre_slug: string | null }>(
      `SELECT c.nombre, c.slug, pa.nombre AS padre_nombre, pa.slug AS padre_slug
         FROM tienda.categorias c LEFT JOIN tienda.categorias pa ON pa.id = c.padre_id
        WHERE c.id = $1 AND c.visible AND (pa.id IS NULL OR pa.visible)`,
      [p.categoria_id],
    ),
  ]);
  if (!vs.rows.length) return null;

  const colorPorId = new Map(cs.rows.map((c) => [c.id, c]));
  const usados = new Set(vs.rows.map((v) => v.color_id));
  const colores = cs.rows.filter((c) => usados.has(c.id)).map((c) => ({
    clave: c.clave, nombre: c.nombre, hex: c.hex,
    fotos: fs.rows.filter((f) => f.tipo === "color" && f.color_id === c.id).map((f) => foto(f)!),
  }));
  const conStock = vs.rows.filter((v) => v.stock > 0);
  const pct = (await desc.para([p.id])).get(p.id) ?? 0;
  const base = conStock.length ? conStock : vs.rows;
  const precios = base.map((v) => conRebaja(v.precio, pct));
  const m = migas.rows[0];
  const ultimo = Math.max(p.actualizado_en.getTime(), p.guia_en?.getTime() ?? 0, ...vs.rows.map((v) => v.actualizado_en.getTime()));

  return {
    id: p.id,
    slug: p.slug,
    nombre: p.nombre,
    descripcion: p.descripcion,
    seoTitulo: p.seo_titulo,
    seoDescripcion: p.seo_descripcion,
    sku: p.stocker_padre,
    migas: !m ? [] : m.padre_slug
      ? [{ nombre: m.padre_nombre!, ruta: `/${m.padre_slug}` }, { nombre: m.nombre, ruta: `/${m.padre_slug}/${m.slug}` }]
      : [{ nombre: m.nombre, ruta: `/${m.slug}` }],
    colores,
    exhibicion: fs.rows.filter((f) => f.tipo === "exhibicion").map((f) => ({ ...foto(f)!, color: f.color_id ? colorPorId.get(f.color_id)?.clave ?? null : null })),
    variantes: vs.rows.map((v) => ({
      sku: v.sku,
      color: v.color_id ? colorPorId.get(v.color_id)?.clave ?? null : null,
      talle: v.talle,
      precio: conRebaja(v.precio, pct),
      precioLista: pct ? v.precio : null,
      // El número exacto no viaja: con saber si hay (y si quedan pocas) alcanza.
      stock: Math.min(v.stock, STOCK_VISIBLE_MAX),
    })),
    precio: Math.min(...precios),
    precioHasta: Math.max(...precios),
    precioLista: pct ? Math.min(...base.map((v) => v.precio)) : null,
    descuento: pct || null,
    agotado: conStock.length === 0,
    guiaTalles: guiaDe(p.guia),
    actualizadoEn: new Date(ultimo).toISOString(),
    pack: p.pack,
    composicion: p.composicion,
    resenas: resumen(p),
  };
}

/** La guía guardada, validada otra vez: si algo quedó mal en la base, mejor sin guía que una guía rota. */
export function guiaDe(g: Record<string, unknown> | null): GuiaPublica | null {
  if (!g) return null;
  const r = GuiaTalles.safeParse(g);
  return r.success ? guiaPublica(r.data) : null;
}

export async function slugsPublicables(pool: pg.Pool) {
  // Con hasta 5 fotos (la principal primero): el sitemap las declara y Google Imágenes las encuentra antes.
  const { rows } = await pool.query<{ slug: string; nombre: string; actualizado_en: Date; fotos: string[] }>(
    `SELECT p.slug, p.nombre, GREATEST(p.actualizado_en, max(v.actualizado_en)) AS actualizado_en,
            COALESCE((SELECT array_agg(f.clave ORDER BY (f.tipo = 'exhibicion') DESC, f.orden, f.id)
                        FROM (SELECT * FROM tienda.fotos f WHERE f.producto_id = p.id ORDER BY (f.tipo = 'exhibicion') DESC, f.orden, f.id LIMIT 5) f), '{}') AS fotos
       FROM tienda.productos p JOIN tienda.variantes v ON v.producto_id = p.id AND v.activo
      WHERE ${PUBLICABLE} GROUP BY p.id ORDER BY p.id LIMIT 45000`,
  );
  return rows.map((r) => ({ slug: r.slug, nombre: r.nombre, actualizadoEn: r.actualizado_en.toISOString(), fotos: r.fotos }));
}

export async function leerAjuste<T>(pool: pg.Pool, clave: string, porDefecto: T): Promise<T> {
  const { rows } = await pool.query<{ valor: T }>("SELECT valor FROM tienda.ajustes WHERE clave = $1", [clave]);
  return rows[0]?.valor ?? porDefecto;
}
