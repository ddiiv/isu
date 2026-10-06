import { z } from "zod";
import { conDescuento, type Centavos } from "./plata.js";

/*
 * Packs: "llevá más, pagá menos". Una prenda marcada como pack se vende de
 * `minimo` a `maximo` unidades (2 a 10 de fábrica; se cambia en Ajustes),
 * cada una con su talle y su color, con un % de descuento según cuántas
 * lleva: `porcentajes[0]` es el de `minimo`, el siguiente el de una más…
 *
 * No son los packs armados de Stocker (esos no llegan a la tienda): se arman
 * sobre la prenda padre, con el stock de cada una de sus variantes.
 *
 * El descuento lo decide la API con el carrito: cuenta las unidades de cada
 * prenda pack, sin importar si las armó desde la página del pack o las
 * sumó sueltas. Con más de `maximo`, vale el % de `maximo`.
 *
 * La dirección de la página del pack es la de la ficha con "pack-xN-"
 * adelante: /producto/pack-x3-remera-oversize (como las tiendas de
 * referencia). Cambiar la cantidad cambia la dirección.
 */
/** Nunca más que esto (la página lista una prenda por unidad). */
export const PACK_TOPE = 20;

export interface AjustePacks { minimo: number; maximo: number; porcentajes: number[] }

export const PACKS_POR_DEFECTO: AjustePacks = { minimo: 2, maximo: 10, porcentajes: [10, 15, 18, 20, 21, 22, 23, 24, 25] };

export const Packs = z.object({
  minimo: z.number().int().min(2).max(PACK_TOPE),
  maximo: z.number().int().min(2).max(PACK_TOPE),
  porcentajes: z.array(z.number().int().min(0).max(60)).min(1).max(PACK_TOPE - 1),
}).strict()
  .refine((p) => p.maximo >= p.minimo, { message: "El máximo no puede ser menor que el mínimo", path: ["maximo"] })
  .refine((p) => p.porcentajes.length === p.maximo - p.minimo + 1, { message: "Va un % por cada cantidad, del mínimo al máximo", path: ["porcentajes"] })
  .refine((p) => p.porcentajes.every((v, i) => i === 0 || v >= p.porcentajes[i - 1]!), { message: "Llevando más, el descuento no puede ser menor", path: ["porcentajes"] });

/** El ajuste guardado, sea del formato nuevo o del viejo ([x2, x3, x4, x5]); si no sirve, el de fábrica. */
export function leerPacks(v: unknown): AjustePacks {
  const nuevo = Packs.safeParse(v);
  if (nuevo.success) return nuevo.data;
  if (Array.isArray(v) && v.length >= 1 && v.every((x) => Number.isInteger(x) && x >= 0 && x <= 60)) {
    const viejo = Packs.safeParse({ minimo: 2, maximo: 1 + v.length, porcentajes: v });
    if (viejo.success) return viejo.data;
  }
  return PACKS_POR_DEFECTO;
}

/** Las cantidades que se ofrecen: [2, 3, …, 10]. */
export const cantidadesPack = (p: AjustePacks) => Array.from({ length: p.maximo - p.minimo + 1 }, (_, i) => p.minimo + i);

/** El % más alto (el de llevar el máximo). */
export const maxPorcentajePack = (p: AjustePacks) => Math.max(0, ...p.porcentajes);

/** % de descuento por llevar `unidades` de una prenda pack (0 si son menos del mínimo). */
export function porcentajePack(p: AjustePacks, unidades: number): number {
  if (!Number.isInteger(unidades) || unidades < p.minimo) return 0;
  return p.porcentajes[Math.min(unidades, p.maximo) - p.minimo] ?? 0;
}

/** Precio por unidad dentro del pack (el mismo redondeo que el resto de la tienda). */
export const precioEnPack = (precio: Centavos | number, porcentaje: number) => conDescuento(precio as Centavos, porcentaje);

export const rutaPack = (slug: string, unidades: number) => `/producto/pack-x${unidades}-${slug}`;

/** "pack-x3-remera-oversize" → { unidades: 3, slug: "remera-oversize" }; cualquier otra cosa → null. La cantidad se valida contra el ajuste en la página. */
export function leerRutaPack(s: string): { unidades: number; slug: string } | null {
  const m = /^pack-x([1-9]\d?)-([a-z0-9][a-z0-9-]{0,79})$/.exec(s);
  if (!m) return null;
  const unidades = Number(m[1]);
  return unidades >= 2 && unidades <= PACK_TOPE ? { unidades, slug: m[2]! } : null;
}
