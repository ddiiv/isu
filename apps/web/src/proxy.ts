import { NextResponse, type NextRequest } from "next/server";
import { MapaRedirecciones, rutaVieja } from "@isu/shared";
import { SITIO } from "@/lib/sitio";
import { origenDelPedido } from "@/lib/origen";
import { estadoRedirecciones } from "@/lib/redirecciones";

/*
 * Redirecciones 301 de la tienda anterior (backoffice → Redirecciones).
 *
 * Corre antes de armar cada página. El mapa vive en memoria y se renueva
 * cada 5 minutos en segundo plano, o enseguida cuando el worker avisa que
 * cambió el catálogo (/api/revalidar): la visita nunca espera a la API (salvo
 * la primera después de arrancar o de un aviso, como mucho 1,5 s). Si la API no contesta,
 * sigue con el último mapa que tuvo; sin mapa, la página sigue de largo
 * (la tienda nunca deja de andar por esto).
 */
const API = (process.env.API_URL ?? "http://127.0.0.1:4000").replace(/\/+$/, "");
const CABECERAS: HeadersInit = process.env.INTERNO_TOKEN ? { "x-isu-interno": process.env.INTERNO_TOKEN } : {};
const VIGENCIA = 5 * 60_000;
const REINTENTO = 30_000;
/*
 * A qué dominio redirigir: al configurado (NEXT_PUBLIC_SITE_URL), que es el
 * canónico. Si todavía no hay uno (se entra por la dirección de Railway o en
 * local), al dominio por el que se entró, pero sólo si es uno conocido: la
 * dirección pública de Railway (RAILWAY_PUBLIC_DOMAIN) o la de esta máquina.
 * Nunca el Host que manda el visitante tal cual: una redirección guardada en
 * una caché con un Host falso mandaría a todos a otro sitio.
 */
const SITIO_ORIGEN = new URL(SITIO.url).origin;
const SITIO_LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(SITIO.url).hostname);
const CONOCIDOS = new Set([new URL(SITIO.url).host, process.env.RAILWAY_PUBLIC_DOMAIN, "localhost:3000", "127.0.0.1:3000"].filter(Boolean).map((h) => h!.toLowerCase()));
function base(req: NextRequest): string {
  if (!SITIO_LOCAL) return SITIO_ORIGEN;
  const propio = origenDelPedido(req);
  return propio && CONOCIDOS.has(new URL(propio).host) ? propio : SITIO_ORIGEN;
}

const estado = estadoRedirecciones();
let enVuelo: Promise<void> | null = null;

function renovar(): Promise<void> {
  enVuelo ??= fetch(`${API}/v1/redirecciones`, { headers: CABECERAS, cache: "no-store", signal: AbortSignal.timeout(3000) })
    .then(async (r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      estado.mapa = MapaRedirecciones.parse(await r.json()).mapa;
      estado.vence = Date.now() + VIGENCIA;
    })
    .catch((e: Error) => {
      estado.vence = Date.now() + REINTENTO;
      console.warn(`[redirecciones] no se pudo leer el mapa: ${e.message}${estado.mapa ? " (sigue el anterior)" : ""}`);
    })
    .finally(() => { enVuelo = null; });
  return enVuelo;
}

export async function proxy(req: NextRequest) {
  const ruta = rutaVieja(req.nextUrl.pathname);
  if (!ruta) return NextResponse.next();
  if (Date.now() > estado.vence) {
    const r = renovar();
    // Sin mapa (recién arrancó) o recién avisado un cambio: esperar la respuesta, como mucho 1,5 s.
    if (!estado.mapa || estado.vence === 0) await Promise.race([r, new Promise((s) => setTimeout(s, 1500))]);
  }
  const hacia = estado.mapa?.[ruta];
  if (!hacia) return NextResponse.next();
  // Lo que traía la dirección vieja (?utm_source=…) se conserva si el destino no trae lo suyo.
  const destino = hacia.includes("?") || !req.nextUrl.search ? hacia : `${hacia}${req.nextUrl.search}`;
  if (!destino.startsWith("/") || destino.startsWith("//")) return NextResponse.next();
  return NextResponse.redirect(new URL(destino, base(req)), {
    status: 301,
    headers: SITIO_LOCAL ? { "cache-control": "no-store" } : { "cache-control": "public, max-age=3600" },
  });
}

export const config = {
  // Páginas, no archivos: ni /_next, ni /api, ni nada con extensión (.png, .xml, .txt…).
  matcher: ["/((?!_next/|api/|.*\\.[a-zA-Z0-9]{2,5}$).*)"],
};
