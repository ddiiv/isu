import { aCentavos, ErrorTransporte, pedir, texto, type Json } from "./http.js";
import { estadoMercadoEnvios } from "./estados.js";
import type { Adaptador, EventoEnvio } from "./tipos.js";

/*
 * Mercado Envíos (ME2) con el checkout de Mercado Pago.
 *
 * Distinto de los demás: el envío lo crea Mercado Pago cuando se paga (la
 * preferencia lleva `shipments.mode = "me2"` y el cliente paga el envío ahí
 * mismo). Por eso sólo se ofrece con Mercado Pago, la cotización es
 * orientativa y el costo real queda en el pago.
 *
 * Se usa la misma credencial de Mercado Pago (APP_USR-…) contra la API de
 * Mercado Libre, que es la dueña de los envíos:
 *   Cotizar:     GET /users/{id}/shipping_options?zip_code&dimensions
 *   Del pago:    GET (MP) /v1/payments/{id} → orden → /merchant_orders/{id} → shipments[0]
 *   Etiqueta:    GET /shipment_labels?shipment_ids=&response_type=pdf
 *   Seguimiento: GET /shipments/{id}
 */
export interface ConfigMercadoEnvios { urlMl: string; urlMp: string; token: string }

export interface MercadoEnvios extends Adaptador {
  /** El envío que Mercado Pago creó para un pago aprobado (null si el pago no tenía envío). */
  envioDePago(pagoId: string): Promise<{ id: string; costo: number | null } | null>;
  /** Lo que va en la preferencia de Mercado Pago. */
  preferencia(paquete: { pesoGramos: number; altoCm: number; anchoCm: number; largoCm: number }, cp: string): Record<string, unknown>;
}

export function mercadoEnvios(c: ConfigMercadoEnvios): MercadoEnvios {
  const T = "mercado_envios";
  const ml = c.urlMl.replace(/\/+$/, "");
  const mp = c.urlMp.replace(/\/+$/, "");
  const auth = { authorization: `Bearer ${c.token}` };
  let usuario: Promise<string> | null = null;
  const yo = () => (usuario ??= pedir<{ id?: number | string }>(T, `${ml}/users/me`, { headers: auth }).then((r) => {
    if (!r.id) throw new ErrorTransporte(T, "la credencial no tiene usuario", null, false);
    return String(r.id);
  }).catch((e) => { usuario = null; throw e; }));
  const dimensiones = (p: { pesoGramos: number; altoCm: number; anchoCm: number; largoCm: number }) =>
    `${Math.ceil(p.altoCm)}x${Math.ceil(p.anchoCm)}x${Math.ceil(p.largoCm)},${Math.max(1, Math.round(p.pesoGramos))}`;

  return {
    transporte: T,
    servicios: ["domicilio"],

    async cotizar(destino, paquete, servicio) {
      if (servicio !== "domicilio") return null;
      const r = await pedir<{ options?: Array<Json> }>(T, `${ml}/users/${await yo()}/shipping_options?${new URLSearchParams({ zip_code: destino.cp, dimensions: dimensiones(paquete) })}`, { headers: auth });
      const opciones = (r.options ?? []).map((o) => ({ o, precio: aCentavos(o.cost) })).filter((x): x is { o: Json; precio: number } => x.precio !== null).sort((a, b) => a.precio - b.precio);
      const m = opciones[0];
      if (!m) return null;
      const dias = Number(m.o.estimated_delivery_time?.shipping ?? NaN) / 24;
      return { transporte: T, servicio, nombre: texto(m.o.name) || "Mercado Envíos", precio: m.precio, plazoMin: Number.isFinite(dias) ? Math.max(1, Math.floor(dias)) : null, plazoMax: Number.isFinite(dias) ? Math.ceil(dias) + 1 : null };
    },

    preferencia: (paquete) => ({ mode: "me2", dimensions: dimensiones(paquete), local_pickup: false }),

    async envioDePago(pagoId) {
      const pago = await pedir<{ order?: { id?: number | string } }>(T, `${mp}/v1/payments/${encodeURIComponent(pagoId)}`, { headers: auth });
      const orden = pago.order?.id;
      if (!orden) return null;
      const mo = await pedir<{ shipments?: Array<{ id?: number | string }>; shipping_cost?: number }>(T, `${mp}/merchant_orders/${encodeURIComponent(String(orden))}`, { headers: auth });
      const id = mo.shipments?.[0]?.id;
      return id ? { id: String(id), costo: aCentavos(mo.shipping_cost) } : null;
    },

    async crearEnvio() {
      throw new ErrorTransporte(T, "los envíos de Mercado Envíos los crea Mercado Pago al cobrar", null, false);
    },

    async etiqueta(envio) {
      const id = envio.externoId ?? envio.seguimiento;
      return pedir<Buffer>(T, `${ml}/shipment_labels?${new URLSearchParams({ shipment_ids: id, response_type: "pdf" })}`, { headers: auth, tipo: "binario" });
    },

    async seguimiento(envio) {
      const id = envio.externoId ?? envio.seguimiento;
      const s = await pedir<{ status?: string; substatus?: string | null; last_updated?: string; status_history?: Record<string, string | null> }>(T, `${ml}/shipments/${encodeURIComponent(id)}`, { headers: auth });
      if (!s.status) return [];
      const fecha = new Date(s.last_updated ?? Date.now());
      const descripcion = [s.status, s.substatus].filter(Boolean).join(" · ");
      return [{ fecha: Number.isNaN(fecha.getTime()) ? new Date() : fecha, estado: estadoMercadoEnvios(s.status, s.substatus), descripcion, ubicacion: null } satisfies EventoEnvio];
    },

    urlSeguimiento: () => null,
  };
}
