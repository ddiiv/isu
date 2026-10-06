import { NextResponse, type NextRequest } from "next/server";
import { aLaApi, COOKIE_ADMIN, cookieAdmin, mismoOrigen } from "@/lib/bff";

/*
 * /api/a/<ruta> → API /v1/admin/<ruta>. Cada tramo de la ruta es texto
 * simple (letras, números, guiones): nada de "..", barras codificadas ni
 * caracteres raros que la API pudiera interpretar distinto.
 */
const TRAMO = /^[A-Za-z0-9_-]{1,80}$/;
// Fotos de productos y de los banners de la portada (etapa 8).
const FOTOS = /^(productos\/\d{1,10}\/fotos|banners\/\d{1,10}\/foto)$/;
const IMAGENES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/avif"]);
const MAX_JSON = 256 * 1024;
const MAX_FOTO = 25 * 1024 * 1024;
// Las respuestas de estas rutas traen el token de sesión: va a la cookie, no a la página.
const CREAN_SESION = new Set(["ingresar", "2fa"]);

const error = (status: number, codigo: string, mensaje: string) => NextResponse.json({ error: codigo, mensaje }, { status, headers: { "cache-control": "no-store" } });

async function pasar(req: NextRequest, ctx: { params: Promise<{ ruta: string[] }> }) {
  const tramos = (await ctx.params).ruta;
  if (!tramos.length || tramos.length > 6 || !tramos.every((t) => TRAMO.test(t))) return error(404, "no_encontrado", "No existe.");
  const ruta = tramos.join("/");
  // ¿Hay sesión? Sin cookie ni se pregunta: 204 (el marco manda al ingreso sin ensuciar la consola).
  if (req.method === "GET" && ruta === "yo" && !req.cookies.get(COOKIE_ADMIN)?.value) return new NextResponse(null, { status: 204, headers: { "cache-control": "no-store" } });
  const busqueda = req.nextUrl.search;
  if (busqueda.length > 600) return error(414, "demasiado_largo", "Búsqueda demasiado larga.");

  let cuerpo: BodyInit | null = null;
  let tipo: string | null = null;
  if (req.method !== "GET") {
    if (!mismoOrigen(req) || req.headers.get("x-isu") !== "1") return error(403, "origen", "Pedido no permitido.");
    const ct = (req.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (FOTOS.test(ruta) && req.method === "POST") {
      if (!IMAGENES.has(ct)) return error(415, "tipo", "Subí una foto JPG, PNG, WEBP o HEIC.");
      if (Number(req.headers.get("content-length") ?? 0) > MAX_FOTO) return error(413, "demasiado_grande", "La foto pesa más de 25 MB.");
      const buf = Buffer.from(await req.arrayBuffer());
      if (buf.length > MAX_FOTO) return error(413, "demasiado_grande", "La foto pesa más de 25 MB.");
      cuerpo = buf; tipo = ct;
    } else {
      const texto = await req.text();
      if (texto.length > MAX_JSON) return error(413, "demasiado_grande", "Pedido demasiado grande.");
      if (texto) {
        if (ct !== "application/json") return error(415, "tipo", "Sólo JSON.");
        cuerpo = texto; tipo = "application/json";
      }
    }
  }

  let r: Response;
  try {
    r = await aLaApi(req, `/v1/admin/${ruta}${busqueda}`, { metodo: req.method, cuerpo, tipo });
  } catch {
    return error(503, "sin_api", "No hay conexión con la API. Probá de nuevo en unos segundos.");
  }
  const cabeceras: Record<string, string> = { "cache-control": "no-store" };
  const espera = r.headers.get("retry-after");
  if (espera) cabeceras["retry-after"] = espera;
  if (r.status === 401 && req.cookies.get(COOKIE_ADMIN)) cabeceras["set-cookie"] = cookieAdmin(null);

  // Descargas (comprobantes): tal cual, como adjunto.
  const disposicion = r.headers.get("content-disposition");
  if (disposicion) {
    return new NextResponse(await r.arrayBuffer(), {
      status: r.status,
      headers: { ...cabeceras, "content-type": r.headers.get("content-type") ?? "application/octet-stream", "content-disposition": disposicion, "content-security-policy": "default-src 'none'; sandbox", "x-content-type-options": "nosniff",
        // Etiquetas: qué pedidos no tenían etiqueta para imprimir.
        ...(r.headers.get("x-isu-sin-etiqueta") ? { "x-isu-sin-etiqueta": r.headers.get("x-isu-sin-etiqueta")!.slice(0, 400) } : {}) },
    });
  }
  if (ruta === "salir") return new NextResponse(null, { status: 204, headers: { ...cabeceras, "set-cookie": cookieAdmin(null) } });
  const texto = await r.text();
  if (CREAN_SESION.has(ruta) && r.ok && req.method === "POST") {
    const { token, ...resto } = JSON.parse(texto) as { token: string };
    return NextResponse.json(resto, { status: r.status, headers: { ...cabeceras, "set-cookie": cookieAdmin(token) } });
  }
  return new NextResponse(texto || null, { status: r.status, headers: { ...cabeceras, ...(texto ? { "content-type": r.headers.get("content-type") ?? "application/json" } : {}) } });
}

export { pasar as GET, pasar as POST, pasar as PATCH, pasar as PUT, pasar as DELETE };
