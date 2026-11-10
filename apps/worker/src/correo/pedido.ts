import type pg from "pg";
import { NOMBRE_TRANSPORTE } from "@isu/shared";

/*
 * El pedido completo para el PDF y el mail interno de venta. Sale de la base
 * (no viaja en el trabajo de la cola) y es de UN solo pedido: el del número.
 */
export interface PedidoVenta {
  numero: string; creadoEn: string; nombre: string; email: string; telefono: string; dni: string;
  entrega: "envio" | "retiro"; local: string | null;
  /** "Bacacay 3231, piso 2 · Flores (1406), CABA" */
  direccion: string | null;
  transporte: string | null; sucursal: string | null;
  medioPago: string; subtotal: number; descuentoCupon: number; cupon: string | null; descuento: number; envio: number; total: number;
  items: Array<{ nombre: string; color: string | null; talle: string | null; precio: number; cantidad: number }>;
}

const MEDIO: Record<string, string> = { mercadopago: "Mercado Pago", pagofacil: "Pago Fácil / Rapipago", transferencia: "Transferencia", local: "Pago en el local" };

interface FilaPedido {
  numero: string; creado_en: Date; nombre: string; apellido: string; email: string; telefono: string; dni: string;
  entrega: "envio" | "retiro"; local_retiro: string | null; direccion: Record<string, string> | null;
  transporte: string | null; sucursal_envio: { nombre?: string; direccion?: string } | null;
  medio_pago: string; subtotal: number; descuento_cupon: number; cupon_codigo: string | null; cupon_nombre: string | null;
  descuento: number; envio: number; total: number;
}

/** null si el pedido no existe. */
export async function cargarPedido(pool: pg.Pool, numero: string): Promise<PedidoVenta | null> {
  const p = (await pool.query<FilaPedido & { id: number }>(
    `SELECT id, numero, creado_en, nombre, apellido, email, telefono, dni, entrega, local_retiro, direccion, transporte, sucursal_envio,
            medio_pago, subtotal, descuento_cupon, cupon_codigo, cupon_nombre, descuento, envio, total
       FROM tienda.pedidos WHERE numero = $1`, [numero])).rows[0];
  if (!p) return null;
  const items = (await pool.query("SELECT nombre, color, talle, precio, cantidad FROM tienda.pedido_items WHERE pedido_id = $1 ORDER BY id", [p.id])).rows;
  const d = p.direccion;
  return {
    numero: p.numero, creadoEn: p.creado_en.toISOString(), nombre: `${p.nombre} ${p.apellido}`.trim(), email: p.email, telefono: p.telefono, dni: p.dni,
    entrega: p.entrega, local: p.local_retiro,
    direccion: d ? `${d.calle} ${d.numero}${d.piso ? `, ${d.piso}` : ""} · ${d.localidad} (${d.cp}), ${d.provincia}${d.indicaciones ? ` · ${d.indicaciones}` : ""}` : null,
    transporte: p.transporte ? (NOMBRE_TRANSPORTE as Record<string, string>)[p.transporte] ?? p.transporte : null,
    sucursal: p.sucursal_envio?.nombre ? `${p.sucursal_envio.nombre}${p.sucursal_envio.direccion ? ` · ${p.sucursal_envio.direccion}` : ""}` : null,
    medioPago: MEDIO[p.medio_pago] ?? p.medio_pago, subtotal: p.subtotal, descuentoCupon: p.descuento_cupon,
    cupon: p.cupon_nombre ? (p.cupon_codigo ? `cupón ${p.cupon_codigo} (${p.cupon_nombre})` : `promo ${p.cupon_nombre}`) : null,
    descuento: p.descuento, envio: p.envio, total: p.total, items,
  };
}
