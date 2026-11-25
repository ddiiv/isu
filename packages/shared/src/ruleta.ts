import { z } from "zod";

/*
 * Ruleta de descuentos (migración 0037). El sorteo es siempre en la API. Los montos en centavos.
 * Ver apps/api/src/lib/ruleta.ts.
 */
export const TIPOS_PREMIO = ["porcentaje", "monto", "envio_gratis", "segunda_unidad", "nada"] as const;
export type TipoPremio = (typeof TIPOS_PREMIO)[number];

export const PremioEntrada = z.object({
  id: z.number().int().positive().optional(),
  etiqueta: z.string().trim().min(2, "Poné un nombre").max(40),
  tipo: z.enum(TIPOS_PREMIO),
  /** porcentaje y 2da unidad: 1 a 90 · monto: centavos · envío gratis y sin premio: 0 */
  valor: z.number().int().min(0).max(1_000_000_000),
  /** compra mínima del cupón que se gana (centavos) */
  minimo: z.number().int().min(0).max(1_000_000_000).default(0),
  /** la probabilidad es este peso sobre la suma de los pesos de los premios activos */
  peso: z.number().int().min(0).max(1000),
  activo: z.boolean().default(true),
}).strict().superRefine((p, ctx) => {
  const mal = (message: string) => ctx.addIssue({ code: "custom", path: ["valor"], message });
  if ((p.tipo === "porcentaje" || p.tipo === "segunda_unidad") && (p.valor < 1 || p.valor > 90)) mal("El porcentaje va de 1 a 90");
  if (p.tipo === "monto" && p.valor < 100) mal("El monto tiene que ser de al menos $1");
  if ((p.tipo === "envio_gratis" || p.tipo === "nada") && p.valor !== 0) mal("Este premio no lleva valor");
});
export type PremioEntrada = z.infer<typeof PremioEntrada>;

export const ListaPremios = z.object({ premios: z.array(PremioEntrada).min(2).max(16) }).strict()
  .refine((l) => l.premios.some((p) => p.activo && p.peso > 0), { message: "Tiene que haber al menos un premio activo con peso", path: ["premios"] });

export const ConfigRuleta = z.object({
  /** prendida a mano, aunque no haya ningún evento */
  manual: z.boolean(),
  /** aparece sola mientras haya un evento de temporada vigente */
  conEventos: z.boolean(),
  /** cada cuántos días puede girar una cuenta */
  cadaDias: z.number().int().min(1).max(365),
  /** cuántos días dura el cupón ganado (nunca más allá del evento, si salió de uno) */
  venceDias: z.number().int().min(1).max(365),
}).strict();
export type ConfigRuleta = z.infer<typeof ConfigRuleta>;

const CuponGanado = z.object({ codigo: z.string(), nombre: z.string(), hasta: z.string().nullable(), minimo: z.number().int() });
const PremioPublico = z.object({ etiqueta: z.string(), tipo: z.enum(TIPOS_PREMIO) });

/** Lo que ve la cuenta: si puede girar, cuándo, los premios de la rueda y sus cupones sin usar. */
export const RuletaEstado = z.object({
  disponible: z.boolean(),
  motivo: z.enum(["apagada", "espera"]).nullable(),
  proximoGiro: z.string().nullable(),
  /** el evento que la abrió (Navidad…), si fue por eso */
  evento: z.string().nullable(),
  venceDias: z.number().int(),
  premios: z.array(PremioPublico),
  cupones: z.array(CuponGanado),
});
export type RuletaEstado = z.infer<typeof RuletaEstado>;

export const RuletaResultado = z.object({
  /** posición del premio en `premios` del estado (para frenar la rueda ahí) */
  indice: z.number().int(),
  premio: PremioPublico,
  cupon: CuponGanado.nullable(),
  proximoGiro: z.string(),
});
export type RuletaResultado = z.infer<typeof RuletaResultado>;
