import { z } from "zod";

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

export const Local = z.object({
  nombre: z.string(),
  direccion: z.string(),
  localidad: z.string(),
  horario: z.string(),
  mapa: z.string().url().nullable(),
  retiro: z.boolean(),
});
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
});
export type ConfigPublica = z.infer<typeof ConfigPublica>;

export interface CategoriaNodo {
  id: number;
  nombre: string;
  slug: string;
  hijas: CategoriaNodo[];
}
export const CategoriaNodo: z.ZodType<CategoriaNodo> = z.lazy(() =>
  z.object({
    id: z.number().int(),
    nombre: z.string(),
    slug,
    hijas: z.array(CategoriaNodo),
  }),
);

export const ErrorApi = z.object({
  error: z.string(),
  mensaje: z.string(),
  idPedido: z.string().optional(),
});
export type ErrorApi = z.infer<typeof ErrorApi>;
