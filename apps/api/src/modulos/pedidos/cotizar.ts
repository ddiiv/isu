import type pg from "pg";
import { conRebaja, type Descuentos } from "../../lib/descuentos.js";
import { buscarCupon, categoriasDe, CODIGO, elegir, motivoNoVigente, normalizarCodigo, promocionesVigentes, type CuponAplicado, type LineaParaCupon } from "../../lib/cupones.js";
import {
  centavos, clavePack, conDescuento, esPack, formatearPesos, leerPacks, MAX_PACKS_POR_LINEA, PACKS_POR_DEFECTO, porcentajePack,
  type AjustePacks, type Cotizacion, type ItemCarrito, type LineaCotizada, type MedioPago, type PackCotizado,
} from "@isu/shared";

/*
 * El precio lo pone la tienda, no el navegador.
 *
 * Se recalcula todo con lo que dice la base en este momento: precio de cada
 * variante (copia de Stocker), stock, cupón, descuento por transferencia,
 * envío y monto mínimo. Lo que manda el carrito es sólo "qué SKU y cuántos"
 * (o qué lleva cada pack y cuántos) y el código de cupón que escribió el
 * cliente.
 *
 * Orden: precio de la prenda (con su rebaja o el % del pack) → cupón →
 * transferencia → envío.
 *
 * Packs (etapa 10): un pack es una línea aparte, como en las tiendas de
 * referencia. Lleva prendas de UNA prenda marcada como pack (cada una con su
 * talle y color) y el % según cuántas lleva (del mínimo al máximo de Ajustes
 * → Packs). Las prendas sueltas van a su precio aunque sean la misma prenda:
 * no suman para el pack. Dentro del pack, el % no se suma a la rebaja de la
 * prenda: gana el mayor. El stock se controla con lo suelto más lo de los packs.
 */
export interface Ajustes {
  montoMinimoCarrito: number;
  envioGratisDesde: number | null;
  costoEnvio: number;
  descuentoTransferencia: number;
  horasPagoOnline: number;
  horasPagoFacil: number;
  horasTransferencia: number;
  horasPagoLocal: number;
  datosTransferencia: { titular: string; cuit: string; banco: string; cbu: string; alias: string };
  locales: Array<{ nombre: string; retiro: boolean }>;
  /** cuántas prendas lleva un pack (mínimo y máximo) y el % por cada cantidad */
  packs: AjustePacks;
}

const POR_DEFECTO: Ajustes = {
  montoMinimoCarrito: 0, envioGratisDesde: null, costoEnvio: 790_000, descuentoTransferencia: 20,
  horasPagoOnline: 2, horasPagoFacil: 72, horasTransferencia: 48, horasPagoLocal: 72,
  datosTransferencia: { titular: "", cuit: "", banco: "", cbu: "", alias: "" }, locales: [],
  packs: PACKS_POR_DEFECTO,
};

export async function leerAjustes(pool: pg.Pool): Promise<Ajustes> {
  const { rows } = await pool.query<{ clave: string; valor: unknown }>(
    "SELECT clave, valor FROM tienda.ajustes WHERE clave = ANY($1::text[])", [Object.keys(POR_DEFECTO)],
  );
  const a: Record<string, unknown> = { ...POR_DEFECTO };
  for (const r of rows) {
    const d = POR_DEFECTO[r.clave as keyof Ajustes];
    // Un ajuste con el tipo equivocado se ignora: mejor el valor por defecto que un total mal calculado.
    if (d === null ? (r.valor === null || typeof r.valor === "number") : typeof r.valor === typeof d) a[r.clave] = r.valor;
  }
  // El formato viejo ([x2, x3, x4, x5]) también sirve; uno roto, el de fábrica.
  a.packs = leerPacks(a.packs);
  return a as unknown as Ajustes;
}

export interface Fila {
  sku: string; precio: number; stock: number; talle: string | null; color: string | null; nombre: string; slug: string;
  producto_id: number; foto: string | null; peso_gramos: number | null; pack: boolean;
}

export interface Cotizado extends Cotizacion {
  filas: Map<string, Fila>;
  /** lo que se cobra por unidad de cada línea (por `clave`), con el cupón repartido */
  cobrado: Map<string, number>;
  aplicado: CuponAplicado | null;
  /** productos − cupón − transferencia (sin envío) */
  neto: number;
  /** escribió un código y no se pudo usar (no existe, venció, no alcanza el mínimo…) */
  cuponInvalido: boolean;
  envioBonificado: number;
}

export async function cotizar(
  pool: pg.Pool,
  items: ItemCarrito[],
  opciones: { entrega?: "envio" | "retiro"; medioPago?: MedioPago; ajustes?: Ajustes; descuentos?: Descuentos; cupon?: string | null; email?: string | null } = {},
): Promise<Cotizado> {
  const a = opciones.ajustes ?? await leerAjustes(pool);
  // Sueltas: el mismo SKU dos veces se suma. Packs: la misma composición dos veces, también.
  const sueltas = new Map<string, number>();
  const grupos = new Map<string, { prendas: Map<string, number>; cantidad: number }>();
  for (const i of items) {
    if (!esPack(i)) { sueltas.set(i.sku, (sueltas.get(i.sku) ?? 0) + i.cantidad); continue; }
    const clave = clavePack(i.pack);
    const g = grupos.get(clave);
    if (g) g.cantidad = Math.min(MAX_PACKS_POR_LINEA, g.cantidad + i.cantidad);
    else {
      const prendas = new Map<string, number>();
      for (const x of i.pack) prendas.set(x.sku, (prendas.get(x.sku) ?? 0) + x.cantidad);
      grupos.set(clave, { prendas, cantidad: i.cantidad });
    }
  }
  const todos = new Set([...sueltas.keys(), ...[...grupos.values()].flatMap((g) => [...g.prendas.keys()])]);

  const { rows } = await pool.query<Fila>(
    `SELECT v.sku, v.precio, v.stock, v.talle, c.nombre AS color, p.nombre, p.slug, p.id AS producto_id, p.peso_gramos, p.pack,
            (SELECT f.clave FROM tienda.fotos f WHERE f.producto_id = p.id
               ORDER BY (f.tipo = 'color' AND f.color_id = v.color_id) DESC, (f.tipo = 'exhibicion') DESC, f.orden, f.id LIMIT 1) AS foto
       FROM tienda.variantes v
       JOIN tienda.productos p ON p.id = v.producto_id AND p.visible AND p.en_stocker
       LEFT JOIN tienda.producto_colores c ON c.id = v.color_id
      WHERE v.sku = ANY($1::text[]) AND v.activo`,
    [[...todos]],
  );
  const filas = new Map(rows.map((r) => [r.sku, r]));
  // Descuentos masivos del backoffice: el precio que se cobra es el rebajado.
  const rebajas = opciones.descuentos ? await opciones.descuentos.para([...new Set(rows.map((r) => r.producto_id))]) : new Map<number, number>();
  const colorDe = (f: Fila) => (f.color && f.color !== "Único" ? f.color : null);
  const nombreDe = (f: Fila) => `${f.nombre}${f.talle ? ` (${f.talle})` : ""}`;

  // Un pack es de UNA prenda marcada como pack, con una cantidad de prendas del rango de Ajustes.
  const problemas: Cotizacion["problemas"] = [];
  for (const [clave, g] of [...grupos]) {
    const fs = [...g.prendas.keys()].map((sku) => filas.get(sku));
    const unidades = [...g.prendas.values()].reduce((t, n) => t + n, 0);
    const f0 = fs[0];
    const motivo = fs.some((f) => !f) || !f0 ? "Algo de este pack ya no está a la venta."
      : !f0.pack || fs.some((f) => f!.producto_id !== f0.producto_id) ? `${f0.nombre}: ya no se vende en pack.`
        : unidades < a.packs.minimo || unidades > a.packs.maximo ? `Los packs son de ${a.packs.minimo} a ${a.packs.maximo} prendas.`
          : null;
    if (motivo) { problemas.push({ sku: clave, tipo: "pack", mensaje: motivo }); grupos.delete(clave); }
  }

  // Cuántas pide de cada SKU entre sueltas y packs: el stock se controla con el total.
  const pedidas = new Map<string, number>(sueltas);
  for (const g of grupos.values()) for (const [sku, n] of g.prendas) pedidas.set(sku, (pedidas.get(sku) ?? 0) + n * g.cantidad);

  const lineas: LineaCotizada[] = [];
  const packs: PackCotizado[] = [];
  const paraCupon: LineaParaCupon[] = [];
  const conProblema = new Set<string>();
  for (const [sku, total] of pedidas) {
    const f = filas.get(sku);
    if (!f) { problemas.push({ sku, tipo: "no_existe", mensaje: "Este artículo ya no está a la venta." }); conProblema.add(sku); }
    else if (f.stock === 0) { problemas.push({ sku, tipo: "sin_stock", mensaje: `${nombreDe(f)}: se agotó.` }); conProblema.add(sku); }
    else if (total > f.stock) { problemas.push({ sku, tipo: "stock_insuficiente", mensaje: `${nombreDe(f)}: quedan ${f.stock}.` }); conProblema.add(sku); }
  }
  let subtotal = 0;
  // Hasta cuántas puede llevar en una línea: el stock menos lo que ya se lleva en las otras
  // (la misma variante suelta y en un pack comparten el stock). Para el + del carrito.
  const libre = (sku: string, stock: number, enEstaLinea: number) => Math.max(0, stock - ((pedidas.get(sku) ?? 0) - enEstaLinea));

  for (const [sku, cantidad] of sueltas) {
    const f = filas.get(sku);
    if (!f) continue;
    const rebaja = rebajas.get(f.producto_id) ?? 0;
    const precio = conRebaja(f.precio, rebaja);
    lineas.push({
      sku, clave: sku, productoSlug: f.slug, nombre: f.nombre, color: colorDe(f), talle: f.talle,
      foto: f.foto, precio, precioLista: rebaja ? f.precio : null, cantidad, disponible: Math.min(libre(sku, f.stock, cantidad), 20), subtotal: precio * cantidad, pack: null,
    });
    if (!conProblema.has(sku)) {
      subtotal += precio * cantidad;
      paraCupon.push({ sku, productoId: f.producto_id, precio, rebajada: rebaja > 0, cantidad });
    }
  }

  for (const [clave, g] of grupos) {
    const prendas = [...g.prendas].map(([sku, n]) => ({ sku, n, f: filas.get(sku) }));
    const unidades = prendas.reduce((t, x) => t + x.n, 0);
    const f0 = prendas[0]!.f!;
    const rebaja = rebajas.get(f0.producto_id) ?? 0;
    const pctPack = porcentajePack(a.packs, unidades);
    const pct = Math.max(rebaja, pctPack);
    let precioPack = 0;
    let listaPack = 0;
    const detalle: PackCotizado["prendas"] = [];
    for (const { sku, n, f } of prendas) {
      const precio = conRebaja(f!.precio, pct);
      precioPack += precio * n;
      listaPack += f!.precio * n;
      detalle.push({ sku, color: colorDe(f!), talle: f!.talle, foto: f!.foto, cantidad: n, precio });
      lineas.push({
        sku, clave: `${clave}|${sku}`, productoSlug: f!.slug, nombre: f!.nombre, color: colorDe(f!), talle: f!.talle,
        foto: f!.foto, precio, precioLista: pct ? f!.precio : null, cantidad: n * g.cantidad, disponible: Math.min(libre(sku, f!.stock, n * g.cantidad), 20),
        subtotal: precio * n * g.cantidad, pack: { clave, unidades, porcentaje: pct },
      });
    }
    const disponible = Math.max(0, Math.min(MAX_PACKS_POR_LINEA, ...prendas.map((x) => Math.floor(libre(x.sku, x.f!.stock, x.n * g.cantidad) / x.n))));
    packs.push({
      clave, productoSlug: f0.slug, nombre: f0.nombre, foto: f0.foto, unidades, porcentaje: pct, cantidad: g.cantidad,
      precio: precioPack, precioLista: listaPack, subtotal: precioPack * g.cantidad, disponible, prendas: detalle,
    });
    if (!prendas.some((x) => conProblema.has(x.sku))) {
      subtotal += precioPack * g.cantidad;
      for (const { sku, n, f } of prendas) {
        // Para el cupón, cada prenda del pack es una línea con su clave: una prenda en pack cuenta como rebajada.
        paraCupon.push({ sku: `${clave}|${sku}`, productoId: f!.producto_id, precio: conRebaja(f!.precio, pct), rebajada: pct > 0, cantidad: n * g.cantidad });
      }
    }
  }

  // ── Cupón o promoción (uno solo) ──
  const envioBase = opciones.entrega === "envio" ? a.costoEnvio : 0;
  let aplicado: CuponAplicado | null = null;
  let avisoCupon: string | null = null;
  let cuponInvalido = false;
  let promoCerca: { nombre: string; falta: number } | null = null;
  const codigo = opciones.cupon ? normalizarCodigo(opciones.cupon) : "";
  if (subtotal > 0) {
    let escrito = null;
    if (codigo) {
      escrito = CODIGO.test(codigo) ? await buscarCupon(pool, codigo) : null;
      // Las promociones automáticas no se "escriben": no existen como código.
      if (!escrito || escrito.automatico) { avisoCupon = "Ese cupón no existe. Revisá que esté bien escrito."; escrito = null; }
      else {
        avisoCupon = motivoNoVigente(escrito);
        if (!avisoCupon && escrito.usosPorCliente !== null && opciones.email) {
          const usados = await pool.query<{ n: number }>(
            "SELECT count(*)::int AS n FROM tienda.cupon_usos WHERE cupon_id = $1 AND lower(email) = lower($2) AND vigente", [escrito.id, opciones.email]);
          if (usados.rows[0]!.n >= escrito.usosPorCliente) avisoCupon = escrito.usosPorCliente === 1 ? "Ya usaste este cupón." : `Ya usaste este cupón ${escrito.usosPorCliente} veces.`;
        }
        if (avisoCupon) escrito = null;
      }
    }
    const promos = await promocionesVigentes(pool);
    const usa = [escrito, ...promos].some((c) => c?.alcance === "categorias");
    const cats = usa ? await categoriasDe(pool, [...new Set(paraCupon.map((l) => l.productoId))]) : new Map<number, number[]>();
    const r = elegir(escrito, promos, paraCupon, subtotal, cats, envioBase);
    aplicado = r.aplicado;
    avisoCupon = avisoCupon ?? r.error;
    cuponInvalido = !!codigo && !avisoCupon?.startsWith("La promoción") && aplicado?.cupon.codigo !== codigo;
    // La promo de toda la tienda más cercana que todavía no alcanza: "te faltan $X para…".
    const cerca = promos.filter((p) => p.alcance === "todo" && p.minimo > subtotal && p.id !== aplicado?.cupon.id).sort((x, y) => x.minimo - y.minimo)[0];
    if (cerca) promoCerca = { nombre: cerca.nombre, falta: cerca.minimo - subtotal };
  }
  const descuentoCupon = aplicado?.descuento ?? 0;
  const cobrado = new Map(lineas.map((l) => [l.clave, l.precio - (aplicado?.porUnidad.get(l.clave) ?? 0)]));

  const trasCupon = subtotal - descuentoCupon;
  const descuento = opciones.medioPago === "transferencia" && trasCupon > 0
    ? trasCupon - conDescuento(centavos(trasCupon), a.descuentoTransferencia)
    : 0;
  const neto = trasCupon - descuento;
  const gratis = a.envioGratisDesde !== null && neto >= a.envioGratisDesde;
  const envioGratisCupon = !!aplicado?.envioGratis;
  const envio = opciones.entrega === "envio" && !gratis && !envioGratisCupon ? a.costoEnvio : 0;
  if (a.montoMinimoCarrito > 0 && subtotal < a.montoMinimoCarrito) {
    problemas.push({ sku: null, tipo: "minimo", mensaje: `La compra mínima es de ${formatearPesos(a.montoMinimoCarrito)}.` });
  }
  return {
    lineas, packs, subtotal,
    cupon: aplicado ? { codigo: aplicado.cupon.codigo, nombre: aplicado.cupon.nombre, envioGratis: aplicado.envioGratis } : null,
    descuentoCupon, avisoCupon, promoCerca,
    descuento, envio, total: neto + envio,
    envioGratisDesde: a.envioGratisDesde,
    faltaParaEnvioGratis: a.envioGratisDesde === null ? null : Math.max(0, a.envioGratisDesde - neto),
    montoMinimo: a.montoMinimoCarrito,
    problemas,
    filas, cobrado, aplicado, neto, cuponInvalido,
    envioBonificado: envioGratisCupon && opciones.entrega === "envio" && !gratis ? a.costoEnvio : 0,
  };
}

/*
 * Con el precio de la opción de envío elegida (transportes, etapa 4): el
 * envío gratis del cupón la deja en $0 (salvo Mercado Envíos, que lo cobra
 * Mercado Pago en su checkout y no pasa por la tienda).
 */
export function conEnvio(c: Cotizado, precio: number, o: { soloMercadoPago?: boolean } = {}) {
  if (c.aplicado?.envioGratis && o.soloMercadoPago) {
    // No descuenta nada: no se aplica (ni gasta un uso).
    c.aplicado = null;
    c.cupon = null;
    c.avisoCupon = "El envío gratis del cupón no aplica a Mercado Envíos (lo cobra Mercado Pago en su checkout).";
  }
  const bonifica = !!c.aplicado?.envioGratis;
  c.envio = o.soloMercadoPago || bonifica ? 0 : precio;
  c.envioBonificado = bonifica ? precio : 0;
  c.total = c.neto + c.envio;
  return c;
}
