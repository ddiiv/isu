import type { NextRequest } from "next/server";
import { SITIO } from "./sitio";

const SEGURO = SITIO.url.startsWith("https://");

/*
 * El origen público de ESTE pedido (tal como lo ve el navegador): detrás de
 * Railway o Cloudflare llega en x-forwarded-proto / x-forwarded-host.
 */
export function origenDelPedido(req: NextRequest): string | null {
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0]!.trim();
  const [nombre, puerto, ...resto] = host.split(":");
  if (resto.length || !nombre || !/^[a-z0-9.-]+$/i.test(nombre) || (puerto !== undefined && !/^\d{1,5}$/.test(puerto))) return null;
  const proto = (req.headers.get("x-forwarded-proto") ?? (SEGURO ? "https" : "http")).split(",")[0]!.trim();
  return `${proto === "https" ? "https" : "http"}://${host.toLowerCase()}`;
}
