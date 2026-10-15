import { conToken, ErrorTransporte, pedir, texto } from "./http.js";
import { estadoCabify } from "./estados.js";
import type { Adaptador, Direccion, EventoEnvio } from "./tipos.js";

/*
 * Cabify Logistics — envíos en el día (un cadete retira en el depósito y
 * entrega en unas horas). Sólo en la zona y horario que se configuren
 * (CABA/GBA, antes del horario de corte, días hábiles).
 * Contrato: https://developers.cabify.com (Logistics API).
 *   Ingreso:  POST {auth} (form, client_credentials) — cabify.com, no logistics.api
 *   Cotizar:  POST /v3/parcels/estimate
 *   Envío:    POST /v1/parcels (alta) + POST /v1/parcels/ship (pide el cadete)
 *   Estado:   GET  /v1/parcels/{id}/timeline
 * Los importes van en centavos (unidad mínima ISO 4217) en los dos sentidos.
 * `tipoEnvio`: el shipping_type_id de la cuenta (GET /v1/shipping_types/available?location=lat,lon).
 */
export interface ConfigCabify { url: string; auth: string; clienteId: string; clienteSecreto: string; tipoEnvio: string | null }

const aTexto = (d: Pick<Direccion, "calle" | "numero" | "piso" | "localidad" | "provincia" | "cp">) =>
  `${d.calle} ${d.numero}${d.piso ? ` ${d.piso}` : ""}, ${d.localidad}, ${d.provincia} ${d.cp}, Argentina`;

export function cabify(c: ConfigCabify): Adaptador {
  const T = "cabify";
  const base = c.url.replace(/\/+$/, "");
  const sesion = conToken(async () => {
    const r = await pedir<{ access_token?: string; expires_in?: number }>(T, c.auth, {
      method: "POST", form: { grant_type: "client_credentials", client_id: c.clienteId, client_secret: c.clienteSecreto },
    });
    if (!r.access_token) throw new ErrorTransporte(T, "no devolvió token", null, false);
    return { valor: r.access_token, segundos: r.expires_in ?? 3600 };
  });
  const auth = async () => ({ authorization: `Bearer ${await sesion.token()}` });
  const tipo = () => {
    if (!c.tipoEnvio) throw new ErrorTransporte(T, "falta CABIFY_TIPO_ENVIO (shipping_type_id de la cuenta)", null, false);
    return c.tipoEnvio;
  };

  return {
    transporte: T,
    servicios: ["en_el_dia"],

    async cotizar(destino, paquete, servicio, origen) {
      if (servicio !== "en_el_dia") return null;
      const r = await pedir<{ deliveries?: Array<{ estimation?: { price?: { amount?: unknown } } }> }>(T, `${base}/v3/parcels/estimate`, {
        method: "POST", headers: await auth(),
        cuerpo: {
          shipping_type_id: tipo(),
          parcels: [{
            pickup_location: { address: aTexto(origen) },
            dropoff_location: { address: [destino.localidad, destino.cp, destino.provincia, "Argentina"].filter(Boolean).join(", ") },
            weight: { value: Math.round(paquete.pesoGramos), unit: "g" },
          }],
        },
      });
      const precio = Number(r.deliveries?.[0]?.estimation?.price?.amount);
      if (!Number.isInteger(precio) || precio < 0) return null;
      return { transporte: T, servicio, nombre: "Cabify · llega hoy", precio, plazoMin: 0, plazoMax: 0 };
    },

    async crearEnvio(e) {
      if (!e.direccion) throw new ErrorTransporte(T, "falta la dirección de destino", null, false);
      const shipping_type_id = tipo();
      const alta = await pedir<{ parcels?: Array<{ id?: string }> }>(T, `${base}/v1/parcels`, {
        method: "POST", headers: await auth(),
        cuerpo: {
          parcels: [{
            external_id: e.referencia ?? e.pedido,
            pickup_info: { addr: aTexto(e.origen), contact: { name: e.origen.nombre, phone: e.origen.telefono } },
            dropoff_info: {
              addr: aTexto(e.direccion), instr: e.direccion.indicaciones ?? null,
              contact: { name: `${e.destinatario.nombre} ${e.destinatario.apellido}`.trim(), phone: e.destinatario.telefono },
            },
            weight: { value: Math.round(e.paquete.pesoGramos), unit: "g" },
            dimensions: { length: Math.round(e.paquete.largoCm), width: Math.round(e.paquete.anchoCm), height: Math.round(e.paquete.altoCm), unit: "cm" },
            price: { declared_value: Math.round(e.paquete.valorDeclarado), currency: "ARS" },
          }],
        },
      });
      const id = texto(alta.parcels?.[0]?.id);
      if (!id) throw new ErrorTransporte(T, "el alta del paquete no devolvió id", null, false);
      await pedir(T, `${base}/v1/parcels/ship`, { method: "POST", headers: await auth(), cuerpo: { parcel_ids: [id], shipping_type_id } });
      return { seguimiento: id, externoId: id, etiqueta: null };
    },

    async etiqueta() { return null; },

    async seguimiento(envio) {
      const r = await pedir<{ timeline?: Array<{ state?: string; state_updated_at?: string }> }>(T, `${base}/v1/parcels/${encodeURIComponent(envio.externoId ?? envio.seguimiento)}/timeline`, { headers: await auth() });
      return (r.timeline ?? []).map((ev): EventoEnvio => ({
        fecha: new Date(texto(ev.state_updated_at)), estado: estadoCabify(texto(ev.state)), descripcion: texto(ev.state), ubicacion: null,
      })).filter((ev) => !Number.isNaN(ev.fecha.getTime()));
    },

    urlSeguimiento: () => null,
  };
}
