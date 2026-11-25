import type pg from "pg";
import { centavos, conDescuento, formatearPesos } from "@isu/shared";

/*
 * Cupones y promociones por monto (tabla tienda.cupones, ver 0011).
 *
 * Reglas:
 *   · se calcula sobre el precio que ya tiene la rebaja de la prenda; el
 *     descuento por transferencia va después, sobre lo que queda
 *   · un cupón que NO acumula (Navidad…) no se suma a la rebaja de la prenda: en cada prenda rige el mejor precio
 *     para el cliente (el cupón se calcula sobre el precio de lista y sólo cuenta lo que mejora la rebaja)
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
  tipo: "porcentaje" | "monto" | "envio_gratis" | "mezcla" | "segunda_unidad";
  valor: number;
  alcance: "todo" | "categorias" | "productos";
  /** ids de categoría, con las subcategorías de las elegidas ya sumadas */
  categorias: Set<number>;
  productos: Set<number>;
  sobreRebajas: boolean;
  /** false = no se suma a la rebaja de la prenda: en cada prenda rige el mejor precio para el cliente */
  acumula: boolean;
  minimo: number;
  /** porcentaje: el descuento no pasa de esto (centavos); null = sin tope */
  tope: number | null;
  /** mezcla: con N prendas elegibles o más, K a precio mayorista (el tramo más alto que alcance) */
  escala: Array<{ desde: number; mayorista: number }>;
  /** mezcla: máximo de prendas a mayorista por compra */
  maxMayorista: number;
  /** cupón personal (ruleta): sólo lo puede usar esa cuenta; null = de cualquiera */
  clienteId: number | null;
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
  /** por unidad, sin ninguna rebaja (el precio de lista) */
  lista: number;
  /** precio mayorista (el piso); null = no cargado. Dato interno: no sale de la API. */
  mayorista: number | null;
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
  /** mezcla: lo que se le cuenta al cliente (sin el precio mayorista) */
  mezcla?: { unidades: number; mayorista: number; ahorro: number; faltan: number | null; siguiente: number | null };
}

/** Normaliza lo que escribe el cliente: " verano10 " → "VERANO10". */
export const normalizarCodigo = (s: string) => s.trim().toUpperCase().replace(/\s+/g, "");
export const CODIGO = /^[A-Z0-9][A-Z0-9_-]{2,29}$/;

const SELECT = `
  SELECT c.id, c.codigo, c.nombre, c.automatico, c.tipo, c.valor, c.alcance, c.producto_ids, c.sobre_rebajas, c.acumula, c.minimo, c.tope, c.escala, c.max_mayorista,
         c.cliente_id, c.desde, c.hasta, c.usos_max, c.usos_por_cliente, c.usos,
         -- el de un evento (Navidad…) sólo está activo mientras el evento esté vigente
         (c.activo AND (c.evento_id IS NULL OR tienda.evento_vigente(c.evento_id))) AS activo,
         -- una categoría de arriba incluye sus subcategorías
         COALESCE((SELECT array_agg(k.id) FROM tienda.categorias k WHERE k.id = ANY(c.categoria_ids) OR k.padre_id = ANY(c.categoria_ids)), '{}') AS categoria_ids
    FROM tienda.cupones c`;

interface FilaCupon {
  id: number; codigo: string | null; nombre: string; automatico: boolean; tipo: Cupon["tipo"]; valor: number; alcance: Cupon["alcance"];
  producto_ids: number[]; categoria_ids: number[]; sobre_rebajas: boolean; acumula: boolean; minimo: number; tope: string | null; escala: Array<{ desde: number; mayorista: number }> | null; max_mayorista: number; cliente_id: number | null; desde: Date | null; hasta: Date | null;
  usos_max: number | null; usos_por_cliente: number | null; usos: number; activo: boolean;
}
const aCupon = (r: FilaCupon): Cupon => ({
  id: r.id, codigo: r.codigo, nombre: r.nombre, automatico: r.automatico, tipo: r.tipo, valor: r.valor, alcance: r.alcance,
  categorias: new Set(r.categoria_ids), productos: new Set(r.producto_ids), sobreRebajas: r.sobre_rebajas, acumula: r.acumula, minimo: r.minimo, tope: r.tope === null ? null : Number(r.tope),
  escala: r.escala ?? [], maxMayorista: r.max_mayorista, clienteId: r.cliente_id,
  desde: r.desde, hasta: r.hasta, usosMax: r.usos_max, usosPorCliente: r.usos_por_cliente, usos: r.usos, activo: r.activo,
});

export async function buscarCupon(db: pg.Pool | pg.PoolClient, codigo: string, bloquear = false): Promise<Cupon | null> {
  const { rows } = await db.query<FilaCupon>(`${SELECT} WHERE c.codigo = $1${bloquear ? " FOR UPDATE OF c" : ""}`, [codigo]);
  return rows[0] ? aCupon(rows[0]) : null;
}

export async function promocionesVigentes(db: pg.Pool | pg.PoolClient): Promise<Cupon[]> {
  const { rows } = await db.query<FilaCupon>(
    `${SELECT} WHERE c.automatico AND c.activo AND (c.evento_id IS NULL OR tienda.evento_vigente(c.evento_id)) AND (c.desde IS NULL OR c.desde <= now()) AND (c.hasta IS NULL OR c.hasta > now())
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
    (c.sobreRebajas || !c.acumula || !l.rebajada)
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
  // El piso: el descuento de una línea nunca pasa de (precio − mayorista) por unidad. Sin mayorista cargado,
  // o con un mayorista que no está por debajo del precio, no se puede verificar y la línea no recibe descuento.
  const pisoUnidad = (l: LineaParaCupon) => (l.mayorista !== null && l.mayorista < l.precio ? l.precio - l.mayorista : 0);
  const descontables = elegibles.filter((l) => pisoUnidad(l) > 0);
  const porUnidad = new Map<string, number>();
  let mezcla: CuponAplicado["mezcla"];
  if (c.tipo === "mezcla") {
    // Unidades elegibles de todas las líneas: el tramo más alto que alcance dice cuántas van a mayorista (hasta el máximo).
    const unidades = elegibles.reduce((s, l) => s + l.cantidad, 0);
    const escala = [...c.escala].sort((x, y) => x.desde - y.desde);
    const tramo = escala.filter((t) => t.desde <= unidades).at(-1);
    const sig = escala.find((t) => t.desde > unidades);
    const k = Math.min(tramo?.mayorista ?? 0, c.maxMayorista);
    if (!k) {
      const falta = sig ? sig.desde - unidades : null;
      const cuantas = Math.min(sig?.mayorista ?? 1, c.maxMayorista);
      return { error: falta
        ? `Sumá ${falta} ${falta === 1 ? "prenda más" : "prendas más"} y ${cuantas === 1 ? "la más barata va" : `las ${cuantas} más baratas van`} a precio mayorista.`
        : "Este cupón no aplica a estas prendas." };
    }
    // Las K unidades más baratas (por precio ya rebajado) que tengan piso verificable.
    let quedan = k;
    const porLinea = new Map<string, number>();
    for (const l of [...descontables].sort((x, y) => x.precio - y.precio)) {
      const n = Math.min(l.cantidad, quedan);
      if (n > 0) { porLinea.set(l.sku, n * pisoUnidad(l)); quedan -= n; }
    }
    const bruto = [...porLinea.values()].reduce((s, d) => s + d, 0);
    // Con tope: se achica en proporción, sin pasarse.
    if (c.tope !== null && bruto > c.tope) {
      for (const [sku, d] of porLinea) porLinea.set(sku, Math.floor((c.tope * d) / bruto));
    }
    // Por unidad, al peso hacia abajo y sin pasar del piso: el total nunca supera lo que corresponde.
    for (const l of descontables) {
      const d = porLinea.get(l.sku) ?? 0;
      porUnidad.set(l.sku, Math.min(pisoUnidad(l), Math.floor(d / l.cantidad / 100) * 100));
    }
    const llevadas = k - quedan;
    const ahorro = descontables.reduce((s, l) => s + (porUnidad.get(l.sku) ?? 0) * l.cantidad, 0);
    mezcla = { unidades, mayorista: llevadas, ahorro, faltan: sig ? sig.desde - unidades : null, siguiente: sig ? Math.min(sig.mayorista, c.maxMayorista) : null };
  } else {
    // Reparte `total` en proporción a lo que pesa cada línea, por unidad y al peso, sin pasar del piso de cada una.
    const repartir = (total: number) => {
      const base = descontables.reduce((s, l) => s + l.precio * l.cantidad, 0);
      const monto = Math.min(total, base);
      for (const l of descontables) {
        const deLinea = Math.floor((monto * l.precio * l.cantidad) / base);
        porUnidad.set(l.sku, Math.min(pisoUnidad(l), Math.floor(deLinea / l.cantidad / 100) * 100));
      }
    };
    // Sin acumular, el % se calcula sobre el precio de lista y sólo cuenta lo que mejora la rebaja que la prenda ya tiene:
    // en cada prenda rige el mejor precio para el cliente, nunca los dos descuentos juntos.
    const base = (l: LineaParaCupon) => (c.acumula ? l.precio : l.lista);
    const mejora = (l: LineaParaCupon) => Math.max(0, Math.min(pisoUnidad(l), l.precio - conDescuento(centavos(base(l)), c.valor)));
    if (c.tipo === "segunda_unidad") {
      // Pares de a dos entre todas las prendas elegibles, de la más cara a la más barata: la más barata de cada par lleva el %.
      const unidades = elegibles.flatMap((l) => Array.from({ length: l.cantidad }, () => l)).sort((x, y) => y.precio - x.precio || (x.sku < y.sku ? -1 : 1));
      const total = new Map<string, number>();
      for (let i = 1; i < unidades.length; i += 2) {
        const l = unidades[i]!;
        total.set(l.sku, (total.get(l.sku) ?? 0) + mejora(l));
      }
      // Por unidad de la línea, al peso hacia abajo (el total nunca pasa de lo que corresponde).
      for (const l of elegibles) porUnidad.set(l.sku, Math.floor((total.get(l.sku) ?? 0) / l.cantidad / 100) * 100);
    } else if (c.tipo === "porcentaje") {
      for (const l of descontables) porUnidad.set(l.sku, mejora(l));
      // Con tope: si el porcentaje se pasa, el descuento queda en el tope (repartido igual que un monto).
      if (c.tope !== null && descontables.reduce((s, l) => s + (porUnidad.get(l.sku) ?? 0) * l.cantidad, 0) > c.tope) repartir(c.tope);
    } else repartir(c.valor);
  }
  const descuento = elegibles.reduce((s, l) => s + (porUnidad.get(l.sku) ?? 0) * l.cantidad, 0);
  // Sin piso verificable en ninguna prenda no se dice por qué: el precio mayorista no se muestra.
  if (descuento <= 0) {
    if (c.tipo === "segunda_unidad" && elegibles.reduce((n, l) => n + l.cantidad, 0) < 2) return { error: `Sumá otra prenda y la 2da unidad va al ${c.valor}% OFF.` };
    if (!c.acumula && elegibles.some((l) => l.rebajada && pisoUnidad(l) > 0)) return { error: "Tus prendas ya tienen un descuento mejor que esta promoción (no se suman)." };
    return { error: descontables.length ? "Este cupón no descuenta nada en este carrito." : "Este cupón no aplica a estas prendas." };
  }
  return { cupon: c, descuento, porUnidad, envioGratis: false, ...(mezcla ? { mezcla } : {}) };
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
