import type pg from "pg";
import { NOMBRE_TRANSPORTE, type EnvioPublico, type EstadoEnvioTienda, type TransporteTienda } from "@isu/shared";
import type { Transportes } from "@isu/envios";

/*
 * Lo que el cliente ve de su envío: con qué viaja, el número y link del
 * transporte y todo lo que fue pasando.
 */
export async function envioPublico(pool: pg.Pool | pg.PoolClient, transportes: Transportes, pedido: {
  id: number; entrega: string; transporte: string | null; servicio_envio: string | null; sucursal_envio: { nombre?: string; direccion?: string } | null;
}): Promise<EnvioPublico | null> {
  if (pedido.entrega !== "envio" || !pedido.transporte) return null;
  const { rows } = await pool.query<{ id: number; seguimiento: string | null; estado: EstadoEnvioTienda }>(
    "SELECT id, seguimiento, estado FROM tienda.envios WHERE pedido_id = $1 AND activo", [pedido.id]);
  const e = rows[0];
  const eventos = e
    ? (await pool.query<{ fecha: Date; estado: EstadoEnvioTienda; descripcion: string; ubicacion: string | null }>(
      "SELECT fecha, estado, descripcion, ubicacion FROM tienda.envio_eventos WHERE envio_id = $1 ORDER BY fecha DESC, id DESC LIMIT 50", [e.id])).rows
    : [];
  const t = pedido.transporte as TransporteTienda | "estandar";
  const adaptador = t !== "estandar" ? transportes.adaptadores[t] : undefined;
  return {
    transporte: t,
    nombreTransporte: NOMBRE_TRANSPORTE[t],
    servicio: (pedido.servicio_envio ?? "domicilio") as EnvioPublico["servicio"],
    sucursal: pedido.sucursal_envio?.nombre ? { nombre: pedido.sucursal_envio.nombre, direccion: pedido.sucursal_envio.direccion ?? "" } : null,
    // Mercado Envíos: el número interno de Mercado Libre no le sirve al cliente (lo sigue desde acá).
    // Correo Argentino: hasta que se imprime el rótulo en MiCorreo no hay número.
    seguimiento: e?.seguimiento && t !== "mercado_envios" && t !== "cabify" ? e.seguimiento : null,
    url: e?.seguimiento && adaptador ? adaptador.urlSeguimiento(e.seguimiento) : null,
    estado: e?.estado ?? null,
    eventos: eventos.map((x) => ({ fecha: x.fecha.toISOString(), estado: x.estado, descripcion: x.descripcion, ubicacion: x.ubicacion })),
  };
}

export { firmaSeguimiento, firmaSeguimientoValida } from "@isu/envios";
