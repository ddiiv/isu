import { z } from "zod";
import { slug } from "./esquemas.js";
import { FotoPublica, ResumenResenas } from "./catalogo.js";

/*
 * Reseñas. Sólo de compras entregadas (ver la migración 0013): una por
 * prenda y una general sobre la compra. Lo que se publica pasa por el
 * backoffice, salvo que esté prendido "publicar solas".
 */
export const CALCES = ["chico", "justo", "grande"] as const;
export const Calce = z.enum(CALCES);
export type Calce = z.infer<typeof Calce>;
export const TEXTO_CALCE: Record<Calce, string> = { chico: "Le quedó chico", justo: "Talle justo", grande: "Le quedó grande" };

export const ResenaPublica = z.object({
  id: z.number().int(),
  nombre: z.string(),
  estrellas: z.number().int().min(1).max(5),
  texto: z.string().nullable(),
  calce: Calce.nullable(),
  talle: z.string().nullable(),
  color: z.string().nullable(),
  fecha: z.string(),
  respuesta: z.string().nullable(),
  /** Para las del inicio: de qué prenda es (null = sobre la compra en general). */
  producto: z.object({ slug, nombre: z.string(), foto: FotoPublica.nullable() }).nullable().optional(),
});
export type ResenaPublica = z.infer<typeof ResenaPublica>;

export const ORDENES_RESENAS = ["recientes", "mejores", "peores"] as const;

/** GET /v1/productos/:slug/resenas */
export const ResenasProducto = z.object({
  resumen: ResumenResenas.extend({
    /** cuántas de 1, 2, 3, 4 y 5 estrellas */
    estrellas: z.array(z.number().int()).length(5),
    calce: z.object({ chico: z.number().int(), justo: z.number().int(), grande: z.number().int() }),
  }),
  resenas: z.array(ResenaPublica),
  total: z.number().int(),
});
export type ResenasProducto = z.infer<typeof ResenasProducto>;

/** GET /v1/resenas/inicio: el promedio de toda la tienda y las últimas, para el final del inicio. */
export const ResenasInicio = z.object({
  promedio: z.number().nullable(),
  cantidad: z.number().int(),
  resenas: z.array(ResenaPublica),
});
export type ResenasInicio = z.infer<typeof ResenasInicio>;

/** GET /v1/opinar/:numero?t=… — qué puede opinar quien tiene el enlace. */
export const PedidoParaOpinar = z.object({
  numero: z.string(),
  nombre: z.string(),
  productos: z.array(z.object({
    productoId: z.number().int(),
    slug: z.string().nullable(),
    nombre: z.string(),
    color: z.string().nullable(),
    talle: z.string().nullable(),
    foto: FotoPublica.nullable(),
    yaOpino: z.boolean(),
  })),
  generalYaOpino: z.boolean(),
});
export type PedidoParaOpinar = z.infer<typeof PedidoParaOpinar>;

// Sin renglones vacíos de más; vacío = sin texto (sólo las estrellas).
const TextoResena = z.string().trim().max(1000, "Hasta 1000 caracteres").transform((t) => t.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n")).optional().transform((t) => (t ? t : null));

/** POST /v1/opinar/:numero?t=… */
export const Opiniones = z.object({
  resenas: z.array(z.object({
    /** null = sobre la compra en general */
    productoId: z.number().int().positive().max(2_147_483_647).nullable(),
    estrellas: z.number().int().min(1).max(5),
    texto: TextoResena,
    calce: Calce.nullable().optional().transform((c) => c ?? null),
  }).strict()).min(1).max(31),
}).strict().superRefine((o, ctx) => {
  const vistos = new Set<number | null>();
  for (const r of o.resenas) {
    if (vistos.has(r.productoId)) ctx.addIssue({ code: "custom", message: "Una opinión por prenda" });
    vistos.add(r.productoId);
    if (r.productoId === null && r.calce) ctx.addIssue({ code: "custom", message: "El calce es de una prenda" });
  }
});
export type Opiniones = z.infer<typeof Opiniones>;

/** "Ana", "García" → "Ana G." (lo que se muestra; nunca el apellido entero). */
export function nombreParaResena(nombre: string, apellido: string): string {
  const n = nombre.trim().split(/\s+/)[0] ?? "";
  const a = apellido.trim().charAt(0).toUpperCase();
  const limpio = `${n.charAt(0).toUpperCase()}${n.slice(1).toLowerCase()}`.slice(0, 30);
  return (a ? `${limpio} ${a}.` : limpio) || "Cliente";
}

/** Banner del carrusel del inicio. */
export const BannerPublico = z.object({
  id: z.number().int(),
  alt: z.string(),
  enlace: z.string().nullable(),
  foto: z.object({ clave: z.string(), ancho: z.number().int().nullable(), alto: z.number().int().nullable() }),
  fotoMovil: z.object({ clave: z.string(), ancho: z.number().int().nullable(), alto: z.number().int().nullable() }).nullable(),
});
export type BannerPublico = z.infer<typeof BannerPublico>;
