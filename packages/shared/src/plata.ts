/*
 * Plata: siempre en centavos enteros.
 *
 * Nunca se hace aritmética con decimales de coma flotante sobre precios:
 * 0.1 + 0.2 no da 0.3, y en un carrito con descuentos y recargos esos
 * centavos terminan en un total que no coincide con el de Mercado Pago.
 */

export type Centavos = number & { readonly __centavos: unique symbol };

export function centavos(n: number): Centavos {
  if (!Number.isSafeInteger(n)) throw new RangeError(`Importe inválido: ${n}`);
  return n as Centavos;
}

/** "12345.6" | 12345.6 → 1234560 centavos. Redondeo bancario no hace falta: se redondea al centavo. */
export function desdePesos(pesos: number | string): Centavos {
  const valor = typeof pesos === "string" ? Number(pesos.replace(",", ".")) : pesos;
  if (!Number.isFinite(valor)) throw new RangeError(`Importe inválido: ${pesos}`);
  return centavos(Math.round(valor * 100));
}

const formato = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** 1234500 → "$ 12.345" (sin decimales: así se muestran los precios de ropa). */
export function formatearPesos(c: number): string {
  return formato.format(Math.round(c / 100));
}

const conCentavos = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * El monto exacto a transferir: 1600037 → "$ 16.000,37" (y 1600000 → "$ 16.000").
 * Con la cuenta de Mercado Pago los centavos identifican el pedido: no se pueden redondear.
 */
export function formatearPesosExactos(c: number): string {
  const n = Math.round(c);
  return n % 100 === 0 ? formatearPesos(n) : conCentavos.format(n / 100);
}

/** Aplica un porcentaje de descuento (0–100) y redondea al peso entero hacia abajo. */
export function conDescuento(c: Centavos, porcentaje: number): Centavos {
  if (!(porcentaje >= 0 && porcentaje <= 100)) throw new RangeError("Porcentaje fuera de rango");
  const bruto = Math.floor((c * (100 - porcentaje)) / 100);
  return centavos(Math.floor(bruto / 100) * 100);
}
