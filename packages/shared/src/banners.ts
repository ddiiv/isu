import { z } from "zod";

/*
 * Banners del carrusel del inicio (etapa 8; interactivos desde la etapa 12).
 *
 * Un banner puede ser:
 *   · una foto (para compu y, si se carga, otra para celular), con o sin link;
 *   · un banner de texto sobre un fondo de color, sin foto;
 *   · las dos cosas: el texto encima de la foto.
 * Además: una etiqueta («Hasta 25% OFF»), hasta 2 botones con link a una
 * página de la tienda, y un producto destacado (uno elegido o uno automático)
 * que se ve como una tarjeta con su foto y su precio.
 *
 * Los textos admiten variables que salen de Ajustes ({descuento}, {cuotas}…):
 * si cambia el % de la transferencia, el banner cambia solo.
 */
export const FONDOS_BANNER = ["marca", "tinta", "ahorro", "oferta", "crema", "rosa", "arena"] as const;
export type FondoBanner = (typeof FONDOS_BANNER)[number];
export const NOMBRE_FONDO: Record<FondoBanner, string> = {
  marca: "Azul", tinta: "Negro", ahorro: "Verde", oferta: "Rojo", crema: "Crema", rosa: "Rosa", arena: "Arena",
};
/** Fondos oscuros: el texto va en blanco. */
export const FONDO_OSCURO: Record<FondoBanner, boolean> = {
  marca: true, tinta: true, ahorro: true, oferta: true, crema: false, rosa: false, arena: false,
};
export const ALINEACIONES_BANNER = ["izquierda", "centro"] as const;
export const PRODUCTO_AUTO = ["nuevo", "pack", "liquidacion", "destacado"] as const;
export type ProductoAuto = (typeof PRODUCTO_AUTO)[number];
export const NOMBRE_PRODUCTO_AUTO: Record<ProductoAuto, string> = {
  nuevo: "El más nuevo", pack: "Uno que se vende en pack", liquidacion: "Uno en liquidación", destacado: "Uno destacado",
};

/** Una dirección de esta tienda (/mujer, /producto/remera…): nunca otro sitio. */
export const RutaTienda = z.string().trim().max(300)
  .regex(/^\/([^/\\\s]|$)[^\s\\]*$/, "Una dirección de esta tienda, que empiece con / (por ejemplo /mujer o /packs)");

export const BotonBanner = z.object({
  texto: z.string().trim().min(1, "El botón necesita un texto").max(30),
  enlace: RutaTienda,
  estilo: z.enum(["lleno", "borde"]).default("lleno"),
}).strict();
export type BotonBanner = z.infer<typeof BotonBanner>;

/* ── Variables de los textos ── */
export const VARIABLES_BANNER = {
  descuento: "el % OFF por transferencia",
  cuotas: "las cuotas sin interés",
  envioGratis: "desde cuánto el envío es gratis ($ 80.000)",
  packsHasta: "el % OFF más alto de los packs",
  packsMinimo: "el mínimo de prendas de un pack",
  packsMaximo: "el máximo de prendas de un pack",
} as const;
export type VariablesBanner = Partial<Record<keyof typeof VARIABLES_BANNER, string>>;

/**
 * "{descuento}% OFF" → "20% OFF". Si usa una variable que hoy no tiene valor
 * (por ejemplo, no hay envío gratis), devuelve null: ese banner no se muestra.
 * Una variable desconocida queda tal cual (se ve el error en la vista previa).
 */
export function conVariables(texto: string | null, vars: VariablesBanner): string | null | undefined {
  if (texto === null) return null;
  let falta = false;
  const r = texto.replace(/\{(\w+)\}/g, (m, k: string) => {
    if (!(k in VARIABLES_BANNER)) return m;
    const v = vars[k as keyof VariablesBanner];
    if (v === undefined || v === "") { falta = true; return m; }
    return v;
  });
  return falta ? undefined : r;
}

const FotoBanner = z.object({ clave: z.string(), ancho: z.number().int().nullable(), alto: z.number().int().nullable() });

/** El producto que se muestra dentro del banner (tarjeta con foto, precio y «Ver producto»). */
export const ProductoBanner = z.object({
  slug: z.string(),
  nombre: z.string(),
  precio: z.number().int(),
  precioLista: z.number().int().nullable(),
  foto: z.object({ clave: z.string(), ancho: z.number().int().nullable(), alto: z.number().int().nullable(), alt: z.string().nullable() }).nullable(),
});
export type ProductoBanner = z.infer<typeof ProductoBanner>;

/** Banner del carrusel del inicio, como lo recibe la tienda (variables ya reemplazadas). */
export const BannerPublico = z.object({
  id: z.number().int(),
  alt: z.string(),
  /** a dónde lleva el banner entero (sólo si no tiene botones ni producto) */
  enlace: z.string().nullable(),
  foto: FotoBanner.nullable(),
  fotoMovil: FotoBanner.nullable(),
  titulo: z.string().nullable().default(null),
  texto: z.string().nullable().default(null),
  etiqueta: z.string().nullable().default(null),
  botones: z.array(BotonBanner).default([]),
  fondo: z.enum(FONDOS_BANNER).default("marca"),
  alineacion: z.enum(ALINEACIONES_BANNER).default("izquierda"),
  producto: ProductoBanner.nullable().default(null),
});
export type BannerPublico = z.infer<typeof BannerPublico>;

/**
 * Banners sugeridos, armados con lo que dice la tienda (los mismos que carga
 * la migración 0019). Desde Portada se pueden volver a agregar si se borraron.
 */
export interface BannerSugerido {
  sugerido: string; alt: string; titulo: string; texto: string; etiqueta: string | null; botones: BotonBanner[];
  fondo: FondoBanner; alineacion: (typeof ALINEACIONES_BANNER)[number]; productoAuto: ProductoAuto | null; ocultarSinProducto: boolean;
}
export const BANNERS_SUGERIDOS: BannerSugerido[] = [
  { sugerido: "nuevos", alt: "Lo nuevo de Isuwaya", titulo: "Lo último que salió del taller",
    texto: "Diseñamos y fabricamos nuestra ropa, con talles reales. Prenditas para todos tus días.", etiqueta: "Nuevos ingresos",
    botones: [{ texto: "Ver lo nuevo", enlace: "/nuevos", estilo: "lleno" }, { texto: "Comprar Mujer", enlace: "/mujer", estilo: "borde" }],
    fondo: "crema", alineacion: "izquierda", productoAuto: "nuevo", ocultarSinProducto: false },
  { sugerido: "packs", alt: "Packs: llevá más, pagá menos", titulo: "Llevá más, pagá menos",
    texto: "Armá tu pack de {packsMinimo} a {packsMaximo} prendas, cada una con su talle y su color.", etiqueta: "Hasta {packsHasta}% OFF",
    botones: [{ texto: "Armar mi pack", enlace: "/packs", estilo: "lleno" }],
    fondo: "ahorro", alineacion: "izquierda", productoAuto: "pack", ocultarSinProducto: true },
  { sugerido: "transferencia", alt: "{descuento}% OFF pagando con transferencia", titulo: "{descuento}% OFF pagando con transferencia",
    texto: "O hasta {cuotas} cuotas sin interés con tarjeta. Envíos a todo el país.", etiqueta: "Pagá menos",
    botones: [{ texto: "Comprar Mujer", enlace: "/mujer", estilo: "lleno" }, { texto: "Comprar Hombre", enlace: "/hombre", estilo: "borde" }],
    fondo: "marca", alineacion: "izquierda", productoAuto: "destacado", ocultarSinProducto: false },
  { sugerido: "liquidacion", alt: "Liquidación de fin de temporada", titulo: "Liquidación",
    texto: "Prendas de la temporada pasada a precio más bajo. Hasta agotar stock.", etiqueta: "Fin de temporada",
    botones: [{ texto: "Ver liquidación", enlace: "/liquidacion", estilo: "lleno" }],
    fondo: "oferta", alineacion: "izquierda", productoAuto: "liquidacion", ocultarSinProducto: true },
  { sugerido: "envio", alt: "Envío gratis desde {envioGratis}", titulo: "Envío gratis desde {envioGratis}",
    texto: "A todo el país. En CABA y GBA te llega hoy o mañana.", etiqueta: null,
    botones: [{ texto: "Ver novedades", enlace: "/nuevos", estilo: "lleno" }],
    fondo: "tinta", alineacion: "centro", productoAuto: null, ocultarSinProducto: false },
  { sugerido: "outfit", alt: "Armá tu outfit en un minuto", titulo: "Armá tu outfit en un minuto",
    texto: "Cuatro preguntas y te mostramos combinaciones con lo que hay en tu talle y entra en tu presupuesto.", etiqueta: "Nuevo",
    botones: [{ texto: "Armar mi outfit", enlace: "/outfits", estilo: "lleno" }],
    fondo: "arena", alineacion: "izquierda", productoAuto: null, ocultarSinProducto: false },
  { sugerido: "locales", alt: "Vení a probártela a nuestros locales", titulo: "Vení a probártela",
    texto: "Retirá gratis tus compras online en nuestros locales.", etiqueta: null,
    botones: [{ texto: "Ver locales", enlace: "/locales", estilo: "lleno" }],
    fondo: "rosa", alineacion: "centro", productoAuto: null, ocultarSinProducto: false },
];
