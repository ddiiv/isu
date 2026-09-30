import type pg from "pg";
import { centavos, conDescuento, formatearPesos } from "@isu/shared";

/*
 * Cupones y promociones por monto (tabla tienda.cupones, ver 0011).
 *
 * Reglas:
 *   · se calcula sobre el precio que ya tiene la rebaja de la prenda; el
 *     descuento por transferencia va después, sobre lo que queda
 *   · UNO por compra: entre el cupón que escribió el cliente y las
 *     promociones automáticas, el que más le descuenta (no se suman)
 *   · el descuento se reparte por unidad (redondeado al peso hacia abajo):
 *     así el precio de cada prenda que va a Mercado Pago y a Stocker es el
 *     que se cobró de verdad y la suma cierra al centavo
 *   · nunca por debajo de $0; el envío sólo lo toca el de envío gratis
 */

export interface Cupon {
  id: number;
  codigo: string | null;
  nombre: string;
  automatico: boolean;
  tipo: "porcentaje" | "monto" | "envio_gratis";
  valor: number;
  alcance: "todo" | "categorias" | "productos";
  /** ids de categoría, con las subcategorías de las elegidas ya sumadas */
  categorias: Set<number>;
  productos: Set<number>;
  sobreRebajas: boolean;
  minimo: number;
  desde: Date | null;
  hasta: Date | null;
  usosMax: number | null;
  usosPorCliente: number | null;
  usos: number;
  activo: boolean;
}

export interface LineaParaCupon {
  sku: string;
  productoId: number;
  /** por unidad, ya con la rebaja de la prenda */
  precio: number;
  /** tiene rebaja (descuento masivo) */
  rebajada: boolean;
  cantidad: number;
}

export interface CuponAplicado {
  cupon: Cupon;
  descuento: number;
  /** descuento por unidad de cada SKU */
  porUnidad: Map<string, number>;
  envioGratis: boolean;
}

/** Normaliza lo que escribe el cliente: " verano10 " → "VERANO10". */
export const normalizarCodigo = (s: string) => s.trim().toUpperCase().replace(/\s+/g, "");
export const CODIGO = /^[A-Z0-9][A-Z0-9_-]{2,29}$/;

const SELECT = `
  SELECT c.id, c.codigo, c.nombre, c.automatico, c.tipo, c.valor, c.alcance, c.producto_ids, c.sobre_rebajas, c.minimo,
         c.desde, c.hasta, c.usos_max, c.usos_por_cliente, c.usos, c.activo,
         -- una categoría de arriba incluye sus subcategorías
         COALESCE((SELECT array_agg(k.id) FROM tienda.categorias k WHERE k.id = ANY(c.categoria_ids) OR k.padre_id = ANY(c.categoria_ids)), '{}') AS categoria_ids
    FROM tienda.cupones c`;

interface FilaCupon {
  id: number; codigo: string | null; nombre: string; automatico: boolean; tipo: Cupon["tipo"]; valor: number; alcance: Cupon["alcance"];
  producto_ids: number[]; categoria_ids: number[]; sobre_rebajas: boolean; minimo: number; desde: Date | null; hasta: Date | null;
  usos_max: number | null; usos_por_cliente: number | null; usos: number; activo: boolean;
}
const aCupon = (r: FilaCupon): Cupon => ({
  id: r.id, codigo: r.codigo, nombre: r.nombre, automatico: r.automatico, tipo: r.tipo, valor: r.valor, alcance: r.alcance,
  categorias: new Set(r.categoria_ids), productos: new Set(r.producto_ids), sobreRebajas: r.sobre_rebajas, minimo: r.minimo,
  desde: r.desde, hasta: r.hasta, usosMax: r.usos_max, usosPorCliente: r.usos_por_cliente, usos: r.usos, activo: r.activo,
});

export async function buscarCupon(db: pg.Pool | pg.PoolClient, codigo: string, bloquear = false): Promise<Cupon | null> {
  const { rows } = await db.query<FilaCupon>(`${SELECT} WHERE c.codigo = $1${bloquear ? " FOR UPDATE OF c" : ""}`, [codigo]);
  return rows[0] ? aCupon(rows[0]) : null;
}

export async function promocionesVigentes(db: pg.Pool | pg.PoolClient): Promise<Cupon[]> {
  const { rows } = await db.query<FilaCupon>(
    `${SELECT} WHERE c.automatico AND c.activo AND (c.desde IS NULL OR c.desde <= now()) AND (c.hasta IS NULL OR c.hasta > now())
        AND (c.usos_max IS NULL OR c.usos < c.usos_max) ORDER BY c.id`);
  return rows.map(aCupon);
}

/** Categorías de cada producto (sólo si algún cupón las necesita). */
export async function categoriasDe(db: pg.Pool | pg.PoolClient, ids: number[]): Promise<Map<number, number[]>> {
  const m = new Map<number, number[]>();
  if (!ids.length) return m;
  const { rows } = await db.query<{ producto_id: number; categoria_id: number }>(
    "SELECT producto_id, categoria_id FROM tienda.producto_categorias WHERE producto_id = ANY($1::int[])", [ids]);
  for (const r of rows) m.set(r.producto_id, [...(m.get(r.producto_id) ?? []), r.categoria_id]);
  return m;
}

/** ¿Está vigente? Devuelve el motivo si no (lo que se le dice al cliente). */
export function motivoNoVigente(c: Cupon, ahora = new Date()): string | null {
  if (!c.activo) return "Ese cupón ya no está vigente.";
  if (c.desde && c.desde > ahora) return "Ese cupón todavía no está vigente.";
  if (c.hasta && c.hasta <= ahora) return "Ese cupón venció.";
  if (c.usosMax !== null && c.usos >= c.usosMax) return "Ese cupón ya se usó el máximo de veces.";
  return null;
}

/*
 * Aplica un cupón a las líneas del carrito. Devuelve el resultado o el
 * motivo por el que no aplica. `subtotal` es el de todo el carrito (con
 * rebajas): contra eso se mira la compra mínima.
 */
export function aplicarCupon(
  c: Cupon, lineas: LineaParaCupon[], subtotal: number, categorias: Map<number, number[]>,
): CuponAplicado | { error: string } {
  if (c.minimo > 0 && subtotal < c.minimo) {
    return { error: `${c.codigo ? "Este cupón" : "Esta promoción"} es para compras desde ${formatearPesos(c.minimo)} (te faltan ${formatearPesos(c.minimo - subtotal)}).` };
  }
  const entra = (l: LineaParaCupon) =>
    (c.sobreRebajas || !l.rebajada)
    && (c.alcance === "todo"
      || (c.alcance === "productos" && c.productos.has(l.productoId))
      || (c.alcance === "categorias" && (categorias.get(l.productoId) ?? []).some((k) => c.categorias.has(k))));
  const elegibles = lineas.filter(entra);
  if (c.tipo === "envio_gratis") {
    // El envío gratis pide que la compra tenga algo del alcance (si el alcance no es "todo").
    if (!elegibles.length) return { error: "Este cupón no aplica a los productos de tu carrito." };
    return { cupon: c, descuento: 0, porUnidad: new Map(), envioGratis: true };
  }
  if (!elegibles.length) {
    return { error: c.sobreRebajas || !lineas.some((l) => l.rebajada) ? "Este cupón no aplica a los productos de tu carrito." : "Este cupón no aplica a prendas que ya están en oferta." };
  }
  const porUnidad = new Map<string, number>();
  if (c.tipo === "porcentaje") {
    for (const l of elegibles) porUnidad.set(l.sku, l.precio - conDescuento(centavos(l.precio), c.valor));
  } else {
    // Monto fijo: se reparte en proporción a lo que pesa cada línea, por unidad y al peso.
    const base = elegibles.reduce((s, l) => s + l.precio * l.cantidad, 0);
    const monto = Math.min(c.valor, base);
    for (const l of elegibles) {
      const deLinea = Math.floor((monto * l.precio * l.cantidad) / base);
      const unidad = Math.min(l.precio, Math.floor(deLinea / l.cantidad / 100) * 100);
      porUnidad.set(l.sku, unidad);
    }
  }
  const descuento = elegibles.reduce((s, l) => s + (porUnidad.get(l.sku) ?? 0) * l.cantidad, 0);
  if (descuento <= 0) return { error: "Este cupón no descuenta nada en este carrito." };
  return { cupon: c, descuento, porUnidad, envioGratis: false };
}

/*
 * Elige qué se aplica: UNO solo, el que más le descuenta al cliente entre el
 * cupón que escribió (si sirve) y las promociones automáticas. `envio` es lo
 * que costaría el envío (para comparar uno de envío gratis). Si escribió un
 * cupón y no se usa, `error` dice por qué.
 */
export function elegir(
  escrito: Cupon | null, promociones: Cupon[], lineas: LineaParaCupon[], subtotal: number,
  categorias: Map<number, number[]>, envio: number,
): { aplicado: CuponAplicado | null; error: string | null } {
  const valor = (a: CuponAplicado) => a.descuento + (a.envioGratis ? envio : 0);
  let mejor: CuponAplicado | null = null;
  for (const p of promociones) {
    const r = aplicarCupon(p, lineas, subtotal, categorias);
    if ("cupon" in r && (!mejor || valor(r) > valor(mejor))) mejor = r;
  }
  if (!escrito) return { aplicado: mejor, error: null };
  const r = aplicarCupon(escrito, lineas, subtotal, categorias);
  if (!("cupon" in r)) return { aplicado: mejor, error: r.error };
  // Empate: gana el que escribió.
  if (mejor && valor(mejor) > valor(r)) {
    return { aplicado: mejor, error: `La promoción «${mejor.cupon.nombre}» te descuenta más que el cupón, así que se aplica esa (no se suman).` };
  }
  return { aplicado: r, error: null };
}
