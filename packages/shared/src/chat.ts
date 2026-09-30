import { z } from "zod";

/*
 * Asistente de la tienda (etapa 5). El navegador manda el mensaje y, si el
 * asistente estaba esperando un dato (el código postal), qué esperaba. Todo
 * lo demás lo decide la API: el navegador nunca manda "respuestas".
 */
/* Enlace a la tienda: "/algo", nunca "//otro.sitio" ni "/\\otro". */
// eslint-disable-next-line security/detect-unsafe-regex -- anclada, sin alternativas que se solapen y con largo máximo
export const ENLACE_TIENDA = /^\/([A-Za-z0-9_#?=&.-][A-Za-z0-9/_#?=&.-]{0,198})?$/;

export const TEMAS_CHAT = ["envios", "pagos", "talles", "cambios", "pedidos", "locales", "mayorista", "general"] as const;
export type TemaChat = (typeof TEMAS_CHAT)[number];

export const MensajeChat = z.object({
  mensaje: z.string().trim().min(1, "Escribí tu consulta").max(300, "Escribilo más corto (hasta 300 letras)"),
  esperando: z.enum(["cp"]).optional(),
  // Lo último que preguntó (sólo lo del cliente), para el modo con IA.
  previos: z.array(z.string().trim().max(300)).max(3).optional(),
  // Dónde está: una ficha de producto hace que "¿qué talle?" hable de esa prenda.
  producto: z.string().regex(/^[a-z0-9-]{1,120}$/).optional(),
}).strict();
export type MensajeChat = z.infer<typeof MensajeChat>;

/* Enlaces: siempre de la tienda (/…) o el WhatsApp de la tienda (lo arma la API). */
export const EnlaceChat = z.object({ texto: z.string(), url: z.string() });
export const RespuestaChat = z.object({
  texto: z.string(),
  tema: z.enum([...TEMAS_CHAT, "saludo", "humano", "productos", "sin_respuesta"]),
  enlaces: z.array(EnlaceChat),
  sugerencias: z.array(z.string()),
  productos: z.array(z.object({ nombre: z.string(), precio: z.number().int(), url: z.string(), foto: z.string().nullable() })).optional(),
  opcionesEnvio: z.array(z.object({ nombre: z.string(), detalle: z.string(), precio: z.number().int(), gratis: z.boolean() })).optional(),
  // Qué necesita el asistente para seguir: el código postal, o número de pedido + email (formulario).
  esperando: z.enum(["cp", "pedido"]).optional(),
  faqId: z.number().int().optional(),
  ia: z.boolean().optional(),
});
export type RespuestaChat = z.infer<typeof RespuestaChat>;

export const ConsultaPedidoChat = z.object({
  numero: z.string().trim().toUpperCase().regex(/^ISU-?\d{4,10}$/, "El número es como ISU-1234").transform((n) => (n.includes("-") ? n : n.replace("ISU", "ISU-"))),
  email: z.string().trim().toLowerCase().email("Email inválido").max(150),
}).strict();

export const VotoChat = z.object({ faqId: z.number().int().positive(), util: z.boolean() }).strict();

/* Ajustes (backoffice). */
export const AjusteChatbot = z.object({
  activo: z.boolean(),
  saludo: z.string().trim().min(5).max(200),
}).strict();
export type AjusteChatbot = z.infer<typeof AjusteChatbot>;
export const AjusteChatbotIa = z.object({
  activo: z.boolean(),
  topeDiario: z.number().int().min(0).max(20_000),
}).strict();

export const Faq = z.object({
  pregunta: z.string().trim().min(5).max(200),
  respuesta: z.string().trim().min(5).max(1500),
  palabras: z.string().trim().max(300).default(""),
  tema: z.enum(TEMAS_CHAT).default("general"),
  enlaceTexto: z.string().trim().max(60).nullable().default(null),
  // Una ruta de la tienda: empieza con UNA barra ("//otro.sitio" lleva a otro sitio).
  enlaceUrl: z.string().trim().regex(ENLACE_TIENDA, "Una dirección de la tienda que empiece con / (por ejemplo /devoluciones)").nullable().default(null),
  orden: z.number().int().min(-1000).max(1000).default(0),
  activo: z.boolean().default(true),
}).strict().refine((f) => (f.enlaceTexto === null) === (f.enlaceUrl === null), { message: "El enlace necesita texto y dirección", path: ["enlaceUrl"] });
export type Faq = z.infer<typeof Faq>;
