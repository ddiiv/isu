import { aCentavos, buscarTodos, ErrorTransporte, escaparXml, leerXml, pedir, texto } from "./http.js";
import { estadoDeTexto } from "./estados.js";
import type { Adaptador, EventoEnvio, Servicio, Sucursal } from "./tipos.js";

/*
 * OCA — web service e-Pak (webservice.oca.com.ar/ePak_tracking/Oep_TrackEPak.asmx).
 * Responde XML (DataSet de .NET). Cada servicio es una "operativa" que OCA
 * da de alta en la cuenta (puerta a puerta, puerta a sucursal).
 *   Cotizar:     Tarifar_Envio_Corporativo
 *   Sucursales:  GetCentrosImposicionConServiciosByCP
 *   Envío:       IngresoORMultiplesRetiros (usuario y clave de e-Pak)
 *   Etiqueta:    GetPdfDeEtiquetasPorOrdenOrNumeroEnvio (PDF en base64)
 *   Seguimiento: Tracking_Pieza
 */
export interface ConfigOca {
  url: string; usuario: string; clave: string; cuit: string; cuenta: string;
  operativaDomicilio: string; operativaSucursal?: string | null;
}

export function oca(c: ConfigOca): Adaptador {
  const T = "oca";
  const base = c.url.replace(/\/+$/, "");
  const xml = async (metodo: string, q: Record<string, string>, post = false) => {
    const t = post
      ? await pedir<string>(T, `${base}/${metodo}`, { method: "POST", form: q, tipo: "texto", timeoutMs: 30_000 })
      : await pedir<string>(T, `${base}/${metodo}?${new URLSearchParams(q)}`, { tipo: "texto" });
    return leerXml(t);
  };
  const operativa = (s: Servicio) => (s === "sucursal" ? c.operativaSucursal : c.operativaDomicilio);
  const servicios: Servicio[] = c.operativaSucursal ? ["domicilio", "sucursal"] : ["domicilio"];

  return {
    transporte: T,
    servicios,

    async cotizar(destino, paquete, servicio, origen) {
      const op = operativa(servicio);
      if (!op || !servicios.includes(servicio)) return null;
      const r = await xml("Tarifar_Envio_Corporativo", {
        PesoTotal: String(Math.max(0.1, paquete.pesoGramos / 1000)),
        VolumenTotal: String((paquete.altoCm * paquete.anchoCm * paquete.largoCm) / 1_000_000),
        CodigoPostalOrigen: origen.cp, CodigoPostalDestino: destino.cp, CantidadPaquetes: "1",
        ValorDeclarado: String(Math.round(paquete.valorDeclarado / 100)), Cuit: c.cuit, Operativa: op,
      });
      const fila = buscarTodos(r, "Table")[0];
      const precio = aCentavos(fila?.Total ?? fila?.Precio);
      if (!fila || precio === null) return null;
      const plazo = Number(texto(fila.PlazoEntrega));
      return { transporte: T, servicio, nombre: servicio === "sucursal" ? "OCA a sucursal" : "OCA a domicilio", precio, plazoMin: Number.isFinite(plazo) ? plazo : null, plazoMax: Number.isFinite(plazo) ? plazo + 2 : null };
    },

    async sucursales(cp) {
      const r = await xml("GetCentrosImposicionConServiciosByCP", { CodigoPostal: cp });
      return buscarTodos(r, "Centro").slice(0, 30).map((s): Sucursal => ({
        id: texto(s.IdCentroImposicion),
        nombre: texto(s.Descripcion) || `OCA ${texto(s.Sigla)}`,
        direccion: [texto(s.Calle), texto(s.Numero)].filter(Boolean).join(" "),
        localidad: texto(s.Localidad), cp: texto(s.CodigoPostal), horario: null,
      })).filter((s) => s.id);
    },

    async crearEnvio(e) {
      const op = operativa(e.servicio);
      if (!op) throw new ErrorTransporte(T, `sin operativa para envío ${e.servicio}`, null, false);
      const d = e.direccion;
      if (e.servicio === "sucursal" ? !e.sucursal : !d) throw new ErrorTransporte(T, "faltan los datos de destino", null, false);
      const a = (v: unknown) => escaparXml(texto(v));
      const o = e.origen;
      const dest = d ?? { calle: "", numero: "", piso: "", cp: "", localidad: "", provincia: "" };
      const hoy = new Date().toISOString().slice(0, 10).replaceAll("-", "");
      const datos = `<?xml version="1.0" encoding="utf-8"?><ROWS><cabecera ver="2.0" nrocuenta="${a(c.cuenta)}"/><origenes><origen calle="${a(o.calle)}" numero="${a(o.numero)}" piso="${a(o.piso)}" depto="" cp="${a(o.cp)}" localidad="${a(o.localidad)}" provincia="${a(o.provincia)}" contacto="${a(o.nombre)}" email="${a(o.email)}" solicitante="${a(o.nombre)}" observaciones="" centrocosto="0" idfranjahoraria="1" idcentroimposicionorigen="0" fecha="${hoy}"><envios><envio idoperativa="${a(op)}" nroremito="${a(e.pedido)}"><destinatario apellido="${a(e.destinatario.apellido)}" nombre="${a(e.destinatario.nombre)}" calle="${a(dest.calle)}" numero="${a(dest.numero)}" piso="${a(dest.piso)}" depto="" localidad="${a(dest.localidad)}" provincia="${a(dest.provincia)}" cp="${a(dest.cp)}" telefono="${a(e.destinatario.telefono)}" email="${a(e.destinatario.email)}" idci="${a(e.servicio === "sucursal" ? e.sucursal : "0")}" celular="${a(e.destinatario.telefono)}" observaciones="${a(d?.indicaciones)}"/><paquetes><paquete alto="${e.paquete.altoCm}" ancho="${e.paquete.anchoCm}" largo="${e.paquete.largoCm}" peso="${Math.max(0.1, e.paquete.pesoGramos / 1000)}" valor="${Math.round(e.paquete.valorDeclarado / 100)}" cant="1"/></paquetes></envio></envios></origen></origenes></ROWS>`;
      const r = await xml("IngresoORMultiplesRetiros", { usr: c.usuario, psw: c.clave, xml_Datos: datos, ConfirmarRetiro: "true", ArchivoCliente: "", ArchivoProceso: "" }, true);
      const detalle = buscarTodos(r, "DetalleIngresos")[0] ?? buscarTodos(r, "Table")[0];
      const numero = texto(detalle?.NumeroEnvio);
      if (!numero) {
        const error = buscarTodos(r, "Errores")[0];
        throw new ErrorTransporte(T, `no se pudo cargar el envío${error ? `: ${texto(error.Descripcion ?? JSON.stringify(error)).slice(0, 200)}` : ""}`, null, false);
      }
      return { seguimiento: numero, externoId: texto(detalle?.OrdenRetiro) || null, etiqueta: null };
    },

    async etiqueta(envio) {
      const t = await pedir<string>(T, `${base}/GetPdfDeEtiquetasPorOrdenOrNumeroEnvio?${new URLSearchParams({ idOrdenRetiro: envio.externoId ?? "", nroEnvio: envio.seguimiento, logisticaInversa: "false" })}`, { tipo: "texto" });
      const r = leerXml(t);
      // <string xmlns="…">base64</string>: con atributos, el texto queda en "#text".
      const nodo = (r as { string?: unknown }).string;
      const b64 = texto(nodo && typeof nodo === "object" ? (nodo as Record<string, unknown>)["#text"] : nodo);
      const pdf = Buffer.from(b64.replace(/\s/g, ""), "base64");
      if (!pdf.subarray(0, 5).toString().startsWith("%PDF")) throw new ErrorTransporte(T, "la etiqueta no es un PDF", null, false);
      return pdf;
    },

    async seguimiento(envio) {
      const r = await xml("Tracking_Pieza", { NroDocumentoCliente: "", CUIT: c.cuit, Pieza: envio.seguimiento });
      return buscarTodos(r, "Table").map((f): EventoEnvio => {
        const descripcion = [texto(f.Desdcripcion_Estado ?? f.Descripcion_Estado), texto(f.Descripcion_Motivo)].filter((x) => x && x !== "0").join(" · ");
        return { fecha: new Date(texto(f.fecha)), estado: estadoDeTexto(descripcion), descripcion, ubicacion: texto(f.SUC) || null };
      }).filter((ev) => ev.descripcion && !Number.isNaN(ev.fecha.getTime()));
    },

    urlSeguimiento: (n) => `https://www1.oca.com.ar/OEPTrackingWeb/trackingenvio.asp?numero1=${encodeURIComponent(n)}`,
  };
}
