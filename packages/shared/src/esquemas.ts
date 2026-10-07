import { z } from "zod";
import { Packs, PACKS_POR_DEFECTO } from "./packs.js";

/*
 * Esquemas que comparten la API, la tienda y el backoffice. Lo que viaja por
 * la red se valida contra esto en los dos extremos.
 */

export const slug = z
  .string()
  .min(1)
  .max(80)
  // Sin ambigüedad (cada repetición arranca con "-"): es lineal, no hay ReDoS.
  // eslint-disable-next-line security/detect-unsafe-regex
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Sólo minúsculas, números y guiones");

export const telefonoWhatsapp = z.string().regex(/^\d{10,15}$/, "Sólo dígitos, con código de país");

/**
 * El link de un local (el de Google Maps, o el que se quiera): la tienda lo
 * muestra para que se pueda tocar. Sólo https: nada de javascript:, data: ni
 * direcciones sin cifrar.
 */
export const EnlaceLocal = z.string().trim().max(500).url("No es un link válido.")
  .refine((u) => /^https:\/\/[^\s/]+\.[^\s/]+/i.test(u), "Tiene que ser un link que empiece con https://");

/** Lo que se pega en Ajustes ("maps.app.goo.gl/xyz", "http://…") como link: con https:// adelante. */
export function normalizarEnlace(s: string): string {
  const t = s.trim();
  if (!t) return "";
  if (/^http:\/\//i.test(t)) return `https://${t.slice(7)}`;
  return /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`;
}

export const Local = z.object({
  nombre: z.string(),
  direccion: z.string(),
  localidad: z.string(),
  horario: z.string(),
  /** El link del local (Google Maps). Nombre histórico: ahora sirve para cualquier link. */
  mapa: EnlaceLocal.nullable(),
  retiro: z.boolean(),
});
/** El link del local por su nombre (el pedido guarda el nombre), si tiene uno válido. */
export function enlaceDeLocal(locales: ReadonlyArray<Pick<Local, "nombre" | "mapa">>, nombre: string | null | undefined): string | null {
  const m = nombre ? locales.find((l) => l.nombre === nombre)?.mapa : null;
  return m && EnlaceLocal.safeParse(m).success ? m : null;
}
export type Local = z.infer<typeof Local>;

/** Lo que la tienda necesita saber de la configuración, sin sesión. */
export const ConfigPublica = z.object({
  montoMinimoCarrito: z.number().int().nonnegative(), // centavos
  envioGratisDesde: z.number().int().nonnegative().nullable(), // centavos
  descuentoTransferencia: z.number().min(0).max(100), // %
  cuotasSinInteres: z.number().int().min(1).max(24),
  whatsapp: telefonoWhatsapp,
  email: z.string().email().nullable(),
  anuncio: z.string().max(160).nullable(),
  avisoUltimas: z.number().int().min(0).max(20), // desde cuántas unidades se dice "¡Últimas!"
  mostrarAgotados: z.boolean(),
  // Los medios de pago que están configurados de verdad (el checkout sólo ofrece esos).
  mediosPago: z.array(z.enum(["mercadopago", "pagofacil", "transferencia", "local"])),
  costoEnvio: z.number().int().nonnegative(), // centavos
  locales: z.array(Local),
  // Etapa 5: asistente de la tienda (burbuja de chat).
  chatbot: z.object({ activo: z.boolean(), saludo: z.string().max(200) }).default({ activo: false, saludo: "" }),
  // Packs: de `minimo` a `maximo` unidades de la misma prenda, con un % por cantidad; hayPacks = alguna prenda se vende en pack.
  packs: Packs.default(PACKS_POR_DEFECTO),
  hayPacks: z.boolean().default(false),
  /** Etapa 9: categorías de arriba (slug) que tienen packs / productos en liquidación (el menú arma sus desplegables con esto). */
  packsEn: z.array(z.string()).default([]),
  hayLiquidacion: z.boolean().default(false),
  liquidacionEn: z.array(z.string()).default([]),
  /** Cuidados generales de las prendas (la ficha los muestra). */
  cuidados: z.string().max(600).default(""),
  /** Números de la marca para el inicio ("+10 años · diseñando y fabricando"). */
  cifras: z.array(z.object({ valor: z.string().trim().min(1).max(20), texto: z.string().trim().min(1).max(60) })).max(4).default([]),
  /** Etapa 11: ayudas para la dirección en el checkout (sugerencias de Google, revisión con Georef). */
  direcciones: z.object({ sugerencias: z.boolean(), revisar: z.boolean() }).default({ sugerencias: false, revisar: false }),
});
export type ConfigPublica = z.infer<typeof ConfigPublica>;

export interface CategoriaNodo {
  id: number;
  nombre: string;
  slug: string;
  hijas: CategoriaNodo[];
  /** Para Google (backoffice → Categorías). null = se arma solo. */
  seoTitulo?: string | null;
  seoDescripcion?: string | null;
  /** Texto abajo de la grilla. */
  texto?: string | null;
}
export const CategoriaNodo: z.ZodType<CategoriaNodo> = z.lazy(() =>
  z.object({
    id: z.number().int(),
    nombre: z.string(),
    slug,
    hijas: z.array(CategoriaNodo),
    seoTitulo: z.string().nullable().optional(),
    seoDescripcion: z.string().nullable().optional(),
    texto: z.string().nullable().optional(),
  }),
);

export const ErrorApi = z.object({
  error: z.string(),
  mensaje: z.string(),
  idPedido: z.string().optional(),
});
export type ErrorApi = z.infer<typeof ErrorApi>;
