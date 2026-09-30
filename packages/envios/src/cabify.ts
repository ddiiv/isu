import { aCentavos, conToken, ErrorTransporte, pedir, texto } from "./http.js";
import { estadoCabify } from "./estados.js";
import type { Adaptador, Direccion, EventoEnvio } from "./tipos.js";

/*
 * Cabify Logistics — envíos en el día (un cadete retira en el depósito y
 * entrega en unas horas). Sólo en la zona y horario que se configuren
 * (CABA/GBA, antes del horario de corte, días hábiles).
 *
 * El contrato de la API se confirma al dar de alta la cuenta de empresa
 * (Cabify entrega la documentación y las credenciales): las rutas quedan
 * juntas acá para ajustarlas en un solo lugar si difieren.
 *   Ingreso:     POST /auth/token (client_credentials)
 *   Cotizar:     POST /api/v1/estimates
 *   Pedir envío: POST /api/v1/deliveries
 *   Estado:      GET  /api/v1/deliveries/{id}
 */
export interface ConfigCabify { url: string; clienteId: string; clienteSecreto: string }

const aTexto = (d: Pick<Direccion, "calle" | "numero" | "piso" | "localidad" | "provincia" | "cp">) =>
  `${d.calle} ${d.numero}${d.piso ? ` ${d.piso}` : ""}, ${d.localidad}, ${d.provincia} ${d.cp}, Argentina`;

export function cabify(c: ConfigCabify): Adaptador {
  const T = "cabify";
  const base = c.url.replace(/\/+$/, "");
  const sesion = conToken(async () => {
    const r = await pedir<{ access_token?: string; expires_in?: number }>(T, `${base}/auth/token`, {
      method: "POST", cuerpo: { grant_type: "client_credentials", client_id: c.clienteId, client_secret: c.clienteSecreto },
    });
    if (!r.access_token) throw new ErrorTransporte(T, "no devolvió token", null, false);
    return { valor: r.access_token, segundos: r.expires_in ?? 3600 };
  });
  const auth = async () => ({ authorization: `Bearer ${await sesion.token()}` });

  return {
    transporte: T,
    servicios: ["en_el_dia"],

    async cotizar(destino, paquete, servicio, origen) {
      if (servicio !== "en_el_dia") return null;
      const r = await pedir<{ estimates?: Array<{ price?: { amount?: number | string }; eta_minutes?: number }> }>(T, `${base}/api/v1/estimates`, {
        method: "POST", headers: await auth(),
        cuerpo: { pickup: { address: aTexto(origen) }, dropoff: { address: [destino.localidad, destino.cp, destino.provincia, "Argentina"].filter(Boolean).join(", ") }, parcels: [{ weight_grams: Math.round(paquete.pesoGramos) }] },
      });
      const precio = aCentavos(r.estimates?.[0]?.price?.amount);
      if (precio === null) return null;
      return { transporte: T, servicio, nombre: "Cabify · llega hoy", precio, plazoMin: 0, plazoMax: 0 };
    },

    async crearEnvio(e) {
      if (!e.direccion) throw new ErrorTransporte(T, "falta la dirección de destino", null, false);
      const r = await pedir<{ id?: string }>(T, `${base}/api/v1/deliveries`, {
        method: "POST", headers: await auth(),
        cuerpo: {
          external_id: e.pedido,
          pickup: { name: e.origen.nombre, phone: e.origen.telefono, address: aTexto(e.origen) },
          dropoff: { name: `${e.destinatario.nombre} ${e.destinatario.apellido}`.trim(), phone: e.destinatario.telefono, address: aTexto(e.direccion), instructions: e.direccion.indicaciones ?? "" },
          parcels: [{ weight_grams: Math.round(e.paquete.pesoGramos), value: Math.round(e.paquete.valorDeclarado / 100), reference: e.pedido }],
        },
      });
      const id = texto(r.id);
      if (!id) throw new ErrorTransporte(T, "el pedido de cadete no devolvió id", null, false);
      return { seguimiento: id, externoId: id, etiqueta: null };
    },

    async etiqueta() { return null; },

    async seguimiento(envio) {
      const r = await pedir<{ status?: string; events?: Array<{ status?: string; timestamp?: string; description?: string }> }>(T, `${base}/api/v1/deliveries/${encodeURIComponent(envio.externoId ?? envio.seguimiento)}`, { headers: await auth() });
      const eventos = r.events?.length ? r.events : r.status ? [{ status: r.status, timestamp: new Date().toISOString(), description: r.status }] : [];
      return eventos.map((ev): EventoEnvio => ({
        fecha: new Date(texto(ev.timestamp)), estado: estadoCabify(texto(ev.status)), descripcion: texto(ev.description) || texto(ev.status), ubicacion: null,
      })).filter((ev) => !Number.isNaN(ev.fecha.getTime()));
    },

    urlSeguimiento: () => null,
  };
}
