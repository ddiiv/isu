import { aCentavos, conToken, ErrorTransporte, pedir, texto, type Json } from "./http.js";
import { estadoDeTexto } from "./estados.js";
import { codigoProvincia } from "./provincias.js";
import type { Adaptador, EventoEnvio, Servicio, Sucursal } from "./tipos.js";

/*
 * Correo Argentino — API MiCorreo (api.correoargentino.com.ar/micorreo/v1).
 *   Ingreso:     POST /token (Basic usuario:clave) → token JWT
 *   Cotizar:     POST /rates  (deliveredType D = domicilio, S = sucursal)
 *   Sucursales:  GET  /agencies?customerId&provinceCode
 *   Envío:       POST /shipping/import
 *   Seguimiento: GET  /shipping/tracking?shippingId=
 * La etiqueta no viene por API: se imprime desde el portal MiCorreo con el
 * número de pedido (el backoffice lo avisa).
 */
export interface ConfigCorreo { url: string; usuario: string; clave: string; cliente: string }

export function correoArgentino(c: ConfigCorreo): Adaptador {
  const T = "correo_argentino";
  const base = c.url.replace(/\/+$/, "");
  const sesion = conToken(async () => {
    const r = await pedir<{ token?: string; expire?: string }>(T, `${base}/token`, {
      method: "POST", headers: { authorization: `Basic ${Buffer.from(`${c.usuario}:${c.clave}`).toString("base64")}` },
    });
    if (!r.token) throw new ErrorTransporte(T, "no devolvió token", null, false);
    const vence = r.expire ? (new Date(r.expire).getTime() - Date.now()) / 1000 : 3600;
    return { valor: r.token, segundos: Number.isFinite(vence) && vence > 0 ? vence : 3600 };
  });
  const auth = async () => ({ authorization: `Bearer ${await sesion.token()}` });
  const tipo = (s: Servicio) => (s === "sucursal" ? "S" : "D");

  return {
    transporte: T,
    servicios: ["domicilio", "sucursal"],

    async cotizar(destino, paquete, servicio, origen) {
      if (servicio === "en_el_dia") return null;
      const r = await pedir<{ rates?: Array<Record<string, unknown>> }>(T, `${base}/rates`, {
        method: "POST", headers: await auth(),
        cuerpo: {
          customerId: c.cliente, postalCodeOrigin: origen.cp, postalCodeDestination: destino.cp, deliveredType: tipo(servicio),
          dimensions: { weight: Math.max(1, Math.round(paquete.pesoGramos)), height: paquete.altoCm, width: paquete.anchoCm, length: paquete.largoCm },
        },
      });
      // Si hay varias (clásico, expreso), la más barata.
      const tarifas = (r.rates ?? []).filter((t) => texto(t.deliveredType) === tipo(servicio))
        .map((t) => ({ t, precio: aCentavos(t.price) })).filter((x): x is { t: Record<string, unknown>; precio: number } => x.precio !== null)
        .sort((a, b) => a.precio - b.precio);
      const m = tarifas[0];
      if (!m) return null;
      const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : null);
      return { transporte: T, servicio, nombre: texto(m.t.productName) || (servicio === "sucursal" ? "Correo Argentino a sucursal" : "Correo Argentino a domicilio"), precio: m.precio, plazoMin: n(m.t.deliveryTimeMin), plazoMax: n(m.t.deliveryTimeMax) };
    },

    async sucursales(cp, provincia) {
      const codigo = codigoProvincia(provincia);
      if (!codigo) return [];
      const r = await pedir<Array<Json>>(T, `${base}/agencies?${new URLSearchParams({ customerId: c.cliente, provinceCode: codigo })}`, { headers: await auth() });
      const todas = (Array.isArray(r) ? r : []).filter((a) => texto(a.status || "ACTIVE") === "ACTIVE").map((a): Sucursal => {
        const d = a.location?.address ?? {};
        return {
          id: texto(a.code), nombre: texto(a.name) || "Sucursal Correo Argentino",
          direccion: [texto(d.streetName), texto(d.streetNumber)].filter(Boolean).join(" "),
          localidad: texto(d.locality) || texto(d.city), cp: texto(d.postalCode), horario: null,
        };
      });
      // Las del mismo código postal primero, después las más cercanas por número de CP.
      const num = Number(cp);
      return todas.sort((a, b) => Math.abs(Number(a.cp) - num) - Math.abs(Number(b.cp) - num)).slice(0, 30);
    },

    async crearEnvio(e) {
      const d = e.direccion;
      if (e.servicio === "sucursal" && !e.sucursal) throw new ErrorTransporte(T, "falta la sucursal de destino", null, false);
      if (e.servicio !== "sucursal" && !d) throw new ErrorTransporte(T, "falta la dirección de destino", null, false);
      const provO = codigoProvincia(e.origen.provincia);
      const r = await pedir<{ trackingNumber?: string; shippingId?: string }>(T, `${base}/shipping/import`, {
        method: "POST", headers: await auth(),
        cuerpo: {
          customerId: c.cliente, extOrderId: e.pedido, orderNumber: e.pedido,
          sender: {
            name: e.origen.nombre, phone: e.origen.telefono, cellPhone: e.origen.telefono, email: e.origen.email,
            originAddress: { streetName: e.origen.calle, streetNumber: e.origen.numero, floor: e.origen.piso ?? "", apartment: "", city: e.origen.localidad, provinceCode: provO, postalCode: e.origen.cp },
          },
          recipient: { name: `${e.destinatario.nombre} ${e.destinatario.apellido}`.trim(), phone: e.destinatario.telefono, cellPhone: e.destinatario.telefono, email: e.destinatario.email },
          shipping: {
            deliveryType: tipo(e.servicio),
            ...(e.servicio === "sucursal" ? { agency: e.sucursal } : {}),
            address: d ? { streetName: d.calle, streetNumber: d.numero, floor: d.piso ?? "", apartment: "", city: d.localidad, provinceCode: codigoProvincia(d.provincia), postalCode: d.cp } : undefined,
            weight: Math.max(1, Math.round(e.paquete.pesoGramos)), declaredValue: Math.round(e.paquete.valorDeclarado / 100),
            height: e.paquete.altoCm, length: e.paquete.largoCm, width: e.paquete.anchoCm,
          },
        },
      });
      const n = texto(r.trackingNumber) || texto(r.shippingId);
      if (!n) throw new ErrorTransporte(T, "el envío no devolvió número de seguimiento", null, false);
      return { seguimiento: n, externoId: texto(r.shippingId) || null, etiqueta: null };
    },

    async etiqueta() { return null; },

    async seguimiento(envio) {
      const r = await pedir<Array<{ events?: Array<Record<string, unknown>> }>>(T, `${base}/shipping/tracking?${new URLSearchParams({ shippingId: envio.externoId ?? envio.seguimiento })}`, { headers: await auth() });
      const eventos = (Array.isArray(r) ? r : [r]).flatMap((x) => x?.events ?? []);
      return eventos.map((ev): EventoEnvio => {
        // "dd-mm-yyyy HH:mm"
        // eslint-disable-next-line security/detect-unsafe-regex -- anclada y de largo fijo: no hay retroceso catastrófico
        const m = /^(\d{2})-(\d{2})-(\d{4})(?:\s+(\d{2}):(\d{2}))?/.exec(texto(ev.date));
        const fecha = m ? new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4] ?? "00"}:${m[5] ?? "00"}:00-03:00`) : new Date(texto(ev.date));
        const descripcion = texto(ev.event) || texto(ev.status);
        return { fecha, estado: estadoDeTexto(`${texto(ev.event)} ${texto(ev.status)}`), descripcion, ubicacion: texto(ev.branch) || null };
      }).filter((ev) => !Number.isNaN(ev.fecha.getTime()));
    },

    urlSeguimiento: (n) => `https://www.correoargentino.com.ar/formularios/e-commerce?id=${encodeURIComponent(n)}`,
  };
}
