import "server-only";
import type { NextRequest } from "next/server";

/*
 * Puente navegador → API del backoffice, igual criterio que la tienda:
 *
 *   · La sesión viaja en una cookie httpOnly, SameSite=Strict (ni siquiera
 *     un enlace desde otro sitio la manda) y, en producción, __Host- y Secure.
 *     Dura como la sesión de la API: 12 h como máximo, 30 min sin uso.
 *   · Todo lo que cambia algo tiene que venir de este mismo origen y con
 *     x-isu: 1 (defensa CSRF).
 *   · Sólo se pasa a /v1/admin/…: la API controla sesión, doble factor y rol
 *     en cada ruta, y deja todo auditado.
 */
const API = (process.env.API_URL ?? "http://127.0.0.1:4000").replace(/\/+$/, "");
export const ORIGEN = new URL(process.env.ADMIN_URL ?? "http://localhost:3001").origin;
const SEGURO = ORIGEN.startsWith("https://");
export const COOKIE_ADMIN = SEGURO ? "__Host-isu_adm" : "isu_adm";

export function cookieAdmin(token: string | null) {
  const base = `${COOKIE_ADMIN}=${token ?? ""}; Path=/; HttpOnly; SameSite=Strict${SEGURO ? "; Secure" : ""}`;
  return token ? `${base}; Max-Age=${12 * 3600}` : `${base}; Max-Age=0`;
}

export function ipCliente(req: NextRequest): string {
  const n = Number(process.env.PROXIES_DE_CONFIANZA ?? 0);
  const xff = (req.headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (n > 0 && xff.length) return xff[Math.max(0, xff.length - n)] ?? "0.0.0.0";
  return "127.0.0.1";
}

export function mismoOrigen(req: NextRequest): boolean {
  const origen = req.headers.get("origin");
  if (!origen) return false;
  if (origen === ORIGEN) return true;
  // En desarrollo se entra por localhost o 127.0.0.1 indistintamente.
  return !SEGURO && origen === `http://${req.headers.get("host")}`;
}

export async function aLaApi(req: NextRequest, ruta: string, init: { metodo: string; cuerpo?: BodyInit | null; tipo?: string | null }) {
  const h: Record<string, string> = { "x-isu-ip": ipCliente(req) };
  if (process.env.INTERNO_TOKEN) h["x-isu-interno"] = process.env.INTERNO_TOKEN;
  const sesion = req.cookies.get(COOKIE_ADMIN)?.value;
  if (sesion) h["x-isu-admin"] = sesion;
  const agente = req.headers.get("user-agent");
  if (agente) h["user-agent"] = agente.slice(0, 200);
  if (init.tipo) h["content-type"] = init.tipo;
  return fetch(`${API}${ruta}`, { method: init.metodo, headers: h, body: init.cuerpo ?? undefined, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(60_000) });
}
