import type pg from "pg";
import {
  conVariables, formatearPesos, leerPacks, maxPorcentajePack, type BannerPublico, type BotonBanner, type ProductoAuto, type ProductoBanner, type VariablesBanner,
} from "@isu/shared";
import type { Descuentos } from "../../lib/descuentos.js";
import { coleccion, tarjetas } from "../productos/consultas.js";

/*
 * Los banners del inicio como los ve la tienda (etapa 12):
 *
 *   · las variables de los textos ({descuento}, {envioGratis}…) con los valores
 *     de Ajustes; un banner que usa una que hoy no tiene valor no sale;
 *   · el producto: el elegido o el automático (el más nuevo, un pack, uno en
 *     liquidación, uno destacado), con stock, foto y el precio de la grilla;
 *     si no hay y el banner lo pide, no sale;
 *   · el link del banner entero sólo cuando no tiene botones ni producto
 *     (no se anidan links).
 */
export interface FilaBanner {
  id: number; alt: string; enlace: string | null; foto: string | null; foto_ancho: number | null; foto_alto: number | null;
  foto_movil: string | null; movil_ancho: number | null; movil_alto: number | null;
  titulo: string | null; texto: string | null; etiqueta: string | null; botones: BotonBanner[];
  fondo: BannerPublico["fondo"]; alineacion: BannerPublico["alineacion"];
  producto_id: number | null; producto_auto: ProductoAuto | null; ocultar_sin_producto: boolean;
}

export async function variablesDeBanners(pool: pg.Pool): Promise<VariablesBanner> {
  const { rows } = await pool.query<{ clave: string; valor: unknown }>(
    "SELECT clave, valor FROM tienda.ajustes WHERE clave = ANY($1::text[])", [["descuentoTransferencia", "cuotasSinInteres", "envioGratisDesde", "packs"]]);
  const a = Object.fromEntries(rows.map((r) => [r.clave, r.valor])) as Record<string, unknown>;
  const packs = leerPacks(a.packs);
  return {
    descuento: typeof a.descuentoTransferencia === "number" && a.descuentoTransferencia > 0 ? String(a.descuentoTransferencia) : undefined,
    cuotas: typeof a.cuotasSinInteres === "number" && a.cuotasSinInteres > 1 ? String(a.cuotasSinInteres) : undefined,
    envioGratis: typeof a.envioGratisDesde === "number" && a.envioGratisDesde > 0 ? formatearPesos(a.envioGratisDesde) : undefined,
    packsHasta: maxPorcentajePack(packs) > 0 ? String(maxPorcentajePack(packs)) : undefined,
    packsMinimo: String(packs.minimo),
    packsMaximo: String(packs.maximo),
  };
}

const COLECCION: Record<ProductoAuto, "nuevos" | "destacados" | "packs" | "liquidacion"> = { nuevo: "nuevos", pack: "packs", liquidacion: "liquidacion", destacado: "destacados" };

/** El producto del banner: con stock y con foto, al precio de la grilla. */
export async function productoDeBanner(pool: pg.Pool, desc: Descuentos, b: { producto_id: number | null; producto_auto: ProductoAuto | null }): Promise<ProductoBanner | null> {
  let filas;
  if (b.producto_id) {
    filas = (await pool.query("SELECT p.id, p.slug, p.nombre, p.creado_en, p.nuevo FROM tienda.productos p WHERE p.id = $1 AND p.visible AND p.en_stocker", [b.producto_id])).rows;
  } else if (b.producto_auto) {
    filas = await coleccion(pool, COLECCION[b.producto_auto], 12);
  } else return null;
  const t = (await tarjetas(pool, filas, false, desc)).find((x) => !x.agotado && x.foto);
  return t ? { slug: t.slug, nombre: t.nombre, precio: t.precio, precioLista: t.precioLista, foto: t.foto } : null;
}

/**
 * Un banner como lo ve la tienda, o por qué no sale (para la vista previa del
 * backoffice: «Usa {envioGratis} y no hay envío gratis», «No hay ningún producto en liquidación»).
 */
export async function armarBanner(pool: pg.Pool, desc: Descuentos, b: FilaBanner, vars: VariablesBanner): Promise<{ banner: BannerPublico | null; motivo: string | null }> {
  if (!b.foto && !b.titulo) return { banner: null, motivo: "Le falta la foto o un título." };
  // Cada texto con sus variables; si alguno usa una sin valor (undefined), el banner no sale.
  const textos = [b.alt, b.titulo, b.texto, b.etiqueta, ...b.botones.map((x) => x.texto)].map((t) => conVariables(t, vars));
  if (textos.some((t) => t === undefined)) {
    const usadas = [b.alt, b.titulo, b.texto, b.etiqueta, ...b.botones.map((x) => x.texto)].join(" ").match(/\{(\w+)\}/g) ?? [];
    const faltan = [...new Set(usadas)].filter((v) => !vars[v.slice(1, -1) as keyof VariablesBanner]);
    return { banner: null, motivo: `Usa ${faltan.join(", ")} y hoy no tiene valor en Ajustes.` };
  }
  const [alt, titulo, texto, etiqueta, ...botones] = textos as Array<string | null>;
  const producto = await productoDeBanner(pool, desc, b);
  if (!producto && b.ocultar_sin_producto && (b.producto_id || b.producto_auto)) return { banner: null, motivo: "No hay ningún producto con stock para mostrar." };
  return {
    motivo: null,
    banner: {
      id: b.id, alt: alt ?? "", foto: b.foto ? { clave: b.foto, ancho: b.foto_ancho, alto: b.foto_alto } : null,
      fotoMovil: b.foto_movil ? { clave: b.foto_movil, ancho: b.movil_ancho, alto: b.movil_alto } : null,
      titulo: titulo ?? null, texto: texto ?? null, etiqueta: etiqueta ?? null,
      botones: b.botones.map((x, i) => ({ ...x, texto: botones[i]! })),
      fondo: b.fondo, alineacion: b.alineacion, producto,
      // El banner entero lleva a un lado sólo si no tiene botones ni producto (no se anidan links).
      enlace: b.botones.length || producto ? null : b.enlace,
    },
  };
}

export const COLUMNAS_BANNER = `id, alt, enlace, foto, foto_ancho, foto_alto, foto_movil, movil_ancho, movil_alto,
  titulo, texto, etiqueta, botones, fondo, alineacion, producto_id, producto_auto, ocultar_sin_producto`;

export async function bannersPublicos(pool: pg.Pool, desc: Descuentos): Promise<BannerPublico[]> {
  const { rows } = await pool.query<FilaBanner>(
    `SELECT ${COLUMNAS_BANNER} FROM tienda.banners
      WHERE activo AND (foto IS NOT NULL OR titulo IS NOT NULL) AND (desde IS NULL OR desde <= now()) AND (hasta IS NULL OR hasta > now())
      ORDER BY orden, id LIMIT 30`,
  );
  const vars = await variablesDeBanners(pool);
  const salida: BannerPublico[] = [];
  for (const b of rows) {
    const { banner } = await armarBanner(pool, desc, b, vars);
    if (banner) salida.push(banner);
    if (salida.length >= 8) break;
  }
  return salida;
}
