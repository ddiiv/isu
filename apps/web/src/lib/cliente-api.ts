"use client";

/*
 * Llamadas desde el navegador a la tienda (/api/t/…). Siempre con x-isu: 1
 * (defensa CSRF) y con el token de acceso del pedido cuando corresponde.
 */
export class ErrorApi extends Error {
  constructor(public status: number, public codigo: string, mensaje: string, public datos: Record<string, unknown> = {}) { super(mensaje); }
}

export async function api<T>(ruta: string, opciones: { metodo?: string; cuerpo?: unknown; acceso?: string | null; archivo?: File } = {}): Promise<T> {
  const h: Record<string, string> = { "x-isu": "1" };
  if (opciones.acceso) h["x-isu-acceso"] = opciones.acceso;
  let body: BodyInit | undefined;
  if (opciones.archivo) { body = opciones.archivo; h["content-type"] = opciones.archivo.type || "application/octet-stream"; }
  else if (opciones.cuerpo !== undefined) { body = JSON.stringify(opciones.cuerpo); h["content-type"] = "application/json"; }
  let r: Response;
  try {
    // Con tope: si la tienda no contesta, mejor un mensaje que una pantalla "cargando" para siempre.
    r = await fetch(`/api/t/${ruta}`, { method: opciones.metodo ?? (body ? "POST" : "GET"), headers: h, body, credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(opciones.archivo ? 60_000 : 25_000) });
  } catch (e) {
    if ((e as Error).name === "TimeoutError") throw new ErrorApi(0, "tiempo", "La tienda está tardando en responder. Probá de nuevo en unos segundos.");
    throw new ErrorApi(0, "red", "No hay conexión. Revisá internet y probá de nuevo.");
  }
  if (r.status === 204) return undefined as T;
  const datos = await r.json().catch(() => ({})) as Record<string, unknown>;
  if (!r.ok) throw new ErrorApi(r.status, String(datos.error ?? "error"), String(datos.mensaje ?? "Algo salió mal. Probá de nuevo."), datos);
  return datos as T;
}

/* Tokens de acceso a los pedidos hechos desde este navegador (para verlos sin cuenta). */
const CLAVE = "isu:pedidos";
export function guardarAcceso(numero: string, acceso: string) {
  try {
    const m = JSON.parse(localStorage.getItem(CLAVE) ?? "{}") as Record<string, string>;
    m[numero] = acceso;
    // Sólo los últimos 20.
    const recientes = Object.fromEntries(Object.entries(m).slice(-20));
    localStorage.setItem(CLAVE, JSON.stringify(recientes));
  } catch { /* modo privado: se usa el enlace del mail */ }
}
export function leerAcceso(numero: string): string | null {
  try { return (JSON.parse(localStorage.getItem(CLAVE) ?? "{}") as Record<string, string>)[numero] ?? null; } catch { return null; }
}
