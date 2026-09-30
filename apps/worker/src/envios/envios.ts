import type pg from "pg";
import { avanza, enlaceSeguimiento, telefonoWhatsapp, type Adaptador, type EstadoEnvio, type Transportes } from "@isu/envios";
import { NOMBRE_TRANSPORTE, type TransporteTienda } from "@isu/shared";

/*
 * Envíos del lado del worker (etapa 4):
 *
 *   despachado      Stocker avisa (NOTIFY) que el depósito despachó el pedido:
 *                   el pedido pasa a "enviado" y se avisa al cliente.
 *   seguir          se le pregunta al transporte cómo viene cada envío; los
 *                   eventos nuevos se guardan y los cambios importantes se avisan.
 *   revisarDespachos  por si se perdió un NOTIFY: se le pregunta a Stocker.
 *   mercadoEnvios   después del pago, trae el envío que creó Mercado Pago.
 *
 * Los avisos (mail y WhatsApp) pasan por tienda.avisos: uno por pedido, tipo
 * y canal. Un reintento o dos réplicas nunca mandan dos veces el mismo.
 */
export type TipoAviso = "en_camino" | "en_sucursal" | "llega_hoy" | "entregado" | "no_entregado";

/* Plantillas de WhatsApp (aprobadas en Meta) y sus parámetros, en orden. */
const PLANTILLA_WA: Record<TipoAviso, string> = {
  en_camino: "pedido_en_camino", en_sucursal: "pedido_en_sucursal", llega_hoy: "pedido_llega_hoy", entregado: "pedido_entregado", no_entregado: "pedido_no_entregado",
};

export interface DepsEnvios {
  pool: pg.Pool;
  transportes: Transportes;
  /** Encola en notificaciones (email / whatsapp). */
  encolar: (nombre: "email" | "whatsapp", datos: Record<string, unknown>, id: string) => Promise<unknown>;
  /** Encola en stocker (cargar el número de seguimiento). */
  encolarStocker: (nombre: "envio", datos: Record<string, unknown>, id: string) => Promise<unknown>;
  sitio: string | undefined;
  secreto: string | undefined;
  estadoEnStocker?: (numero: string) => Promise<{ despachadoEn: string | null; estado: string } | null>;
  log?: Pick<Console, "warn">;
}

interface FilaPedido {
  id: number; numero: string; estado: string; entrega: string; nombre: string; email: string; telefono: string;
  transporte: string | null; servicio_envio: string | null; sucursal_envio: { nombre?: string; direccion?: string } | null; avisos_whatsapp: boolean;
}

const FINALES: EstadoEnvio[] = ["entregado", "devuelto", "cancelado"];

export function crearEnvios(d: DepsEnvios) {
  const log = d.log ?? console;

  const adaptadorDe = (t: string): Adaptador | null =>
    t === "mercado_envios" ? d.transportes.mercadoEnvios : d.transportes.adaptadores[t as Exclude<TransporteTienda, "mercado_envios">] ?? null;

  async function avisosWhatsappActivos() {
    const { rows } = await d.pool.query<{ valor: unknown }>("SELECT valor FROM tienda.ajustes WHERE clave = 'avisosWhatsapp'");
    return rows[0]?.valor !== false;
  }

  /** Avisa al cliente (una sola vez por tipo y canal). */
  async function avisar(pedidoId: number, tipo: TipoAviso) {
    const { rows } = await d.pool.query<FilaPedido & { seguimiento: string | null }>(
      `SELECT p.id, p.numero, p.estado, p.entrega, p.nombre, p.email, p.telefono, p.transporte, p.servicio_envio, p.sucursal_envio, p.avisos_whatsapp,
              e.seguimiento
         FROM tienda.pedidos p LEFT JOIN tienda.envios e ON e.pedido_id = p.id AND e.activo WHERE p.id = $1`, [pedidoId]);
    const p = rows[0];
    if (!p) return { email: false, whatsapp: false };
    const transporte = NOMBRE_TRANSPORTE[(p.transporte ?? "estandar") as TransporteTienda] ?? "el correo";
    const enlace = d.sitio && d.secreto ? enlaceSeguimiento(d.sitio, p.numero, d.secreto) : `${d.sitio ?? ""}/cuenta`;
    // El número de Mercado Libre y el id del viaje de Cabify no le sirven al cliente.
    const seguimiento = p.transporte && !["mercado_envios", "cabify"].includes(p.transporte) ? p.seguimiento : null;
    const sucursal = p.sucursal_envio?.nombre ? `${p.sucursal_envio.nombre}${p.sucursal_envio.direccion ? ` (${p.sucursal_envio.direccion})` : ""}` : null;
    const primerNombre = p.nombre.split(" ")[0] ?? p.nombre;
    const nuevo = async (canal: "email" | "whatsapp") =>
      (await d.pool.query("INSERT INTO tienda.avisos (pedido_id, tipo, canal) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [p.id, tipo, canal])).rowCount === 1;

    let email = false, wa = false;
    if (await nuevo("email")) {
      await d.encolar("email", { plantilla: `envio_${tipo}`, para: p.email, datos: { numero: p.numero, nombre: primerNombre, transporte, seguimiento, sucursal, enlace } }, `aviso-${p.id}-${tipo}-email`);
      email = true;
    }
    const tel = p.avisos_whatsapp && d.transportes.whatsapp ? telefonoWhatsapp(p.telefono) : null;
    if (tel && await avisosWhatsappActivos() && await nuevo("whatsapp")) {
      const params: Record<TipoAviso, string[]> = {
        en_camino: [primerNombre, p.numero, transporte, enlace],
        en_sucursal: [primerNombre, p.numero, sucursal ?? transporte, enlace],
        llega_hoy: [primerNombre, p.numero, enlace],
        entregado: [primerNombre, p.numero],
        no_entregado: [primerNombre, p.numero, transporte, enlace],
      };
      await d.encolar("whatsapp", { telefono: tel, plantilla: PLANTILLA_WA[tipo], parametros: params[tipo] }, `aviso-${p.id}-${tipo}-wa`);
      wa = true;
    }
    return { email, whatsapp: wa };
  }

  const evento = (db: pg.Pool | pg.PoolClient, pedidoId: number, estado: string, detalle: string) =>
    db.query("INSERT INTO tienda.pedido_eventos (pedido_id, estado, detalle, actor) VALUES ($1, $2, $3, 'envios')", [pedidoId, estado, detalle.slice(0, 300)]);

  /**
   * Stocker despachó el pedido (o avisó que falta mercadería). Idempotente:
   * el mismo aviso dos veces (NOTIFY + repaso) no cambia nada la segunda.
   */
  async function despachado(numero: string, que: "despachado" | "faltante") {
    const cli = await d.pool.connect();
    let aviso!: TipoAviso;
    let pedidoId: number;
    try {
      await cli.query("BEGIN");
      const { rows } = await cli.query<FilaPedido>("SELECT * FROM tienda.pedidos WHERE numero = $1 FOR UPDATE", [numero]);
      const p = rows[0];
      if (!p) { await cli.query("ROLLBACK"); return { cambio: false, motivo: "no_existe" }; }
      pedidoId = p.id;
      if (que === "faltante") {
        await evento(cli, p.id, p.estado, "Stocker: falta mercadería para despachar este pedido. Revisalo en Envíos del día.");
        await cli.query("UPDATE tienda.envios SET ultimo_error = 'Falta mercadería en el depósito', actualizado_en = now() WHERE pedido_id = $1 AND activo", [p.id]);
        await cli.query("COMMIT");
        return { cambio: true, faltante: true };
      }
      if (p.entrega === "retiro") {
        // Retiro en el local: el depósito lo entrega en el mostrador.
        if (!["pagado", "listo_para_retirar"].includes(p.estado)) { await cli.query("ROLLBACK"); return { cambio: false, motivo: p.estado }; }
        await cli.query("UPDATE tienda.pedidos SET estado = 'retirado', actualizado_en = now() WHERE id = $1", [p.id]);
        await evento(cli, p.id, "retirado", "Entregado en el local (despachado en Stocker)");
        await cli.query("COMMIT");
        return { cambio: true, estado: "retirado" };
      }
      const envio = await cli.query<{ id: number; estado: EstadoEnvio }>(
        `UPDATE tienda.envios SET despachado_en = COALESCE(despachado_en, now()), ultimo_error = NULL,
                estado = CASE WHEN estado = 'creado' THEN 'en_camino' ELSE estado END,
                proximo_chequeo = LEAST(proximo_chequeo, now() + interval '20 minutes'), actualizado_en = now()
          WHERE pedido_id = $1 AND activo RETURNING id, estado`, [p.id]);
      if (p.estado !== "pagado") { await cli.query("COMMIT"); return { cambio: false, motivo: p.estado }; }
      await cli.query("UPDATE tienda.pedidos SET estado = 'enviado', actualizado_en = now() WHERE id = $1", [p.id]);
      const nombre = NOMBRE_TRANSPORTE[(p.transporte ?? "estandar") as TransporteTienda];
      await evento(cli, p.id, "enviado", envio.rows[0] ? `Despachado con ${nombre}` : "Despachado");
      await cli.query("COMMIT");
      aviso = p.servicio_envio === "en_el_dia" ? "llega_hoy" : "en_camino";
    } catch (e) {
      await cli.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      cli.release();
    }
    await avisar(pedidoId!, aviso);
    return { cambio: true, estado: "enviado" };
  }

  /** Le pregunta al transporte por un envío y guarda lo nuevo. */
  async function seguir(envioId: number) {
    const { rows } = await d.pool.query<{ id: number; pedido_id: number; transporte: string; seguimiento: string; externo_id: string | null; estado: EstadoEnvio; despachado_en: Date | null; errores_seguidos: number; servicio: string }>(
      "SELECT * FROM tienda.envios WHERE id = $1 AND activo", [envioId]);
    const e = rows[0];
    if (!e || FINALES.includes(e.estado)) return { eventos: 0 };
    const ad = adaptadorDe(e.transporte);
    if (!ad) return { eventos: 0, motivo: "sin_transporte" };

    let eventos;
    try {
      eventos = await ad.seguimiento({ seguimiento: e.seguimiento, externoId: e.externo_id });
    } catch (err) {
      // Espera creciente: 15 min, 30, 1 h… hasta 12 h. En "Problemas" a partir del quinto.
      const espera = Math.min(12 * 60, 15 * 2 ** Math.min(e.errores_seguidos, 6));
      await d.pool.query(
        "UPDATE tienda.envios SET errores_seguidos = errores_seguidos + 1, ultimo_error = $2, proximo_chequeo = now() + make_interval(mins => $3) WHERE id = $1",
        [e.id, String((err as Error).message).slice(0, 300), espera]);
      throw err;
    }

    let nuevos = 0;
    for (const ev of eventos) {
      const r = await d.pool.query(
        "INSERT INTO tienda.envio_eventos (envio_id, fecha, estado, descripcion, ubicacion) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING",
        [e.id, ev.fecha, ev.estado, ev.descripcion.slice(0, 300), ev.ubicacion?.slice(0, 120) ?? null]);
      nuevos += r.rowCount ?? 0;
    }
    // El estado es el del último evento (si avanza: un evento viejo que llega tarde no hace retroceder).
    const ultimo = [...eventos].sort((a, b) => a.fecha.getTime() - b.fecha.getTime()).at(-1);
    let estado = e.estado;
    if (ultimo && ultimo.estado !== e.estado && avanza(e.estado, ultimo.estado)) estado = ultimo.estado;
    // Antes de que Stocker lo despache no se avisa nada (el paquete sigue en el depósito).
    if (!e.despachado_en && estado !== "creado") estado = e.estado;

    const proximo = FINALES.includes(estado) ? 24 * 60 : estado === "en_reparto" ? 30 : 120;
    await d.pool.query(
      `UPDATE tienda.envios SET estado = $2::varchar, errores_seguidos = 0, ultimo_error = NULL, proximo_chequeo = now() + make_interval(mins => $3),
              entregado_en = CASE WHEN $2::varchar = 'entregado' THEN COALESCE(entregado_en, now()) ELSE entregado_en END, actualizado_en = now()
        WHERE id = $1`, [e.id, estado, proximo]);

    if (estado !== e.estado) await alCambiar(e.pedido_id, estado, e.transporte);
    return { eventos: nuevos, estado };
  }

  async function alCambiar(pedidoId: number, estado: EstadoEnvio, transporte: string) {
    const nombre = NOMBRE_TRANSPORTE[transporte as TransporteTienda] ?? transporte;
    if (estado === "entregado") {
      const r = await d.pool.query("UPDATE tienda.pedidos SET estado = 'entregado', actualizado_en = now() WHERE id = $1 AND estado = 'enviado'", [pedidoId]);
      if (r.rowCount) await evento(d.pool, pedidoId, "entregado", `Entregado (${nombre})`);
      await avisar(pedidoId, "entregado");
    } else if (estado === "en_sucursal") {
      await avisar(pedidoId, "en_sucursal");
    } else if (estado === "en_reparto") {
      await avisar(pedidoId, "llega_hoy");
    } else if (estado === "no_entregado") {
      await evento(d.pool, pedidoId, "enviado", `${nombre}: no se pudo entregar`);
      await avisar(pedidoId, "no_entregado");
    } else if (estado === "devuelto") {
      await evento(d.pool, pedidoId, "enviado", `${nombre}: el envío vuelve al remitente. Revisalo en Envíos → Problemas.`);
    }
  }

  /**
   * Cada 10 minutos: los envíos a los que les toca. Se "reservan" moviendo
   * proximo_chequeo, así dos réplicas del worker no preguntan por el mismo.
   */
  async function seguirPendientes(limite = 40) {
    const { rows } = await d.pool.query<{ id: number }>(
      `UPDATE tienda.envios SET proximo_chequeo = now() + interval '15 minutes'
        WHERE id IN (SELECT id FROM tienda.envios
                      WHERE activo AND estado NOT IN ('entregado', 'devuelto', 'cancelado') AND despachado_en IS NOT NULL
                        AND despachado_en > now() - interval '60 days' AND proximo_chequeo <= now()
                      ORDER BY proximo_chequeo LIMIT $1 FOR UPDATE SKIP LOCKED)
        RETURNING id`, [limite]);
    let ok = 0, fallas = 0;
    for (const r of rows) {
      try { await seguir(r.id); ok++; } catch (e) { fallas++; log.warn(`[envios] seguimiento ${r.id}: ${(e as Error).message}`); }
    }
    return { revisados: rows.length, ok, fallas };
  }

  /**
   * Repaso por si se perdió un aviso de Stocker (NOTIFY no guarda nada si el
   * worker estaba caído): pedidos pagados hace más de 10 minutos que no salieron.
   */
  async function revisarDespachos(limite = 60) {
    if (!d.estadoEnStocker) return { revisados: 0 };
    const { rows } = await d.pool.query<{ numero: string }>(
      `SELECT numero FROM tienda.pedidos
        WHERE estado IN ('pagado', 'listo_para_retirar') AND pagado_en < now() - interval '10 minutes' AND pagado_en > now() - interval '30 days'
        ORDER BY pagado_en LIMIT $1`, [limite]);
    let despachados = 0;
    for (const r of rows) {
      const s = await d.estadoEnStocker(r.numero).catch(() => null);
      if (s?.despachadoEn) { const x = await despachado(r.numero, "despachado"); if (x.cambio) despachados++; }
    }
    return { revisados: rows.length, despachados };
  }

  /** Mercado Envíos: el envío lo creó Mercado Pago con el pago. Si todavía no está, se reintenta. */
  async function mercadoEnvios(numero: string, pagoId: string) {
    const me = d.transportes.mercadoEnvios;
    if (!me) return { motivo: "sin_mercado_envios" };
    const { rows } = await d.pool.query<{ id: number; transporte: string | null }>("SELECT id, transporte FROM tienda.pedidos WHERE numero = $1", [numero]);
    const p = rows[0];
    if (!p || p.transporte !== "mercado_envios") return { motivo: "no_corresponde" };
    const e = await me.envioDePago(pagoId);
    if (!e) throw new Error(`Mercado Pago todavía no tiene el envío del pago ${pagoId}`);
    await d.pool.query(
      `INSERT INTO tienda.envios (pedido_id, transporte, servicio, seguimiento, externo_id, costo, creado_por, proximo_chequeo)
       SELECT $1, 'mercado_envios', 'domicilio', $2, $2, $3, 'mercado pago', now() + interval '30 minutes'
        WHERE NOT EXISTS (SELECT 1 FROM tienda.envios WHERE pedido_id = $1 AND activo)
       ON CONFLICT DO NOTHING`, [p.id, e.id, e.costo]);
    if (e.costo !== null) await d.pool.query("UPDATE tienda.pedidos SET envio_mercado_pago = $2 WHERE id = $1", [p.id, e.costo]);
    await d.encolarStocker("envio", { numero, tipo: "mercado_envios", seguimiento: e.id }, `envio-${numero}-${e.id}`);
    return { seguimiento: e.id };
  }

  return { avisar, despachado, seguir, seguirPendientes, revisarDespachos, mercadoEnvios };
}
export type Envios = ReturnType<typeof crearEnvios>;
