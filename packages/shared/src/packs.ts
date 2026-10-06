import { z } from "zod";
import { conDescuento, type Centavos } from "./plata.js";

/*
 * Packs: "llevá más, pagá menos". Una prenda marcada como pack se vende de
 * PACK_MIN a PACK_MAX unidades, cada una con su talle y su color, con un %
 * de descuento según cuántas lleva (ajuste `packs`: [x2, x3, x4, x5]).
 *
 * El descuento lo decide la API con el carrito: cuenta las unidades de cada
 * prenda pack, sin importar si las armó desde la página del pack o las
 * sumó sueltas. Con más de PACK_MAX, vale el % de PACK_MAX.
 *
 * La dirección de la página del pack es la de la ficha con "pack-xN-"
 * adelante: /producto/pack-x3-remera-oversize (como las tiendas de
 * referencia). Cambiar la cantidad cambia la dirección.
 */
export const PACK_MIN = 2;
export const PACK_MAX = 5;
export const CANTIDADES_PACK = [2, 3, 4, 5] as const;
export const PACKS_POR_DEFECTO = [10, 15, 18, 20];

export const Packs = z.array(z.number().int().min(0).max(60)).length(4)
  .refine((p) => p.every((v, i) => i === 0 || v >= p[i - 1]!), "Llevando más, el descuento no puede ser menor");
export type Packs = z.infer<typeof Packs>;

/** % de descuento por llevar `unidades` de una prenda pack (0 si son menos de 2). */
export function porcentajePack(packs: readonly number[], unidades: number): number {
  if (!Number.isInteger(unidades) || unidades < PACK_MIN) return 0;
  return packs[Math.min(unidades, PACK_MAX) - PACK_MIN] ?? 0;
}

/** Precio por unidad dentro del pack (el mismo redondeo que el resto de la tienda). */
export const precioEnPack = (precio: Centavos | number, porcentaje: number) => conDescuento(precio as Centavos, porcentaje);

export const rutaPack = (slug: string, unidades: number) => `/producto/pack-x${unidades}-${slug}`;

/** "pack-x3-remera-oversize" → { unidades: 3, slug: "remera-oversize" }; cualquier otra cosa → null. */
export function leerRutaPack(s: string): { unidades: number; slug: string } | null {
  const m = /^pack-x([2-5])-([a-z0-9][a-z0-9-]{0,79})$/.exec(s);
  return m ? { unidades: Number(m[1]), slug: m[2]! } : null;
}
