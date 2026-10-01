import { readFileSync } from "node:fs";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { SITIO } from "@/lib/sitio";
import { origenDelPedido } from "@/lib/bff";

/*
 * ¿La tienda está bien conectada? Para diagnosticar una instalación
 * (pnpm diagnostico <url>). Sólo dice sí/no y cuánto tardó: ninguna
 * dirección interna, credencial ni dato de clientes.
 */
export const dynamic = "force-dynamic";
const API = (process.env.API_URL ?? "http://127.0.0.1:4000").replace(/\/+$/, "");

async function medir(url: string, cabeceras: HeadersInit = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: cabeceras, cache: "no-store", signal: AbortSignal.timeout(5000), redirect: "error" });
    return { ok: r.ok, estado: r.status, ms: Date.now() - t0, cuerpo: await r.json().catch(() => null) as unknown };
  } catch (e) {
    return { ok: false, estado: 0, ms: Date.now() - t0, error: (e as Error).name === "TimeoutError" ? "no contesta (5 s)" : "no se puede conectar", cuerpo: null };
  }
}

export async function GET(req: NextRequest) {
  const interno: HeadersInit = process.env.INTERNO_TOKEN ? { "x-isu-interno": process.env.INTERNO_TOKEN } : {};
  const [listo, slugs] = await Promise.all([medir(`${API}/readyz`), medir(`${API}/v1/productos-slugs`, interno)]);
  const r = listo.cuerpo as { db?: boolean; redis?: boolean } | null;
  let build: string | null = null;
  try { build = readFileSync(path.join(process.cwd(), ".next/BUILD_ID"), "utf8").trim(); } catch { /* en desarrollo no hay */ }
  const entraste = origenDelPedido(req);
  return NextResponse.json({
    tienda: true,
    build,
    api: { conecta: listo.estado !== 0, ok: listo.ok, ms: listo.ms, error: listo.error ?? null },
    base: r?.db ?? null,
    redis: r?.redis ?? null,
    productos: slugs.ok && Array.isArray(slugs.cuerpo) ? slugs.cuerpo.length : null,
    // Sin la credencial interna, la API cuenta cada página de la tienda como un visitante más y la frena.
    credencialInterna: !!process.env.INTERNO_TOKEN,
    sitioConfigurado: new URL(SITIO.url).origin,
    entraste,
    coincide: entraste === new URL(SITIO.url).origin,
  }, { headers: { "cache-control": "no-store" } });
}
