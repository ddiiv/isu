import http from "node:http";
import https from "node:https";
import { XMLParser } from "fast-xml-parser";

/*
 * Pedidos a los transportes: con tiempo máximo, sin seguir redirecciones y
 * con un error que dice de quién fue y si vale la pena reintentar.
 *
 * Los mensajes de error de un transporte NO se le muestran al cliente (pueden
 * traer datos internos): quedan en el log y en el backoffice.
 */
export class ErrorTransporte extends Error {
  constructor(public transporte: string, mensaje: string, public status: number | null = null, public reintentable = true) {
    super(`${transporte}: ${mensaje}`);
  }
}

type Tipo = "json" | "texto" | "binario";
export interface OpcionesPedido extends Omit<RequestInit, "body"> {
  cuerpo?: unknown;
  form?: Record<string, string>;
  tipo?: Tipo;
  timeoutMs?: number;
}

export async function pedir<T = unknown>(transporte: string, url: string, o: OpcionesPedido = {}): Promise<T> {
  const cabeceras = new Headers(o.headers);
  let body: string | undefined;
  if (o.cuerpo !== undefined) { body = JSON.stringify(o.cuerpo); cabeceras.set("content-type", "application/json"); }
  if (o.form) { body = new URLSearchParams(o.form).toString(); cabeceras.set("content-type", "application/x-www-form-urlencoded"); }
  let r: Response;
  try {
    r = await fetch(url, { ...o, headers: cabeceras, body, redirect: "error", signal: AbortSignal.timeout(o.timeoutMs ?? 15_000) });
  } catch (e) {
    throw new ErrorTransporte(transporte, `sin respuesta (${(e as Error).name === "TimeoutError" ? "tiempo agotado" : (e as Error).message})`);
  }
  if (!r.ok) {
    const texto = (await r.text().catch(() => "")).slice(0, 300);
    // 4xx: el pedido está mal (datos, credenciales); reintentar igual no lo arregla. 429 sí.
    throw new ErrorTransporte(transporte, `HTTP ${r.status} ${texto}`, r.status, r.status >= 500 || r.status === 429);
  }
  const tipo = o.tipo ?? "json";
  if (tipo === "binario") return Buffer.from(await r.arrayBuffer()) as T;
  if (tipo === "texto") return (await r.text()) as T;
  try { return (await r.json()) as T; } catch { throw new ErrorTransporte(transporte, "respuesta que no es JSON", r.status, false); }
}

/**
 * GET con cuerpo JSON: MiCorreo pide así el seguimiento (/shipping/tracking)
 * y fetch no deja mandar cuerpo en un GET. Mismas reglas que pedir(): tiempo
 * máximo, sin redirecciones, tope de tamaño y el mismo error.
 */
export function pedirGetConCuerpo<T = unknown>(transporte: string, url: string, cuerpo: unknown, headers: Record<string, string> = {}, timeoutMs = 15_000): Promise<T> {
  const u = new URL(url);
  const lib = u.protocol === "https:" ? https : u.protocol === "http:" ? http : null;
  if (!lib) return Promise.reject(new ErrorTransporte(transporte, "dirección inválida", null, false));
  const datos = Buffer.from(JSON.stringify(cuerpo));
  return new Promise<T>((ok, mal) => {
    const req = lib.request(u, {
      method: "GET", timeout: timeoutMs,
      headers: { ...headers, accept: "application/json", "content-type": "application/json", "content-length": String(datos.length) },
    }, (res) => {
      const partes: Buffer[] = [];
      let largo = 0;
      res.on("data", (c: Buffer) => {
        largo += c.length;
        if (largo > 2_000_000) { req.destroy(new Error("respuesta demasiado grande")); return; }
        partes.push(c);
      });
      res.on("end", () => {
        const st = res.statusCode ?? 0;
        const txt = Buffer.concat(partes).toString("utf8");
        if (st >= 300 && st < 400) return mal(new ErrorTransporte(transporte, `HTTP ${st} (redirección)`, st, false));
        if (st < 200 || st >= 300) return mal(new ErrorTransporte(transporte, `HTTP ${st} ${txt.slice(0, 300)}`, st, st >= 500 || st === 429));
        try { ok(JSON.parse(txt) as T); } catch { mal(new ErrorTransporte(transporte, "respuesta que no es JSON", st, false)); }
      });
      res.on("error", (e) => mal(new ErrorTransporte(transporte, `sin respuesta (${e.message})`)));
    });
    req.on("timeout", () => req.destroy(new Error("tiempo agotado")));
    req.on("error", (e) => mal(new ErrorTransporte(transporte, `sin respuesta (${e.message})`)));
    req.end(datos);
  });
}

/** Un token que vence: se pide una vez y se reusa hasta un minuto antes de que expire. */
export function conToken(obtener: () => Promise<{ valor: string; segundos: number }>) {
  let actual: { valor: string; hasta: number } | null = null;
  let enVuelo: Promise<string> | null = null;
  return {
    async token(): Promise<string> {
      if (actual && actual.hasta > Date.now()) return actual.valor;
      enVuelo ??= obtener().then((t) => {
        actual = { valor: t.valor, hasta: Date.now() + Math.max(60, t.segundos - 60) * 1000 };
        return t.valor;
      }).finally(() => { enVuelo = null; });
      return enVuelo;
    },
    olvidar() { actual = null; },
  };
}

const lector = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", parseTagValue: false, trimValues: true, processEntities: true, htmlEntities: false });
/** XML → objeto (para OCA). Sin entidades externas ni DTD: el parser no las resuelve. */
export function leerXml(texto: string): Record<string, unknown> {
  if (/<!DOCTYPE|<!ENTITY/i.test(texto)) throw new ErrorTransporte("xml", "respuesta con DTD: rechazada", null, false);
  return lector.parse(texto) as Record<string, unknown>;
}
/** Busca todas las apariciones de una etiqueta, a cualquier profundidad. */
export function buscarTodos(nodo: unknown, etiqueta: string): Record<string, unknown>[] {
  const salida: Record<string, unknown>[] = [];
  const visitar = (n: unknown) => {
    if (Array.isArray(n)) { n.forEach(visitar); return; }
    if (!n || typeof n !== "object") return;
    for (const [k, v] of Object.entries(n)) {
      if (k === etiqueta) (Array.isArray(v) ? v : [v]).forEach((x) => { if (x && typeof x === "object") salida.push(x as Record<string, unknown>); });
      visitar(v);
    }
  };
  visitar(nodo);
  return salida;
}

export const aCentavos = (pesos: unknown): number | null => {
  const n = typeof pesos === "string" ? Number(pesos.replace(",", ".")) : Number(pesos);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};
export const texto = (v: unknown): string => (v === null || v === undefined ? "" : String(v)).trim();
export const escaparXml = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);

/** JSON de una API de terceros: cada campo se lee y valida al usarlo (texto(), aCentavos()…). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ver arriba
export type Json = Record<string, any>;
