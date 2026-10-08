"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/*
 * Llamadas del backoffice a /api/a/… (siempre con x-isu: 1). Sin sesión se
 * vuelve al ingreso; con la clave provisoria, a cambiarla.
 */
export class ErrorApi extends Error {
  constructor(public status: number, public codigo: string, mensaje: string, public datos: Record<string, unknown> = {}) { super(mensaje); }
}

export async function api<T = unknown>(ruta: string, o: { metodo?: string; cuerpo?: unknown; archivo?: File; query?: Record<string, string | number | undefined | null> } = {}): Promise<T> {
  const h: Record<string, string> = { "x-isu": "1" };
  let body: BodyInit | undefined;
  if (o.archivo) { body = o.archivo; h["content-type"] = o.archivo.type || "application/octet-stream"; }
  else if (o.cuerpo !== undefined) { body = JSON.stringify(o.cuerpo); h["content-type"] = "application/json"; }
  const q = o.query ? new URLSearchParams(Object.entries(o.query).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)])).toString() : "";
  let r: Response;
  try {
    r = await fetch(`/api/a/${ruta}${q ? `?${q}` : ""}`, { method: o.metodo ?? (body ? "POST" : "GET"), headers: h, body, credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(o.archivo ? 120_000 : 30_000) });
  } catch (e) {
    if ((e as Error).name === "TimeoutError") throw new ErrorApi(0, "tiempo", "El servidor está tardando en responder. Probá de nuevo en unos segundos.");
    throw new ErrorApi(0, "red", "No hay conexión. Revisá internet y probá de nuevo.");
  }
  if (r.status === 204) return undefined as T;
  const datos = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) {
    const e = new ErrorApi(r.status, String(datos.error ?? "error"), String(datos.mensaje ?? "Algo salió mal."), datos);
    if (typeof window !== "undefined" && !ruta.startsWith("ingresar") && !ruta.startsWith("2fa")) {
      if (r.status === 401) window.location.href = `/ingresar?volver=${encodeURIComponent(location.pathname)}`;
      else if (e.codigo === "cambiar_clave") window.location.href = "/cambiar-clave";
    }
    throw e;
  }
  return datos as T;
}

/** Carga de datos con "recargar". `null` en la ruta = todavía no se puede pedir. */
export function useDatos<T>(ruta: string | null, query?: Record<string, string | number | undefined | null>) {
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const clave = JSON.stringify([ruta, query]);
  const ultima = useRef(0);
  const recargar = useCallback(async () => {
    if (!ruta) return;
    const n = ++ultima.current;
    setCargando(true);
    try {
      const d = await api<T>(ruta, { query });
      if (n === ultima.current) { setDatos(d); setError(null); }
    } catch (e) {
      if (n === ultima.current) setError((e as Error).message);
    } finally {
      if (n === ultima.current) setCargando(false);
    }
    // `clave` resume ruta y consulta: con eso alcanza para saber cuándo volver a pedir.
  }, [clave]);
  useEffect(() => { void recargar(); }, [recargar]);
  return { datos, error, cargando, recargar, setDatos };
}

export const pesos = (centavos: number | null | undefined) =>
  centavos === null || centavos === undefined ? "—" : `$ ${(centavos / 100).toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;
export const fecha = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
const CDN = (process.env.NEXT_PUBLIC_CDN_IMAGENES ?? "").split(",")[0]?.trim() || "/fotos";
export const fotoUrl = (clave: string, ancho: 400 | 800 | 1600 = 400) => `${CDN.replace(/\/+$/, "")}/${clave}-${ancho}.webp`;

export const ESTADOS: Record<string, [string, string]> = {
  reservando: ["Reservando", "bg-fondo-suave text-tinta-suave"],
  esperando_pago: ["Esperando pago", "bg-amber-50 text-amber-800"],
  esperando_transferencia: ["Esperando transferencia", "bg-amber-50 text-amber-800"],
  transferencia_informada: ["Transferencia informada", "bg-orange-100 text-orange-800"],
  a_pagar_en_local: ["Paga en el local", "bg-amber-50 text-amber-800"],
  pagado: ["Pagado", "bg-ahorro-claro text-ahorro"],
  pagado_tarde: ["Pagado tarde · revisar", "bg-red-50 text-oferta"],
  listo_para_retirar: ["Listo para retirar", "bg-marca-claro text-marca"],
  retirado: ["Retirado", "bg-fondo-suave text-tinta"],
  enviado: ["Enviado", "bg-marca-claro text-marca"],
  entregado: ["Entregado", "bg-fondo-suave text-tinta"],
  vencido: ["Vencido", "bg-fondo-suave text-tinta-tenue"],
  cancelado: ["Cancelado", "bg-fondo-suave text-tinta-tenue"],
  sin_stock: ["Sin stock", "bg-red-50 text-oferta"],
  error_reserva: ["Error de reserva", "bg-red-50 text-oferta"],
  sin_confirmar: ["Sin confirmar", "bg-fondo-suave text-tinta-tenue"],
};
export const MEDIOS: Record<string, string> = { mercadopago: "Mercado Pago", pagofacil: "Pago Fácil", transferencia: "Transferencia", local: "En el local" };
