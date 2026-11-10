import type pg from "pg";
import { TIENDA_CERRADA_DE_FABRICA, TiendaCerrada } from "@isu/shared";
import { ErrorHttp } from "./errores.js";

/*
 * ¿La tienda está apagada (backoffice → Ajustes → Apagar la tienda)? Se lee de
 * la base en cada pedido, sin caché: quien tiene el checkout abierto no puede
 * seguir comprando ni un segundo después de apagarla. Un ajuste mal formado
 * cuenta como tienda abierta (igual que en /v1/config).
 */
export async function leerTiendaCerrada(pool: pg.Pool): Promise<TiendaCerrada> {
  const { rows } = await pool.query<{ valor: unknown }>("SELECT valor FROM tienda.ajustes WHERE clave = 'tiendaCerrada'");
  const r = TiendaCerrada.safeParse(rows[0]?.valor);
  return r.success ? r.data : TIENDA_CERRADA_DE_FABRICA;
}

/** Cotizar o crear una compra nueva con la tienda apagada: 503 con el mensaje del aviso. Los pedidos ya hechos no pasan por acá. */
export async function exigirTiendaAbierta(pool: pg.Pool): Promise<void> {
  const t = await leerTiendaCerrada(pool);
  if (t.activa) throw new ErrorHttp(503, "tienda_cerrada", t.mensaje, { titulo: t.titulo, vuelve: t.vuelve });
}
