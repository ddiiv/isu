import { aCentavos, conToken, ErrorTransporte, pedir, texto, type Json } from "./http.js";
import { estadoDeTexto } from "./estados.js";
import type { Adaptador, EventoEnvio, Servicio, Sucursal } from "./tipos.js";

/*
 * Andreani — API v2 (apis.andreani.com).
 *   Ingreso:     GET /login con usuario y clave (Basic) → cabecera x-authorization-token (24 h)
 *   Cotizar:     GET /v1/tarifas?cpDestino&contrato&cliente&bultos[0][…]
 *   Sucursales:  GET /v2/sucursales?codigoPostal=
 *   Envío:       POST /v2/ordenes-de-envio → número de envío por bulto
 *   Etiqueta:    GET /v2/ordenes-de-envio/{numero}/etiquetas (PDF)
 *   Seguimiento: GET /v2/envios/{numero}/trazas
 * Un contrato por servicio: a domicilio y a sucursal son contratos distintos.
 */
export interface ConfigAndreani {
  url: string; usuario: string; clave: string; cliente: string;
  contratoDomicilio: string; contratoSucursal?: string | null;
}

export function andreani(c: ConfigAndreani): Adaptador {
  const T = "andreani";
  const base = c.url.replace(/\/+$/, "");
  const sesion = conToken(async () => {
    const r = await fetch(`${base}/login`, {
      headers: { authorization: `Basic ${Buffer.from(`${c.usuario}:${c.clave}`).toString("base64")}` },
      redirect: "error", signal: AbortSignal.timeout(15_000),
    }).catch((e) => { throw new ErrorTransporte(T, `sin respuesta al ingresar (${(e as Error).message})`); });
    const token = r.headers.get("x-authorization-token");
    if (!r.ok || !token) throw new ErrorTransporte(T, `no se pudo ingresar (HTTP ${r.status})`, r.status, r.status >= 500);
    return { valor: token, segundos: 23 * 3600 };
  });
  const auth = async () => ({ "x-authorization-token": await sesion.token() });
  const contrato = (s: Servicio) => (s === "sucursal" ? c.contratoSucursal : c.contratoDomicilio);
  const servicios: Servicio[] = c.contratoSucursal ? ["domicilio", "sucursal"] : ["domicilio"];

  return {
    transporte: T,
    servicios,

    async cotizar(destino, paquete, servicio) {
      const k = contrato(servicio);
      if (!k || !servicios.includes(servicio)) return null;
      const q = new URLSearchParams({
        cpDestino: destino.cp, contrato: k, cliente: c.cliente,
        "bultos[0][valorDeclarado]": String(Math.round(paquete.valorDeclarado / 100)),
        "bultos[0][volumen]": String(paquete.altoCm * paquete.anchoCm * paquete.largoCm),
        "bultos[0][kilos]": String(Math.max(0.1, paquete.pesoGramos / 1000)),
      });
      const r = await pedir<{ tarifaConIva?: { total?: string | number } }>(T, `${base}/v1/tarifas?${q}`, { headers: await auth() });
      const precio = aCentavos(r.tarifaConIva?.total);
      if (precio === null) return null;
      return { transporte: T, servicio, nombre: servicio === "sucursal" ? "Andreani a sucursal" : "Andreani a domicilio", precio, plazoMin: 2, plazoMax: 5 };
    },

    async sucursales(cp) {
      const r = await pedir<Array<Json>>(T, `${base}/v2/sucursales?${new URLSearchParams({ codigoPostal: cp })}`, { headers: await auth() });
      return (Array.isArray(r) ? r : []).filter((s) => s?.datosAdicionales?.seHaceAtencionAlCliente !== false).slice(0, 30).map((s): Sucursal => ({
        id: texto(s.id),
        nombre: texto(s.descripcion) || "Sucursal Andreani",
        direccion: [texto(s.direccion?.calle), texto(s.direccion?.numero)].filter(Boolean).join(" "),
        localidad: texto(s.direccion?.localidad),
        cp: texto(s.direccion?.codigoPostal),
        horario: typeof s.horarioDeAtencion === "string" ? s.horarioDeAtencion : null,
      }));
    },

    async crearEnvio(e) {
      const k = contrato(e.servicio);
      if (!k) throw new ErrorTransporte(T, `sin contrato para envío ${e.servicio}`, null, false);
      const postal = (d: { calle: string; numero: string; piso?: string | null; cp: string; localidad: string; provincia: string }) => ({
        codigoPostal: d.cp, calle: d.calle, numero: d.numero, ...(d.piso ? { piso: d.piso } : {}), localidad: d.localidad, region: d.provincia, pais: "Argentina",
      });
      if (e.servicio === "sucursal" && !e.sucursal) throw new ErrorTransporte(T, "falta la sucursal de destino", null, false);
      if (e.servicio !== "sucursal" && !e.direccion) throw new ErrorTransporte(T, "falta la dirección de destino", null, false);
      const r = await pedir<{ bultos?: Array<{ numeroDeEnvio?: string }> }>(T, `${base}/v2/ordenes-de-envio`, {
        method: "POST", headers: await auth(),
        cuerpo: {
          contrato: k,
          origen: { postal: postal(e.origen) },
          destino: e.servicio === "sucursal" ? { sucursal: { id: e.sucursal } } : { postal: postal(e.direccion!) },
          remitente: { nombreCompleto: e.origen.nombre, email: e.origen.email, documentoTipo: "CUIT", documentoNumero: e.origen.cuit.replace(/\D/g, ""), telefonos: [{ tipo: 1, numero: e.origen.telefono }] },
          destinatario: [{ nombreCompleto: `${e.destinatario.nombre} ${e.destinatario.apellido}`.trim(), email: e.destinatario.email, documentoTipo: "DNI", documentoNumero: e.destinatario.dni.replace(/\D/g, ""), telefonos: [{ tipo: 2, numero: e.destinatario.telefono }] }],
          productoAEntregar: "Indumentaria",
          bultos: [{
            kilos: Math.max(0.1, e.paquete.pesoGramos / 1000),
            volumenCm: e.paquete.altoCm * e.paquete.anchoCm * e.paquete.largoCm,
            valorDeclaradoConImpuestos: Math.round(e.paquete.valorDeclarado / 100),
            referencias: [{ meta: "idCliente", contenido: e.pedido }],
          }],
        },
      });
      const numero = texto(r.bultos?.[0]?.numeroDeEnvio);
      if (!numero) throw new ErrorTransporte(T, "la orden no devolvió número de envío", null, false);
      return { seguimiento: numero, externoId: null, etiqueta: null };
    },

    async etiqueta(envio) {
      return pedir<Buffer>(T, `${base}/v2/ordenes-de-envio/${encodeURIComponent(envio.seguimiento)}/etiquetas`, { headers: await auth(), tipo: "binario" });
    },

    async seguimiento(envio) {
      const r = await pedir<{ eventos?: Array<Record<string, unknown>> }>(T, `${base}/v2/envios/${encodeURIComponent(envio.seguimiento)}/trazas`, { headers: await auth() });
      return (r.eventos ?? []).map((ev): EventoEnvio => {
        const descripcion = texto(ev.Traduccion) || texto(ev.Estado);
        return { fecha: new Date(texto(ev.Fecha)), estado: estadoDeTexto(`${texto(ev.Estado)} ${texto(ev.Traduccion)}`), descripcion, ubicacion: texto(ev.Sucursal) || null };
      }).filter((ev) => !Number.isNaN(ev.fecha.getTime()));
    },

    urlSeguimiento: (n) => `https://www.andreani.com/envio/${encodeURIComponent(n)}`,
  };
}
