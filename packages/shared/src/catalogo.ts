import { z } from "zod";
import { slug } from "./esquemas.js";
import { GuiaPublica } from "./talles.js";

/*
 * Lo que la API devuelve del catálogo. Precios en centavos.
 *
 * El stock nunca viaja exacto: arriba de STOCK_VISIBLE_MAX se informa ese
 * tope. Al cliente le alcanza con "hay" / "¡últimas!", y no se le regala a
 * la competencia el inventario exacto de cada prenda.
 */
export const STOCK_VISIBLE_MAX = 10;

export const FotoPublica = z.object({
  clave: z.string(),
  ancho: z.number().int().nullable(),
  alto: z.number().int().nullable(),
  alt: z.string().nullable(),
});
export type FotoPublica = z.infer<typeof FotoPublica>;

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
});
export type ProductoDetalle = z.infer<typeof ProductoDetalle>;

export const ListadoProductos = z.object({
  productos: z.array(ProductoTarjeta),
  total: z.number().int(),
});
export type ListadoProductos = z.infer<typeof ListadoProductos>;

/** Orden de talles para mostrar: numéricos por valor, letras por la escala de siempre, el resto al final. */
const ESCALA = ["xxs", "xs", "s", "m", "l", "xl", "xxl", "2xl", "xxxl", "3xl", "4xl", "5xl", "6xl"];
export function ordenTalle(t: string): number {
  const n = t.trim().toLowerCase();
  const i = ESCALA.indexOf(n);
  if (i >= 0) return 1000 + i;
  const num = Number(n.replace(",", "."));
  if (Number.isFinite(num)) return num;
  if (n === "unico" || n === "único" || n === "u") return 2000;
  return 3000;
}
export const compararTalles = (a: string, b: string) => ordenTalle(a) - ordenTalle(b) || a.localeCompare(b, "es");
