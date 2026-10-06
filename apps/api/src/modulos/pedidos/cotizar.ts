import type pg from "pg";
import { conRebaja, type Descuentos } from "../../lib/descuentos.js";
import { buscarCupon, categoriasDe, CODIGO, elegir, motivoNoVigente, normalizarCodigo, promocionesVigentes, type CuponAplicado, type LineaParaCupon } from "../../lib/cupones.js";
import { centavos, conDescuento, formatearPesos, Packs, PACKS_POR_DEFECTO, porcentajePack, type Cotizacion, type ItemCarrito, type LineaCotizada, type MedioPago } from "@isu/shared";

/*
 * El precio lo pone la tienda, no el navegador.
 *
 * Se recalcula todo con lo que dice la base en este momento: precio de cada
 * variante (copia de Stocker), stock, cupón, descuento por transferencia,
 * envío y monto mínimo. Lo que manda el carrito es sólo "qué SKU y cuántos"
 * (y el código de cupón que escribió el cliente).
 *
 * Orden: precio de la prenda (con su rebaja o el % del pack) → cupón →
 * transferencia → envío.
 *
 * Packs (etapa 8): las prendas marcadas como pack llevan un % según cuántas
 * unidades de ESA prenda hay en el carrito (2 a 5, cualquier talle y
 * color). No se suma a la rebaja de la prenda: gana el mayor de los dos.
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
  /** % por llevar 2, 3, 4 y 5 de una prenda pack */
  packs: number[];
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
  if (!Packs.safeParse(a.packs).success) a.packs = PACKS_POR_DEFECTO;
  return a as unknown as Ajustes;
}

export interface Fila {
  sku: string; precio: number; stock: number; talle: string | null; color: string | null; nombre: string; slug: string;
  producto_id: number; foto: string | null; peso_gramos: number | null; pack: boolean;
}

export interface Cotizado extends Cotizacion {
  filas: Map<string, Fila>;
  /** lo que se cobra por unidad de cada SKU, con el cupón repartido */
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
  // El mismo SKU dos veces se suma.
  const pedidos = new Map<string, number>();
  for (const i of items) pedidos.set(i.sku, (pedidos.get(i.sku) ?? 0) + i.cantidad);

  const { rows } = await pool.query<Fila>(
    `SELECT v.sku, v.precio, v.stock, v.talle, c.nombre AS color, p.nombre, p.slug, p.id AS producto_id, p.peso_gramos, p.pack,
            (SELECT f.clave FROM tienda.fotos f WHERE f.producto_id = p.id
               ORDER BY (f.tipo = 'color' AND f.color_id = v.color_id) DESC, (f.tipo = 'exhibicion') DESC, f.orden, f.id LIMIT 1) AS foto
       FROM tienda.variantes v
       JOIN tienda.productos p ON p.id = v.producto_id AND p.visible AND p.en_stocker
       LEFT JOIN tienda.producto_colores c ON c.id = v.color_id
      WHERE v.sku = ANY($1::text[]) AND v.activo`,
    [[...pedidos.keys()]],
  );
  const filas = new Map(rows.map((r) => [r.sku, r]));
  // Descuentos masivos del backoffice: el precio que se cobra es el rebajado.
  const rebajas = opciones.descuentos ? await opciones.descuentos.para([...new Set(rows.map((r) => r.producto_id))]) : new Map<number, number>();
  // Packs: cuántas unidades de cada prenda pack hay en el carrito (cualquier talle y color).
  const unidadesPack = new Map<number, number>();
  for (const [sku, cantidad] of pedidos) {
    const f = filas.get(sku);
    if (f?.pack) unidadesPack.set(f.producto_id, (unidadesPack.get(f.producto_id) ?? 0) + cantidad);
  }

  const lineas: LineaCotizada[] = [];
  const paraCupon: LineaParaCupon[] = [];
  const problemas: Cotizacion["problemas"] = [];
  let subtotal = 0;
  for (const [sku, cantidad] of pedidos) {
    const f = filas.get(sku);
    if (!f) { problemas.push({ sku, tipo: "no_existe", mensaje: "Este artículo ya no está a la venta." }); continue; }
    const disponible = Math.min(f.stock, 20);
    const rebaja = rebajas.get(f.producto_id) ?? 0;
    const unidades = f.pack ? unidadesPack.get(f.producto_id) ?? 0 : 0;
    const pctPack = porcentajePack(a.packs, unidades);
    // No se suman: gana el mayor.
    const pct = Math.max(rebaja, pctPack);
    const precio = conRebaja(f.precio, pct);
    lineas.push({
      sku, productoSlug: f.slug, nombre: f.nombre, color: f.color && f.color !== "Único" ? f.color : null, talle: f.talle,
      foto: f.foto, precio, precioLista: pct ? f.precio : null, cantidad, disponible, subtotal: precio * cantidad,
      pack: pctPack > 0 && pctPack >= rebaja ? { unidades, porcentaje: pctPack } : null,
    });
    if (f.stock === 0) problemas.push({ sku, tipo: "sin_stock", mensaje: `${f.nombre}${f.talle ? ` (${f.talle})` : ""}: se agotó.` });
    else if (cantidad > f.stock) problemas.push({ sku, tipo: "stock_insuficiente", mensaje: `${f.nombre}${f.talle ? ` (${f.talle})` : ""}: quedan ${f.stock}.` });
    else {
      subtotal += precio * cantidad;
      paraCupon.push({ sku, productoId: f.producto_id, precio, rebajada: pct > 0, cantidad });
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
  const cobrado = new Map(lineas.map((l) => [l.sku, l.precio - (aplicado?.porUnidad.get(l.sku) ?? 0)]));

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
    lineas, subtotal,
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
