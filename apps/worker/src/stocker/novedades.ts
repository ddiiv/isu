import type pg from "pg";
import { CLAVE_CURSOR_NOVEDADES } from "@isu/shared";
import type { CambioPedido, ClienteStocker } from "./cliente.js";

/*
 * Qué pasó con los pedidos en Stocker después de apartarlos (contrato v1 § 5 b):
 * el depósito despachó, no encontró la prenda, o el pedido se canceló (venció el
 * plazo de pago en Stocker, o alguien lo canceló allá).
 *
 * Pregunta la tienda cada minuto, desde el cursor de la vuelta anterior. El
 * cursor queda en tienda.ajustes y avanza recién después de aplicar cada tanda:
 * si el worker se cae a la mitad, la próxima vuelta repite esa tanda, y todo lo
 * que se aplica acá es idempotente. La primera vez Stocker no manda historia,
 * sólo el cursor de ahora.
 *
 * El despacho gana: un pedido cancelado que ya había salido viene como
 * «despachado» y así se trata (el cliente tiene el paquete en camino).
 */
const NUMERO = /^ISU-\d{4,10}$/;
/* Los que el vencimiento de la API libera solos si se les adelanta el plazo. */
const VENCIBLES = ["esperando_pago", "esperando_transferencia", "a_pagar_en_local"];
const COBRADOS = ["pagado", "listo_para_retirar"];

export interface DepsNovedades {
  pool: pg.Pool;
  stocker: ClienteStocker;
  /** Despachado o falta mercadería (idempotente): el de envíos. */
  despachado: (numero: string, que: "despachado" | "faltante") => Promise<{ cambio: boolean }>;
  log?: Pick<Console, "warn">;
}

export function crearNovedades(d: DepsNovedades) {
  const log = d.log ?? console;

  const cursor = async () => {
    const { rows } = await d.pool.query<{ valor: unknown }>("SELECT valor FROM tienda.ajustes WHERE clave = $1", [CLAVE_CURSOR_NOVEDADES]);
    return typeof rows[0]?.valor === "string" && rows[0].valor ? rows[0].valor : null;
  };
  const guardar = (c: string) =>
    d.pool.query(
      `INSERT INTO tienda.ajustes (clave, valor, actualizado_por, actualizado_en) VALUES ($1, $2, 'worker', now())
       ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_por = EXCLUDED.actualizado_por, actualizado_en = now()`,
      [CLAVE_CURSOR_NOVEDADES, JSON.stringify(c)],
    );
  /** Un evento por pedido y motivo, aunque el mismo cambio vuelva en el feed (Stocker lo repite con cada novedad del pedido). */
  const eventoUnaVez = async (pedidoId: number, estado: string, detalle: string) => {
    await d.pool.query(
      `INSERT INTO tienda.pedido_eventos (pedido_id, estado, detalle, actor)
       SELECT $1::int, $2::varchar, $3::varchar, 'stocker'
        WHERE NOT EXISTS (SELECT 1 FROM tienda.pedido_eventos WHERE pedido_id = $1::int AND actor = 'stocker' AND detalle = $3::varchar)`,
      [pedidoId, estado, detalle.slice(0, 500)],
    );
  };

  async function cancelado(c: CambioPedido) {
    const { rows } = await d.pool.query<{ id: number; estado: string }>("SELECT id, estado FROM tienda.pedidos WHERE numero = $1", [c.pedidoExterno]);
    const p = rows[0];
    if (!p) return false;
    const motivo = c.motivo ? `: ${c.motivo}` : "";
    if (VENCIBLES.includes(p.estado)) {
      // Stocker ya liberó la mercadería: el vencimiento de la API lo cierra en la próxima pasada (y le avisa al cliente).
      const r = await d.pool.query("UPDATE tienda.pedidos SET vence_en = LEAST(vence_en, now()), actualizado_en = now() WHERE id = $1 AND estado = $2", [p.id, p.estado]);
      await eventoUnaVez(p.id, p.estado, `Stocker liberó la mercadería apartada${motivo}`);
      return (r.rowCount ?? 0) > 0;
    }
    if (p.estado === "transferencia_informada") {
      await eventoUnaVez(p.id, p.estado, `Stocker liberó la mercadería apartada${motivo}. Si se confirma la transferencia, revisá que haya stock antes de prepararlo.`);
      return true;
    }
    if (COBRADOS.includes(p.estado)) {
      await eventoUnaVez(p.id, p.estado, `Stocker canceló este pedido ya cobrado${motivo}. Hay que devolver el dinero o volver a apartar la mercadería.`);
      log.warn(`[stocker] ${c.pedidoExterno} cobrado y cancelado en Stocker${motivo}`);
      return true;
    }
    // Vencido, cancelado o sin stock en la tienda: ya estaba cerrado.
    return false;
  }

  async function aplicar(c: CambioPedido) {
    if (!NUMERO.test(c.pedidoExterno)) return false;
    if (c.despachadoEn || c.cambio === "despachado") return (await d.despachado(c.pedidoExterno, "despachado")).cambio;
    if (c.cambio === "faltante") return (await d.despachado(c.pedidoExterno, "faltante")).cambio;
    if (c.canceladoEn || c.cambio === "cancelado") return cancelado(c);
    // aceptado (un cobro, la etiqueta cargada), parcial, rechazado: nada que hacer en la tienda.
    return false;
  }

  return {
    async leer({ vueltas = 10, limite = 200 } = {}) {
      let desde = await cursor();
      if (!desde) {
        const r = await d.stocker.resoluciones(null);
        await guardar(r.cursor);
        return { empezo: true, vistos: 0, aplicados: 0 };
      }
      let vistos = 0, aplicados = 0;
      for (let v = 0; v < vueltas; v++) {
        const r = await d.stocker.resoluciones(desde, limite);
        for (const c of r.cambios) {
          vistos++;
          if (await aplicar(c)) aplicados++;
        }
        if (r.cursor !== desde) await guardar(r.cursor);
        if (!r.hayMas || r.cursor === desde) break;
        desde = r.cursor;
      }
      return { empezo: false, vistos, aplicados };
    },
  };
}
export type Novedades = ReturnType<typeof crearNovedades>;
