import type pg from "pg";
import { ErrorStocker, type ClienteStocker } from "./cliente.js";

/*
 * Los cobros a Stocker (contrato v1 § 3.5).
 *
 * Stocker no despacha un pedido de la tienda hasta que esté cobrado. Cada pago
 * aprobado viaja como un cobro con su propio id (`isu:<pedido>-C<pago>`): el
 * mismo cobro reenviado no cobra dos veces, así que mandar de más no cuesta
 * nada y mandar de menos deja un paquete retenido.
 *
 * Por eso no alcanza con el trabajo de la cola: cada pago guarda cuándo lo
 * confirmó Stocker (`stocker_en`) y el barrido vuelve a mandar lo que quedó sin
 * confirmar (Redis perdió el trabajo, Stocker estuvo caído más que los
 * reintentos).
 *
 * Un cobro que Stocker entiende siempre vuelve 2xx. Si no lo pudo aplicar
 * (pedido ya cancelado, operación repetida) lo dice en `aplicado` y `motivo`:
 * queda escrito en el pedido para que una persona lo resuelva.
 */
interface FilaCobro { id: number; numero: string; pedido_id: number; proveedor: string; externo: string; monto: number; creado_en: Date }

export interface DepsCobros {
  pool: pg.Pool;
  stocker: ClienteStocker;
  log?: Pick<Console, "warn">;
}

const SELECT = `SELECT pg.id, p.numero, pg.pedido_id, pg.proveedor, pg.externo, pg.monto, pg.creado_en
                  FROM tienda.pagos pg JOIN tienda.pedidos p ON p.id = pg.pedido_id`;

export function crearCobros(d: DepsCobros) {
  const log = d.log ?? console;
  const evento = (pedidoId: number, detalle: string) =>
    d.pool.query(
      "INSERT INTO tienda.pedido_eventos (pedido_id, estado, detalle, actor) SELECT id, estado, $2, 'stocker' FROM tienda.pedidos WHERE id = $1",
      [pedidoId, detalle.slice(0, 500)],
    );

  async function mandar(f: FilaCobro) {
    let aplicado: boolean, motivo: string | null;
    try {
      const r = await d.stocker.registrarCobro({
        numero: f.numero, cobro: String(f.id), importe: f.monto / 100, medio: f.proveedor, operacion: f.externo, ocurrioEn: f.creado_en,
      });
      aplicado = r.aplicado;
      motivo = r.motivo;
    } catch (e) {
      // Stocker no tiene el pedido (nunca llegó a apartarse): no hay a qué aplicarlo, y reintentar no lo cambia.
      if (!(e instanceof ErrorStocker) || e.status !== 404) throw e;
      aplicado = false;
      motivo = "Stocker no tiene este pedido: el cobro no se pudo anotar.";
    }
    const r = await d.pool.query(
      "UPDATE tienda.pagos SET stocker_en = now(), stocker_aplicado = $2, stocker_motivo = $3 WHERE id = $1 AND stocker_en IS NULL",
      [f.id, aplicado, motivo?.slice(0, 500) ?? null],
    );
    if (!aplicado && r.rowCount) {
      await evento(f.pedido_id, `Stocker anotó el cobro de ${f.proveedor} sin aplicarlo: ${motivo ?? "revisalo en Stocker"}`);
      log.warn(`[stocker] cobro ${f.numero}-C${f.id} sin aplicar: ${motivo ?? ""}`);
    }
    return { pago: f.id, aplicado };
  }

  return {
    /** Los cobros de un pedido que Stocker todavía no confirmó (después de cada pago). */
    async delPedido(numero: string) {
      const { rows } = await d.pool.query<FilaCobro>(`${SELECT} WHERE p.numero = $1 AND pg.estado = 'aprobado' AND pg.stocker_en IS NULL ORDER BY pg.id`, [numero]);
      const out = [];
      for (const f of rows) out.push(await mandar(f));
      return { cobros: out.length, sinAplicar: out.filter((x) => !x.aplicado).length };
    },
    /** Barrido: lo que quedó sin confirmar (con unos minutos de gracia para el trabajo de la cola). */
    async pendientes(limite = 20) {
      const { rows } = await d.pool.query<FilaCobro>(
        `${SELECT} WHERE pg.estado = 'aprobado' AND pg.stocker_en IS NULL
                     AND pg.creado_en < now() - interval '2 minutes' AND pg.creado_en > now() - interval '30 days'
                   ORDER BY pg.creado_en LIMIT $1`, [limite]);
      let mandados = 0;
      for (const f of rows) {
        try { await mandar(f); mandados++; } catch (e) {
          log.warn(`[stocker] no se pudo mandar el cobro ${f.numero}-C${f.id}: ${(e as Error).message}`);
          break; // Stocker no contesta: no tiene sentido seguir probando con los demás ahora.
        }
      }
      return { pendientes: rows.length, mandados };
    },
  };
}
export type Cobros = ReturnType<typeof crearCobros>;
