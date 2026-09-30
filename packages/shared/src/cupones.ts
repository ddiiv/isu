import { z } from "zod";

/*
 * Cupones y promociones por monto (backoffice). Los montos en centavos,
 * como todo en la tienda. Ver la migración 0011 y apps/api/src/lib/cupones.ts.
 */
export const TIPOS_CUPON = ["porcentaje", "monto", "envio_gratis"] as const;
export const ALCANCES_CUPON = ["todo", "categorias", "productos"] as const;
export const CODIGO_CUPON = /^[A-Z0-9][A-Z0-9_-]{2,29}$/;

const IdCupon = z.number().int().positive().max(2_147_483_647);
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
  desde: Fecha,
  hasta: Fecha,
  usosMax: z.number().int().min(1).max(10_000_000).nullable().default(null),
  usosPorCliente: z.number().int().min(1).max(1000).nullable().default(null),
  activo: z.boolean().default(true),
}).strict().superRefine((c, ctx) => {
  const mal = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
  if (c.automatico && c.codigo) mal("codigo", "Una promoción automática no lleva código");
  if (!c.automatico && !c.codigo) mal("codigo", "Poné el código que va a escribir el cliente");
  if (c.tipo === "porcentaje" && (c.valor < 1 || c.valor > 90)) mal("valor", "El porcentaje va de 1 a 90");
  if (c.tipo === "monto" && c.valor < 100) mal("valor", "El monto tiene que ser de al menos $1");
  if (c.tipo === "envio_gratis" && c.valor !== 0) mal("valor", "El envío gratis no lleva valor");
  if (c.alcance === "categorias" && !c.categoriaIds.length) mal("categoriaIds", "Elegí al menos una categoría");
  if (c.alcance === "productos" && !c.productoIds.length) mal("productoIds", "Elegí al menos una prenda");
  if (c.desde && c.hasta && new Date(c.hasta) <= new Date(c.desde)) mal("hasta", "La fecha de fin tiene que ser posterior al inicio");
  if (c.automatico && c.usosPorCliente) mal("usosPorCliente", "El tope por cliente es para cupones con código");
});
export type CuponEntrada = z.infer<typeof CuponEntrada>;

/** Cómo se lee un cupón en una línea: "15% OFF", "$5.000 OFF", "Envío gratis". */
export function resumenCupon(c: { tipo: (typeof TIPOS_CUPON)[number]; valor: number }, pesos: (c: number) => string): string {
  if (c.tipo === "porcentaje") return `${c.valor}% OFF`;
  if (c.tipo === "monto") return `${pesos(c.valor)} OFF`;
  return "Envío gratis";
}
