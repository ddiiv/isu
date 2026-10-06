import "server-only";
import { BannerPublico, ConfigPublica, CategoriaNodo, ListadoProductos, PACKS_POR_DEFECTO, ProductoDetalle, ResenasInicio, ResenasProducto } from "@isu/shared";
import { z } from "zod";

/*
 * Lectura de la API desde el servidor de Next (nunca desde el navegador para
 * estos datos: van incrustados en el HTML estático).
 *
 * API_URL es la dirección interna de Railway (red privada). Si la API no
 * responde —en el build o en producción— la página se arma igual con los
 * valores de respaldo: una tienda que no carga porque se cayó la API es peor
 * que una con un dato viejo por un minuto.
 */
const API = (process.env.API_URL ?? "http://127.0.0.1:4000").replace(/\/+$/, "");
const REVALIDAR = 60;
// El servidor de la tienda se identifica ante la API: no cuenta para el límite de pedidos por IP.
const CABECERAS: HeadersInit = process.env.INTERNO_TOKEN ? { "x-isu-interno": process.env.INTERNO_TOKEN } : {};

async function pedir<T>(ruta: string, esquema: z.ZodType<T>, respaldo: T): Promise<T> {
  try {
    const r = await fetch(`${API}${ruta}`, {
      headers: CABECERAS,
      // "catalogo": un cambio en el backoffice (Ajustes, categorías) regenera también esto, no a los 60 s.
      next: { revalidate: REVALIDAR, tags: [ruta, "catalogo"] },
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return esquema.parse(await r.json());
  } catch (err) {
    console.warn(`[api] ${ruta}: ${(err as Error).message} — se usan valores de respaldo`);
    return respaldo;
  }
}

export const CONFIG_RESPALDO: ConfigPublica = {
  montoMinimoCarrito: 0,
  envioGratisDesde: null,
  descuentoTransferencia: 20,
  cuotasSinInteres: 3,
  whatsapp: "5491168515444",
  email: "isu.isuwaya@gmail.com",
  anuncio: "Envíos a toda la Argentina · 3 cuotas sin interés · 20% OFF con transferencia",
  avisoUltimas: 3,
  mostrarAgotados: true,
  mediosPago: ["mercadopago", "pagofacil", "transferencia", "local"],
  costoEnvio: 790_000,
  locales: [
    { nombre: "Vía Flores · Local 21", direccion: "Bacacay 3231, Galería Vía Flores", localidad: "Flores, CABA", horario: "Lunes a viernes de 8 a 14 h", mapa: null, retiro: true },
  ],
  // Sin API no hay asistente: queda el botón de WhatsApp.
  chatbot: { activo: false, saludo: "" },
  packs: PACKS_POR_DEFECTO,
  hayPacks: false,
  cuidados: "",
  cifras: [],
};

export const CATEGORIAS_RESPALDO: CategoriaNodo[] = [
  { id: -1, nombre: "Hombre", slug: "hombre", hijas: [] },
  { id: -2, nombre: "Mujer", slug: "mujer", hijas: [] },
  { id: -3, nombre: "Niños", slug: "ninos", hijas: [] },
];

/*
 * ¿Contesta la API ahora? Sin caché (la de datos puede traer respuestas de un
 * build anterior). Lo usan las listas de páginas a generar en el build: en
 * Railway el build no llega a la red interna, y sin API no se pre-genera
 * nada (cada página se arma en su primera visita) en vez de fallar el build.
 */
let disponible: Promise<boolean> | null = null;
export function apiDisponible(): Promise<boolean> {
  disponible ??= fetch(`${API}/healthz`, { cache: "no-store", signal: AbortSignal.timeout(2500) })
    .then((r) => r.ok, () => false)
    .then((ok) => { if (!ok) console.warn(`[api] ${API} no contesta: las páginas del catálogo se arman en la primera visita`); return ok; });
  return disponible;
}

export const obtenerConfig = () => pedir("/v1/config", ConfigPublica, CONFIG_RESPALDO);
export const obtenerCategorias = () => pedir("/v1/categorias", z.array(CategoriaNodo), CATEGORIAS_RESPALDO);

/*
 * Catálogo. Las grillas se etiquetan "catalogo" y cada ficha "producto:<slug>":
 * cuando el worker aplica un cambio de Stocker, le pide a /api/revalidar que
 * regenere exactamente esas páginas. El vencimiento de 5 minutos es la red
 * de seguridad por si ese aviso se pierde.
 */
const LISTADO_VACIO: ListadoProductos = { productos: [], total: 0 };
const CATALOGO = 300;

async function pedirCatalogo<T>(ruta: string, esquema: z.ZodType<T>, tags: string[], opciones: { sinCache?: boolean } = {}): Promise<T | null> {
  const r = await fetch(`${API}${ruta}`, {
    headers: CABECERAS,
    ...(opciones.sinCache ? { cache: "no-store" as const } : { next: { revalidate: CATALOGO, tags } }),
    signal: AbortSignal.timeout(6000),
  });
  if (r.status === 404) return null;
  // Otro error: que falle. En una página ya generada, Next sigue mostrando la
  // versión anterior hasta que la API vuelva (mejor que una grilla vacía).
  if (!r.ok) throw new Error(`API ${ruta}: HTTP ${r.status}`);
  return esquema.parse(await r.json());
}

export async function obtenerProductos(categoria: string, sub?: string): Promise<ListadoProductos | null> {
  const q = new URLSearchParams({ categoria, ...(sub ? { sub } : {}) });
  return pedirCatalogo(`/v1/productos?${q}`, ListadoProductos, ["catalogo"]);
}

/** Lo nuevo (home, 404). Si la API no está, se muestra la página sin esta sección. */
export async function obtenerNuevos(cantidad = 8): Promise<ListadoProductos> {
  try {
    return (await pedirCatalogo(`/v1/productos?nuevos=${cantidad}`, ListadoProductos, ["catalogo"])) ?? LISTADO_VACIO;
  } catch (err) {
    console.warn(`[api] nuevos: ${(err as Error).message}`);
    return LISTADO_VACIO;
  }
}

/** Colecciones elegidas a mano en el backoffice (casillas "Destacado", "Nuevo" y "Pack"). */
export async function obtenerColeccion(cual: "nuevos" | "destacados" | "packs", limite = 200): Promise<ListadoProductos> {
  try {
    return (await pedirCatalogo(`/v1/productos?coleccion=${cual}&limite=${limite}`, ListadoProductos, ["catalogo"])) ?? LISTADO_VACIO;
  } catch (err) {
    console.warn(`[api] ${cual}: ${(err as Error).message}`);
    return LISTADO_VACIO;
  }
}

export function obtenerProducto(slug: string): Promise<ProductoDetalle | null> {
  return pedirCatalogo(`/v1/productos/${encodeURIComponent(slug)}`, ProductoDetalle, [`producto:${slug}`]);
}

export async function buscarProductos(q: string): Promise<ListadoProductos> {
  return (await pedirCatalogo(`/v1/buscar?${new URLSearchParams({ q })}`, ListadoProductos, [], { sinCache: true })) ?? LISTADO_VACIO;
}

const Slugs = z.array(z.object({ slug: z.string(), nombre: z.string().default(""), actualizadoEn: z.string(), fotos: z.array(z.string()).default([]) }));
export async function obtenerSlugs(): Promise<z.infer<typeof Slugs>> {
  try {
    return (await pedirCatalogo("/v1/productos-slugs", Slugs, ["catalogo"])) ?? [];
  } catch {
    return [];
  }
}

/** Unas pocas prendas con stock de una categoría (las pestañas Mujer / Hombre del inicio). */
export async function obtenerDeCategoria(categoria: string, limite = 8): Promise<ListadoProductos> {
  try {
    return (await pedirCatalogo(`/v1/productos?${new URLSearchParams({ categoria, limite: String(limite) })}`, ListadoProductos, ["catalogo"])) ?? LISTADO_VACIO;
  } catch (err) {
    console.warn(`[api] ${categoria}: ${(err as Error).message}`);
    return LISTADO_VACIO;
  }
}

// ── Etapa 8: portada y reseñas ──
const SIN_RESENAS_INICIO: ResenasInicio = { promedio: null, cantidad: 0, resenas: [] };
export async function obtenerPortada(): Promise<BannerPublico[]> {
  try {
    return (await pedirCatalogo("/v1/portada", z.object({ banners: z.array(BannerPublico) }), ["catalogo"]))?.banners ?? [];
  } catch (err) {
    console.warn(`[api] portada: ${(err as Error).message}`);
    return [];
  }
}
export async function obtenerResenasInicio(): Promise<ResenasInicio> {
  try {
    return (await pedirCatalogo("/v1/resenas/inicio", ResenasInicio, ["catalogo"])) ?? SIN_RESENAS_INICIO;
  } catch (err) {
    console.warn(`[api] reseñas del inicio: ${(err as Error).message}`);
    return SIN_RESENAS_INICIO;
  }
}
/** La primera página de reseñas de una prenda (va en el HTML de la ficha: Google la lee). */
export async function obtenerResenas(slug: string): Promise<ResenasProducto | null> {
  try {
    return await pedirCatalogo(`/v1/productos/${encodeURIComponent(slug)}/resenas`, ResenasProducto, [`producto:${slug}`]);
  } catch (err) {
    console.warn(`[api] reseñas de ${slug}: ${(err as Error).message}`);
    return null;
  }
}
