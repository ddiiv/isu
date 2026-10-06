import { NextResponse, type NextRequest } from "next/server";
import { aLaApi, COOKIE_SESION, cookieSesion, mismoOrigen } from "@/lib/bff";

/*
 * Puente navegador → API. Lista cerrada: método + ruta. Lo que no está acá
 * no existe para el navegador (404), aunque exista en la API.
 */
type Regla = {
  metodo: string; patron: RegExp; api: (m: RegExpMatchArray) => string; sesion?: "crea" | "borra"; binario?: boolean;
  /** Parámetros de la URL que pasan (los demás se descartan; la API los valida). */
  consulta?: string[];
};
const NUM = "(ISU-\\d{4,10})";
const REGLAS: Regla[] = [
  { metodo: "POST", patron: /^carrito$/, api: () => "/v1/carrito" },
  { metodo: "POST", patron: /^pedidos$/, api: () => "/v1/pedidos" },
  { metodo: "GET", patron: new RegExp(`^pedidos/${NUM}$`), api: (m) => `/v1/pedidos/${m[1]}` },
  { metodo: "POST", patron: new RegExp(`^pedidos/${NUM}/pagar$`), api: (m) => `/v1/pedidos/${m[1]}/pagar` },
  { metodo: "POST", patron: new RegExp(`^pedidos/${NUM}/comprobante$`), api: (m) => `/v1/pedidos/${m[1]}/comprobante`, binario: true },
  { metodo: "GET", patron: /^cuenta$/, api: () => "/v1/cuenta" },
  { metodo: "PATCH", patron: /^cuenta$/, api: () => "/v1/cuenta" },
  { metodo: "POST", patron: /^cuenta\/registro$/, api: () => "/v1/cuenta/registro", sesion: "crea" },
  { metodo: "POST", patron: /^cuenta\/ingresar$/, api: () => "/v1/cuenta/ingresar", sesion: "crea" },
  { metodo: "POST", patron: /^cuenta\/restablecer$/, api: () => "/v1/cuenta/restablecer", sesion: "crea" },
  { metodo: "POST", patron: /^cuenta\/salir$/, api: () => "/v1/cuenta/salir", sesion: "borra" },
  { metodo: "POST", patron: /^cuenta\/olvide$/, api: () => "/v1/cuenta/olvide" },
  { metodo: "POST", patron: /^cuenta\/contrasena$/, api: () => "/v1/cuenta/contrasena" },
  { metodo: "POST", patron: /^arrepentimiento$/, api: () => "/v1/arrepentimiento" },
  { metodo: "POST", patron: /^outfits$/, api: () => "/v1/outfits" },
  // Etapa 4: envíos y seguimiento.
  { metodo: "POST", patron: /^envios\/opciones$/, api: () => "/v1/envios/opciones" },
  { metodo: "GET", patron: /^envios\/sucursales$/, api: () => "/v1/envios/sucursales", consulta: ["transporte", "cp", "provincia"] },
  { metodo: "GET", patron: new RegExp(`^seguimiento/${NUM}$`), api: (m) => `/v1/seguimiento/${m[1]}`, consulta: ["t"] },
  // Etapa 5: asistente.
  { metodo: "POST", patron: /^chat$/, api: () => "/v1/chat" },
  { metodo: "POST", patron: /^chat\/pedido$/, api: () => "/v1/chat/pedido" },
  { metodo: "POST", patron: /^chat\/voto$/, api: () => "/v1/chat/voto" },
  // Etapa 8: opiniones (ver más / ordenar en la ficha, y opinar con el enlace firmado del mail).
  { metodo: "GET", patron: /^productos\/([a-z0-9-]{1,80})\/resenas$/, api: (m) => `/v1/productos/${m[1]}/resenas`, consulta: ["orden", "pagina"] },
  { metodo: "GET", patron: new RegExp(`^opinar/${NUM}$`), api: (m) => `/v1/opinar/${m[1]}`, consulta: ["t"] },
  { metodo: "POST", patron: new RegExp(`^opinar/${NUM}$`), api: (m) => `/v1/opinar/${m[1]}`, consulta: ["t"] },
];
const ACCESO = /^[A-Za-z0-9_-]{30,40}$/;
const TIPOS_BINARIOS = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"]);
const noExiste = () => NextResponse.json({ error: "no_encontrado", mensaje: "No existe." }, { status: 404 });

async function pasar(req: NextRequest, ctx: { params: Promise<{ ruta: string[] }> }) {
  const ruta = (await ctx.params).ruta.join("/");
  const regla = REGLAS.find((r) => r.metodo === req.method && r.patron.test(ruta));
  if (!regla) return noExiste();
  const m = ruta.match(regla.patron)!;

  if (req.method !== "GET") {
    // CSRF: sólo desde nuestro sitio, y con una cabecera que un formulario ajeno no puede mandar.
    if (!mismoOrigen(req) || req.headers.get("x-isu") !== "1") {
      return NextResponse.json({ error: "origen", mensaje: "Pedido no permitido." }, { status: 403 });
    }
  }
  // ¿Hay sesión? Sin cookie, ni se pregunta: 204 (un 401 ensucia la consola de cada invitado).
  if (req.method === "GET" && ruta === "cuenta" && !req.cookies.get(COOKIE_SESION)?.value) {
    return new NextResponse(null, { status: 204, headers: { "cache-control": "no-store" } });
  }
  const extra: Record<string, string> = {};
  const acceso = req.headers.get("x-isu-acceso");
  if (acceso && ACCESO.test(acceso)) extra["x-isu-acceso"] = acceso;

  let cuerpo: BodyInit | null = null;
  let tipo: string | null = null;
  if (req.method !== "GET") {
    const ct = (req.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (regla.binario) {
      if (!TIPOS_BINARIOS.has(ct)) return NextResponse.json({ error: "tipo", mensaje: "Subí una foto (JPG, PNG) o un PDF." }, { status: 415 });
      const largo = Number(req.headers.get("content-length") ?? 0);
      if (largo > 6 * 1024 * 1024) return NextResponse.json({ error: "demasiado_grande", mensaje: "El archivo pesa más de 6 MB." }, { status: 413 });
      const buf = Buffer.from(await req.arrayBuffer());
      if (buf.length > 6 * 1024 * 1024) return NextResponse.json({ error: "demasiado_grande", mensaje: "El archivo pesa más de 6 MB." }, { status: 413 });
      cuerpo = buf; tipo = ct;
    } else {
      if (ct !== "application/json") return NextResponse.json({ error: "tipo", mensaje: "Sólo JSON." }, { status: 415 });
      const texto = await req.text();
      if (texto.length > 64 * 1024) return NextResponse.json({ error: "demasiado_grande", mensaje: "Pedido demasiado grande." }, { status: 413 });
      cuerpo = texto || "{}"; tipo = "application/json";
    }
  }

  let r: Response;
  try {
    let destino = regla.api(m);
    if (regla.consulta) {
      const q = new URLSearchParams();
      for (const k of regla.consulta) { const v = req.nextUrl.searchParams.get(k); if (v !== null) q.set(k, v.slice(0, 120)); }
      if (q.size) destino += `?${q}`;
    }
    r = await aLaApi(req, destino, { metodo: req.method, cuerpo, tipo, extra });
  } catch {
    return NextResponse.json({ error: "sin_api", mensaje: "No pudimos conectarnos. Probá de nuevo en unos segundos." }, { status: 503 });
  }
  const texto = await r.text();
  const cabeceras: Record<string, string> = { "cache-control": "no-store" };
  const espera = r.headers.get("retry-after");
  if (espera) cabeceras["retry-after"] = espera;

  if (regla.sesion === "borra") {
    return new NextResponse(null, { status: 204, headers: { ...cabeceras, "set-cookie": cookieSesion(null) } });
  }
  if (regla.sesion === "crea" && r.ok) {
    // El token queda en la cookie; al JavaScript de la página no le llega.
    const { token, ...resto } = JSON.parse(texto) as { token: string };
    return NextResponse.json(resto, { status: r.status, headers: { ...cabeceras, "set-cookie": cookieSesion(token) } });
  }
  // Sesión vencida o cerrada en otro lado: se borra la cookie.
  if (r.status === 401 && req.cookies.size) cabeceras["set-cookie"] = cookieSesion(null);
  return new NextResponse(texto || null, { status: r.status, headers: { ...cabeceras, "content-type": r.headers.get("content-type") ?? "application/json" } });
}

export { pasar as GET, pasar as POST, pasar as PATCH };
export const PUT = () => noExiste();
export const DELETE = () => noExiste();
