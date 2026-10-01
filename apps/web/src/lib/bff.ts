import "server-only";
import type { NextRequest } from "next/server";
import { SITIO } from "./sitio";
import { origenDelPedido } from "./origen";

export { origenDelPedido };

/*
 * El navegador nunca habla con la API directo: habla con la tienda (mismo
 * origen) y la tienda le pasa el pedido a la API por la red privada.
 *
 *   · La sesión viaja en una cookie httpOnly (JavaScript no la puede leer,
 *     un XSS no se la puede llevar), SameSite=Lax y, en producción, con el
 *     prefijo __Host- (sólo este dominio, sólo https, sin subdominios).
 *   · Todo pedido que cambia algo tiene que venir de nuestro propio origen
 *     (cabecera Origin) y traer x-isu: 1, que un formulario de otro sitio no
 *     puede poner. Es la defensa contra CSRF.
 *   · Sólo pasan las rutas de la lista; la API ni se entera del resto.
 */
const API = (process.env.API_URL ?? "http://127.0.0.1:4000").replace(/\/+$/, "");
const SEGURO = SITIO.url.startsWith("https://");
export const COOKIE_SESION = SEGURO ? "__Host-isu_s" : "isu_s";
const DIAS = 30;

export function cookieSesion(token: string | null) {
  const base = `${COOKIE_SESION}=${token ?? ""}; Path=/; HttpOnly; SameSite=Lax${SEGURO ? "; Secure" : ""}`;
  return token ? `${base}; Max-Age=${DIAS * 86400}` : `${base}; Max-Age=0`;
}

/** IP del navegador: la que agregó el proxy de confianza más lejano (igual criterio que la API). */
export function ipCliente(req: NextRequest): string {
  const n = Number(process.env.PROXIES_DE_CONFIANZA ?? 0);
  const xff = (req.headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (n > 0 && xff.length) return xff[Math.max(0, xff.length - n)] ?? "0.0.0.0";
  // Sin proxies de confianza (desarrollo) no se cree ninguna cabecera: la puede escribir cualquiera.
  return "127.0.0.1";
}

/*
 * CSRF: el pedido tiene que venir de una página nuestra. Vale el dominio
 * configurado (NEXT_PUBLIC_SITE_URL) y también el mismo sitio por el que se
 * está entrando (la dirección de Railway antes de tener dominio, www y sin
 * www…): la cabecera Origin la pone el navegador y otro sitio no la puede
 * falsificar, así que "Origin = este mismo sitio" es la regla de siempre.
 */
export function mismoOrigen(req: NextRequest): boolean {
  const origen = req.headers.get("origin");
  if (!origen) return false;
  if (origen === new URL(SITIO.url).origin) return true;
  const propio = origenDelPedido(req);
  if (propio && origen === propio) return true;
  // En desarrollo se entra por localhost o 127.0.0.1 indistintamente.
  if (!SEGURO) { const h = req.headers.get("host"); if (h && origen === `http://${h}`) return true; }
  return false;
}

export async function aLaApi(req: NextRequest, ruta: string, init: { metodo: string; cuerpo?: BodyInit | null; tipo?: string | null; extra?: Record<string, string> }) {
  const h: Record<string, string> = { "x-isu-ip": ipCliente(req), ...(init.extra ?? {}) };
  if (process.env.INTERNO_TOKEN) h["x-isu-interno"] = process.env.INTERNO_TOKEN;
  const sesion = req.cookies.get(COOKIE_SESION)?.value;
  if (sesion) h["x-isu-sesion"] = sesion;
  const agente = req.headers.get("user-agent");
  if (agente) h["user-agent"] = agente.slice(0, 200);
  if (init.tipo) h["content-type"] = init.tipo;
  return fetch(`${API}${ruta}`, { method: init.metodo, headers: h, body: init.cuerpo ?? undefined, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000) });
}
