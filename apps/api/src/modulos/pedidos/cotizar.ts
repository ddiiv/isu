import type pg from "pg";
import { conRebaja, type Descuentos } from "../../lib/descuentos.js";
import { centavos, conDescuento, formatearPesos, type Cotizacion, type ItemCarrito, type LineaCotizada, type MedioPago } from "@isu/shared";

/*
 * El precio lo pone la tienda, no el navegador.
 *
 * Se recalcula todo con lo que dice la base en este momento: precio de cada
 * variante (copia de Stocker), stock, descuento por transferencia, envío y
 * monto mínimo. Lo que manda el carrito es sólo "qué SKU y cuántos".
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
}

const POR_DEFECTO: Ajustes = {
  montoMinimoCarrito: 0, envioGratisDesde: null, costoEnvio: 790_000, descuentoTransferencia: 20,
  horasPagoOnline: 2, horasPagoFacil: 72, horasTransferencia: 48, horasPagoLocal: 72,
  datosTransferencia: { titular: "", cuit: "", banco: "", cbu: "", alias: "" }, locales: [],
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
  return a as unknown as Ajustes;
}

interface Fila {
  sku: string; precio: number; stock: number; talle: string | null; color: string | null; nombre: string; slug: string;
  producto_id: number; foto: string | null;
}

export async function cotizar(
  pool: pg.Pool,
  items: ItemCarrito[],
  opciones: { entrega?: "envio" | "retiro"; medioPago?: MedioPago; ajustes?: Ajustes; descuentos?: Descuentos } = {},
): Promise<Cotizacion & { filas: Map<string, Fila> }> {
  const a = opciones.ajustes ?? await leerAjustes(pool);
  // El mismo SKU dos veces se suma.
  const pedidos = new Map<string, number>();
  for (const i of items) pedidos.set(i.sku, (pedidos.get(i.sku) ?? 0) + i.cantidad);

  const { rows } = await pool.query<Fila>(
    `SELECT v.sku, v.precio, v.stock, v.talle, c.nombre AS color, p.nombre, p.slug, p.id AS producto_id,
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

  const lineas: LineaCotizada[] = [];
  const problemas: Cotizacion["problemas"] = [];
  let subtotal = 0;
  for (const [sku, cantidad] of pedidos) {
    const f = filas.get(sku);
    if (!f) { problemas.push({ sku, tipo: "no_existe", mensaje: "Este artículo ya no está a la venta." }); continue; }
    const disponible = Math.min(f.stock, 20);
    const pct = rebajas.get(f.producto_id) ?? 0;
    const precio = conRebaja(f.precio, pct);
    lineas.push({
      sku, productoSlug: f.slug, nombre: f.nombre, color: f.color && f.color !== "Único" ? f.color : null, talle: f.talle,
      foto: f.foto, precio, precioLista: pct ? f.precio : null, cantidad, disponible, subtotal: precio * cantidad,
    });
    if (f.stock === 0) problemas.push({ sku, tipo: "sin_stock", mensaje: `${f.nombre}${f.talle ? ` (${f.talle})` : ""}: se agotó.` });
    else if (cantidad > f.stock) problemas.push({ sku, tipo: "stock_insuficiente", mensaje: `${f.nombre}${f.talle ? ` (${f.talle})` : ""}: quedan ${f.stock}.` });
    else subtotal += precio * cantidad;
  }

  const descuento = opciones.medioPago === "transferencia" && subtotal > 0
    ? subtotal - conDescuento(centavos(subtotal), a.descuentoTransferencia)
    : 0;
  const neto = subtotal - descuento;
  const gratis = a.envioGratisDesde !== null && neto >= a.envioGratisDesde;
  const envio = opciones.entrega === "envio" && !gratis ? a.costoEnvio : 0;
  if (a.montoMinimoCarrito > 0 && subtotal < a.montoMinimoCarrito) {
    problemas.push({ sku: null, tipo: "minimo", mensaje: `La compra mínima es de ${formatearPesos(a.montoMinimoCarrito)}.` });
  }
  return {
    lineas, subtotal, descuento, envio, total: neto + envio,
    envioGratisDesde: a.envioGratisDesde,
    faltaParaEnvioGratis: a.envioGratisDesde === null ? null : Math.max(0, a.envioGratisDesde - neto),
    montoMinimo: a.montoMinimoCarrito,
    problemas,
    filas,
  };
}
