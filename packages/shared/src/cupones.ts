import { z } from "zod";
import { Items, MedioPago } from "./checkout.js";

/*
 * Cupones y promociones por monto (backoffice). Los montos en centavos,
 * como todo en la tienda. Ver la migración 0011 y apps/api/src/lib/cupones.ts.
 */
export const TIPOS_CUPON = ["porcentaje", "monto", "envio_gratis", "mezcla", "segunda_unidad"] as const;
export const ALCANCES_CUPON = ["todo", "categorias", "productos"] as const;
export const CODIGO_CUPON = /^[A-Z0-9][A-Z0-9_-]{2,29}$/;

const IdCupon = z.number().int().positive().max(2_147_483_647);
/** Mezcla: con `desde` prendas elegibles o más, `mayorista` de ellas (las más baratas) van a precio mayorista. */
export const TramoMezcla = z.object({ desde: z.number().int().min(2).max(50), mayorista: z.number().int().min(1).max(50) }).strict();
const Fecha = z.iso.datetime({ offset: true }).nullable().default(null);

export const CuponEntrada = z.object({
  /** true = promoción sin código: se aplica sola cuando la compra cumple. */
  automatico: z.boolean().default(false),
  codigo: z.string().trim().toUpperCase().regex(CODIGO_CUPON, "El código va de 3 a 30 letras o números, sin espacios (se puede usar - y _)").nullable().default(null),
  nombre: z.string().trim().min(2, "Poné un nombre (lo ve el cliente)").max(80),
  tipo: z.enum(TIPOS_CUPON),
  /** porcentaje: 1 a 90 · monto: centavos · envío gratis: 0 */
  valor: z.number().int().min(0).max(1_000_000_000),
  alcance: z.enum(ALCANCES_CUPON).default("todo"),
  categoriaIds: z.array(IdCupon).max(100).default([]),
  productoIds: z.array(IdCupon).max(2000).default([]),
  sobreRebajas: z.boolean().default(true),
  /** compra mínima en centavos (0 = sin mínimo) */
  minimo: z.number().int().min(0).max(1_000_000_000).default(0),
  /** mezcla: los tramos (de menor a mayor) y el máximo de prendas a mayorista por compra */
  escala: z.array(TramoMezcla).max(10).default([]),
  maxMayorista: z.number().int().min(1).max(50).default(5),
  /** porcentaje o mezcla: el descuento no pasa de este monto en centavos (null = sin tope) */
  tope: z.number().int().min(100).max(1_000_000_000).nullable().default(null),
  desde: Fecha,
  hasta: Fecha,
  usosMax: z.number().int().min(1).max(10_000_000).nullable().default(null),
  usosPorCliente: z.number().int().min(1).max(1000).nullable().default(null),
  /** false = no se suma a la rebaja de la prenda: en cada prenda rige el mejor precio para el cliente (sólo porcentaje y 2da unidad). */
  acumula: z.boolean().default(true),
  /** true = la tienda lo muestra en /cupones y en el carrito, con un botón para aplicarlo (sólo con código). false = código secreto. */
  visible: z.boolean().default(false),
  /** una línea para mostrarlo («Para tu primera compra») */
  descripcion: z.string().trim().max(160).nullable().default(null).transform((v) => v || null),
  activo: z.boolean().default(true),
}).strict().superRefine((c, ctx) => {
  const mal = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
  if (c.automatico && c.codigo) mal("codigo", "Una promoción automática no lleva código");
  if (!c.automatico && !c.codigo) mal("codigo", "Poné el código que va a escribir el cliente");
  if (c.tipo === "porcentaje" && (c.valor < 1 || c.valor > 90)) mal("valor", "El porcentaje va de 1 a 90");
  if (c.tope !== null && c.tipo !== "porcentaje" && c.tipo !== "mezcla") mal("tope", "El tope es sólo para cupones de porcentaje o de mezcla");
  if (c.tipo === "mezcla") {
    if (c.valor !== 0) mal("valor", "La mezcla no lleva valor");
    if (!c.escala.length) mal("escala", "Cargá al menos un tramo (por ejemplo: desde 3 prendas, 1 a mayorista)");
    c.escala.forEach((t, i) => {
      if (t.mayorista > t.desde) mal("escala", `Tramo ${i + 1}: no pueden ir a mayorista más prendas de las que lleva`);
      if (i > 0 && t.desde <= c.escala[i - 1]!.desde) mal("escala", "Los tramos van de menor a mayor, sin repetir cantidad");
    });
  } else if (c.escala.length) mal("escala", "La escala es sólo para cupones de mezcla");
  if (c.tipo === "segunda_unidad") {
    if (c.valor < 1 || c.valor > 90) mal("valor", "El porcentaje de la 2da unidad va de 1 a 90");
    if (c.tope !== null) mal("tope", "El tope es sólo para cupones de porcentaje o de mezcla");
  }
  if (!c.acumula && c.tipo !== "porcentaje" && c.tipo !== "segunda_unidad") mal("acumula", "«No se suma a la rebaja» es sólo para porcentaje y 2da unidad");
  if (c.tipo === "monto" && c.valor < 100) mal("valor", "El monto tiene que ser de al menos $1");
  if (c.tipo === "envio_gratis" && c.valor !== 0) mal("valor", "El envío gratis no lleva valor");
  if (c.alcance === "categorias" && !c.categoriaIds.length) mal("categoriaIds", "Elegí al menos una categoría");
  if (c.alcance === "productos" && !c.productoIds.length) mal("productoIds", "Elegí al menos una prenda");
  if (c.desde && c.hasta && new Date(c.hasta) <= new Date(c.desde)) mal("hasta", "La fecha de fin tiene que ser posterior al inicio");
  if (c.visible && c.automatico) mal("visible", "Las promociones automáticas se muestran solas: «visible» es para cupones con código");
  if (c.automatico && c.usosPorCliente) mal("usosPorCliente", "El tope por cliente es para cupones con código");
});
export type CuponEntrada = z.infer<typeof CuponEntrada>;

/** Cómo se lee un cupón en una línea: "15% OFF", "$5.000 OFF", "Envío gratis". */
export function resumenCupon(c: { tipo: (typeof TIPOS_CUPON)[number]; valor: number; tope?: number | null }, pesos: (c: number) => string): string {
  if (c.tipo === "mezcla") return `Mezcla mayorista${c.tope ? `, hasta ${pesos(c.tope)} de descuento` : ""}`;
  if (c.tipo === "segunda_unidad") return `2da unidad al ${c.valor}% OFF`;
  if (c.tipo === "porcentaje") return `${c.valor}% OFF${c.tope ? `, hasta ${pesos(c.tope)} de descuento` : ""}`;
  if (c.tipo === "monto") return `${pesos(c.valor)} OFF`;
  return "Envío gratis";
}

/** Lo que la tienda muestra de los cupones: los visibles (con código), las promociones automáticas y si hay una ruleta abierta. */
export const CuponesPublicos = z.object({
  cupones: z.array(z.object({ codigo: z.string(), nombre: z.string(), descripcion: z.string().nullable(), detalle: z.string(), minimo: z.number().int(), hasta: z.string().nullable() })),
  promociones: z.array(z.object({ nombre: z.string(), detalle: z.string(), minimo: z.number().int(), hasta: z.string().nullable() })),
  /** si hay una ruleta abierta, y cada cuántos días se gira y cuántos dura el cupón (para la página de la ruleta) */
  ruleta: z.object({ abierta: z.boolean(), evento: z.string().nullable(), cadaDias: z.number().int(), venceDias: z.number().int() }),
});
export type CuponesPublicos = z.infer<typeof CuponesPublicos>;

/**
 * «Cupones disponibles» del carrito: cada cupón (los que la tienda muestra y los que ganó este cliente en la ruleta) evaluado contra
 * ESTE carrito: si aplica y cuánto ahorra, o cuánto falta para usarlo. El cliente se identifica con su sesión o, sin cuenta, con el
 * identificador de su navegador; sólo se evalúan SUS cupones.
 */
export const PedidoEvaluar = z.object({
  items: Items,
  medioPago: MedioPago.optional(),
  entrega: z.enum(["envio", "retiro"]).optional(),
  dispositivo: z.string().regex(/^[A-Za-z0-9_-]{32,64}$/).optional(),
}).strict();
export type PedidoEvaluar = z.infer<typeof PedidoEvaluar>;

export const CuponesEvaluados = z.object({
  cupones: z.array(z.object({
    codigo: z.string(), nombre: z.string(), detalle: z.string(), minimo: z.number().int(), hasta: z.string().nullable(),
    /** lo ganó este cliente en la ruleta */
    propio: z.boolean(),
    /** se puede aplicar a este carrito (rige: uno por compra, el que más descuenta) */
    aplicable: z.boolean(),
    /** centavos que ahorra en este carrito (0 si no aplica o es envío gratis) */
    ahorro: z.number().int(),
    envioGratis: z.boolean(),
    /** centavos que faltan de compra para usarlo (sólo si es por el mínimo) */
    falta: z.number().int().nullable(),
    /** por qué no aplica, si no es por el mínimo */
    motivo: z.string().nullable(),
  })),
});
export type CuponesEvaluados = z.infer<typeof CuponesEvaluados>;
