import { z } from "zod";
import { slug } from "./esquemas.js";
import { GuiaPublica } from "./guias.js";
import { STOCK_VISIBLE_MAX } from "./constantes.js";

/*
 * Lo que la API devuelve del catálogo. Precios en centavos. El stock
 * viaja con tope (ver STOCK_VISIBLE_MAX en constantes.ts).
 */

export const FotoPublica = z.object({
  clave: z.string(),
  ancho: z.number().int().nullable(),
  alto: z.number().int().nullable(),
  alt: z.string().nullable(),
});
export type FotoPublica = z.infer<typeof FotoPublica>;

/** Resumen de las reseñas publicadas (promedio null = todavía sin reseñas). */
export const ResumenResenas = z.object({
  promedio: z.number().min(1).max(5).nullable(),
  cantidad: z.number().int().min(0),
});
export type ResumenResenas = z.infer<typeof ResumenResenas>;

export const ColorTarjeta = z.object({
  clave: slug,
  nombre: z.string(),
  hex: z.string().nullable(),
  foto: FotoPublica.nullable(),
  hay: z.boolean(),
});

export const ProductoTarjeta = z.object({
  id: z.number().int(),
  slug,
  nombre: z.string(),
  precio: z.number().int(),          // el más bajo entre las variantes (con stock, si hay)
  precioHasta: z.number().int(),     // el más alto: si difieren se muestra "desde"
  precioLista: z.number().int().nullable(), // antes del descuento (null = sin descuento)
  descuento: z.number().int().nullable(),   // % de descuento masivo
  foto: FotoPublica.nullable(),
  fotoHover: FotoPublica.nullable(),
  colores: z.array(ColorTarjeta),
  talles: z.array(z.string()),       // con stock
  agotado: z.boolean(),
  nuevo: z.boolean(),
  creadoEn: z.string(),
  /** Se vende en pack (etapa 8). */
  pack: z.boolean().default(false),
  /** Está en Liquidación: le toca un descuento marcado como liquidación (etapa 9). */
  liquidacion: z.boolean().default(false),
  resenas: ResumenResenas.default({ promedio: null, cantidad: 0 }),
});
export type ProductoTarjeta = z.infer<typeof ProductoTarjeta>;

export const VariantePublica = z.object({
  sku: z.string(),
  color: slug.nullable(),
  talle: z.string().nullable(),
  precio: z.number().int(),
  precioLista: z.number().int().nullable(),
  stock: z.number().int().min(0).max(STOCK_VISIBLE_MAX),
});
export type VariantePublica = z.infer<typeof VariantePublica>;

export const ColorDetalle = z.object({
  clave: slug,
  nombre: z.string(),
  hex: z.string().nullable(),
  fotos: z.array(FotoPublica),
});

export const ProductoDetalle = z.object({
  id: z.number().int(),
  slug,
  nombre: z.string(),
  descripcion: z.string().nullable(),
  seoTitulo: z.string().nullable(),
  seoDescripcion: z.string().nullable(),
  sku: z.string(),
  migas: z.array(z.object({ nombre: z.string(), ruta: z.string() })),
  colores: z.array(ColorDetalle),
  exhibicion: z.array(FotoPublica.extend({ color: slug.nullable() })),
  variantes: z.array(VariantePublica),
  precio: z.number().int(),
  precioHasta: z.number().int(),
  precioLista: z.number().int().nullable(),
  descuento: z.number().int().nullable(),
  agotado: z.boolean(),
  guiaTalles: GuiaPublica.nullable(),
  actualizadoEn: z.string(),
  /** Etapa 8: se vende en pack, de qué está hecha y qué dicen quienes la compraron. */
  pack: z.boolean().default(false),
  liquidacion: z.boolean().default(false),
  composicion: z.string().nullable().default(null),
  resenas: ResumenResenas.default({ promedio: null, cantidad: 0 }),
  /** El video vertical publicado (v/….mp4), si hay. */
  video: z.string().regex(/^v\/[a-f0-9]{12}\/[a-f0-9]{16}\.mp4$/).nullable().default(null),
});
export type ProductoDetalle = z.infer<typeof ProductoDetalle>;

export const ListadoProductos = z.object({
  productos: z.array(ProductoTarjeta),
  total: z.number().int(),
});
export type ListadoProductos = z.infer<typeof ListadoProductos>;
