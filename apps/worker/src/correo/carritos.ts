import type pg from "pg";
import { centavos, conDescuento, TiendaCerrada, urlFoto } from "@isu/shared";

/*
 * Recordatorio de carritos abandonados (sólo mail, sólo a quien marcó el tilde del checkout).
 *
 * Cada 10 minutos (envios/carritos-abandonados):
 *   · purga (siempre, aunque la tienda esté apagada o falte SMTP): los carritos sin recordar, a los 7 días;
 *     los ya recordados (sin items: el registro sólo cuenta que ese mail ya recibió uno), a los 90 días del
 *     mail; los de baja, a los 90 días de la baja (para que reenviar el mismo carrito no la vuelva a anotar);
 *   · recordatorio: a las 2 horas de la última actividad, un solo mail con lo que SIGUE a la venta
 *     (nombre, foto y precio de hoy, no los que tenía cuando lo anotó). Si no queda nada, no se manda.
 *     Un solo mail por dirección cada 90 días, y como mucho TOPE_DIARIO_CARRITOS por día (hora de Argentina):
 *     lo que exceda queda pendiente para el día siguiente.
 *
 * Se marca `recordado_en` (y se vacían los items) ANTES de encolar, en la misma consulta que lo elige (SKIP LOCKED):
 * un reintento o dos réplicas nunca mandan dos mails. Si el encolado de una fila falla, esa fila vuelve a quedar
 * pendiente (sin tocar las demás). Antes de enviar, el procesador de mails vuelve a mirar que no haya baja ni compra (enviar.ts).
 */
/** Tope global de recordatorios por día: un abuso del tilde no puede convertir esto en una fuente de correo no pedido. */
export const TOPE_DIARIO_CARRITOS = 300;
export interface DepsCarritos {
  pool: pg.Pool;
  /** Encola en notificaciones (email). */
  encolar: (nombre: "email", datos: Record<string, unknown>, id: string) => Promise<unknown>;
  sitio: string | undefined;
  /** Sin SMTP_URL no se manda nada (ni se marca: queda para cuando haya). */
  smtp: boolean;
  /** Base de las fotos (CDN); sin ella, el mail va sin fotos. */
  fotos?: string;
  /** Sólo para las pruebas. */
  topeDiario?: number;
}

const LINEAS_MAX = 30;

export function crearCarritos(d: DepsCarritos) {
  async function purgar() {
    const r = await d.pool.query(
      `DELETE FROM tienda.carritos_abandonados
        WHERE (baja_en IS NULL AND recordado_en IS NULL AND actualizado_en < now() - interval '7 days')
           OR (baja_en IS NULL AND recordado_en < now() - interval '90 days')
           OR (baja_en IS NOT NULL AND baja_en < now() - interval '90 days')`);
    return r.rowCount ?? 0;
  }

  async function recordar(limite = 50) {
    const purgados = await purgar();
    if (!d.sitio) return { purgados, recordados: 0, motivo: "Falta SITIO_URL" };
    if (!d.smtp) return { purgados, recordados: 0, motivo: "Sin SMTP_URL" };
    const cerrada = TiendaCerrada.safeParse((await d.pool.query<{ valor: unknown }>("SELECT valor FROM tienda.ajustes WHERE clave = 'tiendaCerrada'")).rows[0]?.valor);
    if (cerrada.success && cerrada.data.activa) return { purgados, recordados: 0, motivo: "Tienda apagada" };

    // Cuántos se marcaron hoy (día de Argentina): lo que falte para el tope es lo que se puede mandar ahora.
    const tope = d.topeDiario ?? TOPE_DIARIO_CARRITOS;
    const hoy = (await d.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM tienda.carritos_abandonados
        WHERE recordado_en >= date_trunc('day', now() AT TIME ZONE 'America/Argentina/Buenos_Aires') AT TIME ZONE 'America/Argentina/Buenos_Aires'`)).rows[0]!.n;
    const cupo = Math.min(limite, tope - hoy);
    if (cupo <= 0) return { purgados, recordados: 0, motivo: "Tope diario" };

    const { rows } = await d.pool.query<{ id: number; email: string; items: Array<{ sku: string; cantidad: number }>; baja_token: string; recordado_en: Date }>(
      `UPDATE tienda.carritos_abandonados c SET recordado_en = now(), items = '[]'::jsonb
         FROM (SELECT id, items FROM tienda.carritos_abandonados
                WHERE actualizado_en < now() - interval '2 hours'
                  AND recordado_en IS NULL AND convertido_en IS NULL AND baja_en IS NULL AND jsonb_array_length(items) > 0
                ORDER BY actualizado_en LIMIT $1 FOR UPDATE SKIP LOCKED) x
        WHERE c.id = x.id
        RETURNING c.id, c.email, x.items, c.baja_token, c.recordado_en`,
      [cupo],
    );
    let enviados = 0;
    for (const c of rows) {
      try {
        const pedidas = new Map((Array.isArray(c.items) ? c.items : []).slice(0, LINEAS_MAX).map((i) => [String(i.sku), Math.max(1, Math.min(20, Number(i.cantidad) || 1))]));
        // Lo que sigue a la venta y con stock, con el precio de hoy (incluido el descuento masivo del backoffice, el mayor que toque).
        const { rows: v } = await d.pool.query<{ sku: string; nombre: string; color: string | null; talle: string | null; precio: number; rebaja: number; foto: string | null }>(
          `SELECT v.sku, p.nombre, col.nombre AS color, v.talle, v.precio,
                  COALESCE((SELECT max(ds.porcentaje) FROM tienda.descuentos ds
                             WHERE ds.activo AND (ds.desde IS NULL OR ds.desde <= now()) AND (ds.hasta IS NULL OR ds.hasta > now())
                               AND (ds.alcance = 'todo' OR (ds.alcance = 'productos' AND p.id = ANY(ds.producto_ids))
                                    OR (ds.alcance = 'categorias' AND EXISTS (SELECT 1 FROM tienda.producto_categorias pc JOIN tienda.categorias ca ON ca.id = pc.categoria_id
                                                                               WHERE pc.producto_id = p.id AND (ca.id = ANY(ds.categoria_ids) OR ca.padre_id = ANY(ds.categoria_ids)))))), 0)::int AS rebaja,
                  (SELECT f.clave FROM tienda.fotos f WHERE f.producto_id = p.id
                    ORDER BY (f.tipo = 'color' AND f.color_id = v.color_id) DESC, (f.tipo = 'exhibicion') DESC, f.orden, f.id LIMIT 1) AS foto
             FROM tienda.variantes v
             JOIN tienda.productos p ON p.id = v.producto_id AND p.visible AND p.en_stocker
             LEFT JOIN tienda.producto_colores col ON col.id = v.color_id
            WHERE v.sku = ANY($1::text[]) AND v.activo AND v.stock > 0`,
          [[...pedidas.keys()]],
        );
        if (!v.length) continue;
        const items = v.map((x) => ({
          nombre: x.nombre, color: x.color && x.color !== "Único" ? x.color : null, talle: x.talle, cantidad: pedidas.get(x.sku)!,
          precio: x.rebaja > 0 ? conDescuento(centavos(x.precio), x.rebaja) : x.precio,
          foto: x.foto && d.fotos ? urlFoto(d.fotos, x.foto, 400) : null,
        }));
        const sitio = d.sitio.replace(/\/+$/, "");
        // El token va en el fragmento (#t=): no viaja al servidor ni a Analytics ni a los logs.
        await d.encolar("email", {
          plantilla: "carrito_abandonado", para: c.email,
          datos: { items, enlace: `${sitio}/carrito`, baja: `${sitio}/baja-recordatorios#t=${c.baja_token}` },
        }, `carrito-${c.id}`);
        enviados++;
      } catch (e) {
        // Una fila que falla no pierde el lote: vuelve a quedar pendiente (con sus items) para la próxima vuelta.
        // Salvo que mientras tanto haya habido baja o compra. El id del trabajo es fijo por carrito: si el mail sí había quedado encolado, no se duplica.
        console.warn(`[carritos] no se pudo encolar el recordatorio ${c.id}: ${(e as Error).message}`);
        await d.pool.query("UPDATE tienda.carritos_abandonados SET recordado_en = NULL, items = $2::jsonb WHERE id = $1 AND recordado_en IS NOT NULL AND baja_en IS NULL AND convertido_en IS NULL", [c.id, JSON.stringify(c.items)]).catch(() => {});
      }
    }
    return { purgados, recordados: enviados, sinNada: rows.length - enviados };
  }

  return { recordar, purgar };
}
export type Carritos = ReturnType<typeof crearCarritos>;
