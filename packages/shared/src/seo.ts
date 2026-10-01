import { z } from "zod";

/*
 * Redirecciones 301 (migración 0012). Las mismas reglas que la base, para
 * que el backoffice avise antes de guardar y la tienda compare igual.
 */
// El paquete no trae los tipos de Node ni del navegador; URL existe en los dos.
declare const URL: new (url: string, base?: string) => { pathname: string; search: string };

const RUTA_VIEJA = /^\/[a-z0-9._~%!$&'()*+,;=:@/-]*$/;

/**
 * Dirección vieja → la forma en que se guarda y se compara: sólo la ruta, en
 * minúsculas, sin "?", "#" ni barra final. Acepta la dirección completa
 * ("https://www.isuwaya.com/Abel-Pantalon/") o sólo la ruta. null si no sirve
 * (la raíz no se redirige).
 */
export function rutaVieja(entrada: string): string | null {
  let ruta: string;
  try {
    ruta = new URL(entrada.trim(), "https://x.invalid").pathname;
  } catch {
    return null;
  }
  ruta = ruta.toLowerCase().replace(/\/{2,}/g, "/");
  while (ruta.length > 1 && ruta.endsWith("/")) ruta = ruta.slice(0, -1);
  if (ruta === "/" || ruta.length > 300 || !RUTA_VIEJA.test(ruta)) return null;
  if (/^\/(?:_next|api)(?:\/|$)/.test(ruta)) return null;
  return ruta;
}

/**
 * Destino: una ruta de ESTA tienda ("/hombre/remeras", "/buscar?q=lino").
 * Si viene la dirección completa, se queda con la ruta. Nunca otro dominio:
 * una redirección no puede usarse para mandar a un sitio ajeno.
 */
export function rutaPropia(entrada: string): string | null {
  const t = entrada.trim();
  if (!t || /[\s\\]/.test(t)) return null;
  let ruta = t;
  if (/^https?:\/\//i.test(t)) {
    try {
      const u = new URL(t);
      ruta = `${u.pathname}${u.search}`;
    } catch {
      return null;
    }
  }
  if (!/^\/(?:[^/\\]|$)/.test(ruta) || ruta.length > 300) return null;
  return ruta;
}

export const RedireccionEntrada = z.object({
  desde: z.string().max(400).transform((v, ctx) => {
    const r = rutaVieja(v);
    if (!r) ctx.addIssue({ code: "custom", message: "Poné la dirección vieja, por ejemplo /abel-pantalon-hombre" });
    return r ?? "";
  }),
  hacia: z.string().max(400).transform((v, ctx) => {
    const r = rutaPropia(v);
    if (!r) ctx.addIssue({ code: "custom", message: "Tiene que ser una página de esta tienda, por ejemplo /hombre/remeras" });
    return r ?? "/";
  }),
  /** Si era un producto: su SKU de Stocker. Va a su ficha mientras esté publicado. */
  sku: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_.-]{0,99}$/, "SKU inválido").nullable().default(null),
}).strict().refine((r) => r.desde !== r.hacia.split("?")[0], { message: "La dirección vieja y la nueva son la misma", path: ["hacia"] });
export type RedireccionEntrada = z.infer<typeof RedireccionEntrada>;

/** Lo que lee la tienda: dirección vieja → a dónde mandar (ya resuelto). */
export const MapaRedirecciones = z.object({ mapa: z.record(z.string(), z.string()) });
export type MapaRedirecciones = z.infer<typeof MapaRedirecciones>;
