import { aCentavos, conToken, ErrorTransporte, pedir, pedirGetConCuerpo, texto, type Json, type OpcionesPedido } from "./http.js";
import { estadoDeTexto } from "./estados.js";
import { codigoProvincia } from "./provincias.js";
import type { Adaptador, Cotizacion, EventoEnvio, Paquete, Servicio, Sucursal } from "./tipos.js";

/*
 * Correo Argentino — API MiCorreo (la de e-commerce; PaqAr es para ERP).
 * Manual «Correo Argentino - API MiCorreo» (versión 2026-05-18):
 *
 *   Ingreso:      POST /token (Basic usuario:clave) → { token, expires: "AAAA-MM-DD hh:mm:ss" }
 *   Cotizar:      POST /rates — sin deliveredType devuelve domicilio (D) y sucursal (S) juntos.
 *                 Peso 1 a 50.000 g, cada lado hasta 200 cm y los tres sumados hasta 300 cm.
 *   Sucursales:   GET  /agencies?customerId&provinceCode&services=pickup_availability
 *   Cargar envío: POST /shipping/import → { createdAt } (NO devuelve número de seguimiento)
 *   Seguimiento:  GET  /shipping/tracking con cuerpo { shippingId } (el número del rótulo)
 *   Errores:      { code, message } (402: «los datos son válidos pero falló»)
 *
 * El rótulo (la etiqueta) no viene por API: el envío cargado aparece en
 * MiCorreo, donde se paga y se imprime. El número de seguimiento sale en el
 * rótulo y se carga en el backoffice; desde ahí se sigue solo.
 */
export interface ConfigCorreo {
  url: string; usuario: string; clave: string; cliente: string;
  /** Dónde se pagan e imprimen los rótulos (se muestra en el backoffice). */
  portal?: string | null;
}

const T = "correo_argentino";
export const PORTAL_MICORREO = "https://www.correoargentino.com.ar/MiCorreo/public/";
/* Límites del manual. */
const MAX_GRAMOS = 50_000, MAX_LADO_COTIZAR = 200, MAX_SUMA_LADOS = 300, MAX_LADO_CARGAR = 255;

/** El mensaje que manda Correo ({ code, message }) en vez del HTTP crudo. */
function conMensaje(e: unknown): never {
  if (e instanceof ErrorTransporte) {
    const m = /^correo_argentino: HTTP (\d+) (.*)$/s.exec(e.message);
    let msg = m?.[2] ?? "";
    try { const j = JSON.parse(msg) as Json; msg = texto(j.message) || texto(j.error) || msg; } catch { /* queda el texto */ }
    if (m) throw new ErrorTransporte(T, msg.trim() || `HTTP ${m[1]}`, e.status, e.reintentable);
  }
  throw e;
}

/** Medidas enteras (el manual las pide así) y dentro de lo que acepta Correo; null = no se puede mandar por Correo. */
export function medidasCorreo(p: Paquete, maxLado: number): { weight: number; height: number; width: number; length: number } | null {
  const m = { weight: Math.max(1, Math.ceil(p.pesoGramos)), height: Math.max(1, Math.ceil(p.altoCm)), width: Math.max(1, Math.ceil(p.anchoCm)), length: Math.max(1, Math.ceil(p.largoCm)) };
  if (m.weight > MAX_GRAMOS || Math.max(m.height, m.width, m.length) > maxLado || m.height + m.width + m.length > MAX_SUMA_LADOS) return null;
  return m;
}

/** "3 B", "PB 4", "piso 2 depto A" → piso y departamento (MiCorreo los corta en 3 caracteres). */
export function pisoYDepto(piso: string | null | undefined): { floor: string; apartment: string } {
  const t = (piso ?? "").trim().replace(/\b(piso|dto\.?|dpto\.?|depto\.?|departamento)\b/gi, " ").replace(/[,/-]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return { floor: "", apartment: "" };
  const [a = "", ...resto] = t.split(" ");
  return { floor: a.slice(0, 3), apartment: resto.join("").slice(0, 3) };
}

const soloDigitos = (t: string | null | undefined) => (t ?? "").replace(/\D/g, "").slice(0, 20);
const cp4 = (cp: string) => /\d{4}/.exec(cp)?.[0] ?? cp;

const DIAS: Array<[string, string]> = [["monday", "lun"], ["tuesday", "mar"], ["wednesday", "mié"], ["thursday", "jue"], ["friday", "vie"], ["saturday", "sáb"], ["sunday", "dom"]];
const hora = (h: string) => { const m = /^(\d{1,2})(\d{2})$/.exec(h.replace(":", "")); return m ? `${Number(m[1])}${m[2] === "00" ? "" : `:${m[2]}`}` : h; };
/** { monday: { start: "0930", end: "1800" }, … } → "lun a vie 9:30 a 18 h · sáb 9 a 13 h" */
export function horarioSucursal(hours: unknown): string | null {
  if (!hours || typeof hours !== "object") return null;
  const h = hours as Record<string, { start?: unknown; end?: unknown } | null>;
  const tramos: Array<{ desde: string; hasta: string; rango: string }> = [];
  for (const [clave, corto] of DIAS) {
    const d = h[clave];
    const rango = d && texto(d.start) && texto(d.end) ? `${hora(texto(d.start))} a ${hora(texto(d.end))} h` : "";
    const ultimo = tramos.at(-1);
    if (rango && ultimo?.rango === rango && ultimo.hasta === DIAS[DIAS.findIndex(([c]) => c === clave) - 1]?.[1]) ultimo.hasta = corto;
    else if (rango) tramos.push({ desde: corto, hasta: corto, rango });
  }
  if (!tramos.length) return null;
  return tramos.map((t) => `${t.desde}${t.hasta !== t.desde ? ` a ${t.hasta}` : ""} ${t.rango}`).join(" · ").slice(0, 120);
}

export function correoArgentino(c: ConfigCorreo): Adaptador & { cliente: (email: string, clave: string) => Promise<string | null> } {
  const base = c.url.replace(/\/+$/, "");
  const sesion = conToken(async () => {
    const r = await pedir<{ token?: string; expires?: string; expire?: string }>(T, `${base}/token`, {
      method: "POST", headers: { authorization: `Basic ${Buffer.from(`${c.usuario}:${c.clave}`).toString("base64")}` },
    }).catch(conMensaje);
    if (!r.token) throw new ErrorTransporte(T, "no devolvió token", null, false);
    // "2022-04-26 21:16:20" (hora de Argentina).
    const vence = texto(r.expires ?? r.expire);
    // eslint-disable-next-line security/detect-unsafe-regex -- anclada y de largo fijo: no hay retroceso catastrófico
    const fecha = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(vence) ? new Date(`${vence.replace(" ", "T")}-03:00`) : new Date(vence);
    const segundos = (fecha.getTime() - Date.now()) / 1000;
    return { valor: r.token, segundos: Number.isFinite(segundos) && segundos > 0 ? segundos : 3600 };
  });

  /** Con el token; si Correo lo rechaza (venció antes), se pide otro y se reintenta una vez. */
  async function llamar<R>(ruta: string, o: OpcionesPedido = {}): Promise<R> {
    const ir = async () => pedir<R>(T, `${base}${ruta}`, { ...o, headers: { ...(o.headers as Record<string, string> | undefined), authorization: `Bearer ${await sesion.token()}` } });
    try { return await ir(); } catch (e) {
      if (e instanceof ErrorTransporte && e.status === 401) { sesion.olvidar(); return ir().catch(conMensaje); }
      return conMensaje(e);
    }
  }

  /*
   * Una sola consulta trae domicilio y sucursal: el checkout pregunta por los
   * dos, así que se comparte la respuesta (un minuto) en vez de pegarle dos veces.
   */
  const enCurso = new Map<string, { hasta: number; tarifas: Promise<Array<Record<string, unknown>>> }>();
  function tarifas(cpOrigen: string, cpDestino: string, m: NonNullable<ReturnType<typeof medidasCorreo>>) {
    const clave = `${cpOrigen}|${cpDestino}|${m.weight}|${m.height}x${m.width}x${m.length}`;
    const ahora = Date.now();
    for (const [k, v] of enCurso) if (v.hasta < ahora) enCurso.delete(k);
    const ya = enCurso.get(clave);
    if (ya) return ya.tarifas;
    const p = llamar<{ rates?: Array<Record<string, unknown>> }>("/rates", {
      method: "POST", cuerpo: { customerId: c.cliente, postalCodeOrigin: cp4(cpOrigen), postalCodeDestination: cp4(cpDestino), dimensions: m },
    }).then((r) => (Array.isArray(r.rates) ? r.rates : []));
    enCurso.set(clave, { hasta: ahora + 60_000, tarifas: p });
    p.catch(() => enCurso.delete(clave));
    return p;
  }

  const tipo = (s: Servicio) => (s === "sucursal" ? "S" : "D");

  return {
    transporte: T,
    servicios: ["domicilio", "sucursal"],
    portalEtiquetas: c.portal ?? PORTAL_MICORREO,

    async cotizar(destino, paquete, servicio, origen): Promise<Cotizacion | null> {
      if (servicio === "en_el_dia") return null;
      const m = medidasCorreo(paquete, MAX_LADO_COTIZAR);
      if (!m) return null; // más de 50 kg o muy grande: Correo no lo lleva
      const delTipo = (await tarifas(origen.cp, destino.cp, m)).filter((t) => texto(t.deliveredType) === tipo(servicio))
        .map((t) => ({ t, precio: aCentavos(t.price) })).filter((x): x is { t: Record<string, unknown>; precio: number } => x.precio !== null);
      // Clásico (CP), que es con el que se carga el envío; si no vino, la más barata.
      const elegida = delTipo.filter((x) => texto(x.t.productType) === "CP").sort((a, b) => a.precio - b.precio)[0]
        ?? [...delTipo].sort((a, b) => a.precio - b.precio)[0];
      if (!elegida) return null;
      const n = (v: unknown) => (texto(v) !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
      return {
        transporte: T, servicio, precio: elegida.precio, plazoMin: n(elegida.t.deliveryTimeMin), plazoMax: n(elegida.t.deliveryTimeMax),
        nombre: texto(elegida.t.productName) || (servicio === "sucursal" ? "Correo Argentino a sucursal" : "Correo Argentino a domicilio"),
      };
    },

    async sucursales(cp, provincia) {
      const codigo = codigoProvincia(provincia);
      if (!codigo) return [];
      const r = await llamar<Array<Json>>(`/agencies?${new URLSearchParams({ customerId: c.cliente, provinceCode: codigo, services: "pickup_availability" })}`);
      const todas = (Array.isArray(r) ? r : [])
        // Sólo las activas y donde el cliente puede retirar.
        .filter((a) => texto(a.status || "ACTIVE").toUpperCase() === "ACTIVE" && a.services?.pickupAvailability !== false && texto(a.code))
        .map((a): Sucursal => {
          const d = a.location?.address ?? {};
          return {
            id: texto(a.code), nombre: texto(a.name) || "Sucursal Correo Argentino",
            direccion: [texto(d.streetName), texto(d.streetNumber)].filter(Boolean).join(" "),
            localidad: texto(d.locality) || texto(d.city), cp: cp4(texto(d.postalCode)), horario: horarioSucursal(a.hours),
          };
        });
      // Las del mismo código postal primero, después las más cercanas por número de CP.
      const num = Number(cp4(cp));
      const dist = (s: Sucursal) => (Number.isFinite(Number(s.cp)) ? Math.abs(Number(s.cp) - num) : 1e6);
      return todas.sort((a, b) => dist(a) - dist(b)).slice(0, 30);
    },

    async crearEnvio(e) {
      const d = e.direccion;
      if (e.servicio === "en_el_dia") throw new ErrorTransporte(T, "Correo Argentino no hace envíos en el día", null, false);
      if (e.servicio === "sucursal" && !e.sucursal) throw new ErrorTransporte(T, "falta la sucursal de destino", null, false);
      if (e.servicio === "domicilio" && !d) throw new ErrorTransporte(T, "falta la dirección de destino", null, false);
      const m = medidasCorreo(e.paquete, MAX_LADO_CARGAR);
      if (!m) throw new ErrorTransporte(T, "el paquete pasa los 50 kg o las medidas que acepta Correo (cada lado hasta 255 cm y los tres sumados hasta 300 cm)", null, false);
      const o = e.origen;
      const dirOrigen = pisoYDepto(o.piso);
      const dirDestino = pisoYDepto(d?.piso);
      const referencia = e.referencia ?? e.pedido;
      const cuerpo = {
        customerId: c.cliente, extOrderId: referencia, orderNumber: e.pedido,
        sender: {
          name: o.nombre, phone: soloDigitos(o.telefono), cellPhone: soloDigitos(o.telefono), email: o.email,
          originAddress: {
            streetName: o.calle, streetNumber: o.numero, floor: dirOrigen.floor, apartment: dirOrigen.apartment,
            city: o.localidad, provinceCode: codigoProvincia(o.provincia), postalCode: o.cp,
          },
        },
        recipient: {
          name: `${e.destinatario.nombre} ${e.destinatario.apellido}`.trim(), phone: soloDigitos(e.destinatario.telefono),
          cellPhone: soloDigitos(e.destinatario.telefono), email: e.destinatario.email,
        },
        shipping: {
          deliveryType: tipo(e.servicio), productType: "CP", agency: e.servicio === "sucursal" ? e.sucursal : null,
          address: d ? {
            streetName: d.calle, streetNumber: d.numero, floor: dirDestino.floor, apartment: dirDestino.apartment,
            city: d.localidad, provinceCode: codigoProvincia(d.provincia), postalCode: d.cp,
          } : null,
          weight: m.weight, declaredValue: Number((Math.max(0, e.paquete.valorDeclarado) / 100).toFixed(2)),
          height: m.height, length: m.length, width: m.width,
        },
      };
      try {
        await llamar<{ createdAt?: string }>("/shipping/import", { method: "POST", cuerpo });
      } catch (err) {
        // La referencia es única por intento: «ya fue importada» = este mismo envío ya entró (un reintento).
        if (!(err instanceof ErrorTransporte && /ya fue importada/i.test(err.message))) throw err;
      }
      return { seguimiento: null, externoId: referencia, etiqueta: null };
    },

    // MiCorreo no da el rótulo por API: se paga e imprime en el portal.
    async etiqueta() { return null; },

    async seguimiento(envio) {
      if (!envio.seguimiento) return [];
      const q = new URLSearchParams({ shippingId: envio.seguimiento });
      const pedirlo = async () => pedirGetConCuerpo<unknown>(T, `${base}/shipping/tracking?${q}`, { shippingId: envio.seguimiento }, { authorization: `Bearer ${await sesion.token()}` });
      let r: unknown;
      try { r = await pedirlo(); } catch (e) {
        if (e instanceof ErrorTransporte && e.status === 401) { sesion.olvidar(); r = await pedirlo().catch(conMensaje); } else conMensaje(e);
      }
      const x = r as Json | Json[] | null;
      // { date, error: "No existe el cliente o pedido", code: "0" }
      if (x && !Array.isArray(x) && texto(x.error)) throw new ErrorTransporte(T, `MiCorreo no encuentra el envío ${envio.seguimiento}: ${texto(x.error)}`, 404, false);
      // MiCorreo los manda del más nuevo al más viejo y con la hora al minuto: se dan vuelta (así, dos en
      // el mismo minuto quedan en el orden en que pasaron) y se ordenan del más viejo al más nuevo.
      const eventos = (Array.isArray(x) ? x : [x]).flatMap((y) => (Array.isArray(y?.events) ? y.events as Json[] : [])).reverse();
      return eventos.map((ev): EventoEnvio => {
        // "dd-mm-aaaa hh:mm" (hora de Argentina)
        // eslint-disable-next-line security/detect-unsafe-regex -- anclada y de largo fijo: no hay retroceso catastrófico
        const f = /^(\d{2})-(\d{2})-(\d{4})(?:\s+(\d{2}):(\d{2}))?/.exec(texto(ev.date));
        const fecha = f ? new Date(`${f[3]}-${f[2]}-${f[1]}T${f[4] ?? "00"}:${f[5] ?? "00"}:00-03:00`) : new Date(texto(ev.date));
        const descripcion = texto(ev.event) || texto(ev.status);
        return { fecha, estado: estadoDeTexto(`${texto(ev.event)} ${texto(ev.status)}`), descripcion, ubicacion: texto(ev.branch) || null };
      }).filter((ev) => !Number.isNaN(ev.fecha.getTime()) && ev.descripcion).sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
    },

    urlSeguimiento: (n) => `https://www.correoargentino.com.ar/formularios/e-commerce?id=${encodeURIComponent(n)}`,

    /** El customerId de una cuenta de MiCorreo (POST /users/validate), para configurar CORREO_AR_CLIENTE. */
    async cliente(email: string, clave: string) {
      const r = await llamar<{ customerId?: string }>("/users/validate", { method: "POST", cuerpo: { email, password: clave } });
      return texto(r.customerId) || null;
    },
  };
}
