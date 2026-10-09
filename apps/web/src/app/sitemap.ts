import type { MetadataRoute } from "next";
import { obtenerCategorias, obtenerConfig, obtenerSlugs } from "@/lib/api";
import { SITIO } from "@/lib/sitio";
import { src } from "@/lib/fotos";
import { absoluta } from "@/lib/seo";

// En cada pedido (con la caché de datos de la API): en el build de Railway no hay API y saldría vacío.
export const dynamic = "force-dynamic";

/* Home, categorías, fichas de producto (con sus fotos) y páginas fijas. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [categorias, productos, config] = await Promise.all([obtenerCategorias(), obtenerSlugs(), obtenerConfig()]);
  const ahora = new Date();
  const url = (p: string) => `${SITIO.url}${p}`;
  return [
    { url: url("/"), lastModified: ahora, changeFrequency: "daily", priority: 1 },
    ...categorias.flatMap((c) => [
      { url: url(`/${c.slug}`), lastModified: ahora, changeFrequency: "daily" as const, priority: 0.8 },
      ...c.hijas.map((h) => ({ url: url(`/${c.slug}/${h.slug}`), lastModified: ahora, changeFrequency: "daily" as const, priority: 0.7 })),
    ]),
    ...productos.map((p) => ({
      url: url(`/producto/${p.slug}`), lastModified: new Date(p.actualizadoEn), changeFrequency: "daily" as const, priority: 0.6,
      images: p.fotos.map((clave) => absoluta(src({ clave, ancho: null, alto: null, alt: null }, 1200))),
    })),
    ...["/nuevos", "/destacados", "/packs", "/outfits", ...(config.hayLiquidacion ? ["/liquidacion"] : [])].map((p) => ({ url: url(p), lastModified: ahora, changeFrequency: "daily" as const, priority: 0.7 })),
    // Etapa 9: packs y liquidación por categoría (sólo las que tienen algo).
    ...config.packsEn.map((c) => ({ url: url(`/packs/${c}`), lastModified: ahora, changeFrequency: "daily" as const, priority: 0.6 })),
    ...config.liquidacionEn.map((c) => ({ url: url(`/liquidacion/${c}`), lastModified: ahora, changeFrequency: "daily" as const, priority: 0.6 })),
    // Etapa 13: las que Google puede mostrar como accesos debajo de «Isuwaya».
    ...["/nosotros", "/contacto", "/venta-por-mayor"].map((p) => ({ url: url(p), lastModified: ahora, changeFrequency: "monthly" as const, priority: 0.5 })),
    ...["/locales", "/devoluciones", "/terminos", "/privacidad", "/arrepentimiento"].map((p) => ({
      url: url(p), lastModified: ahora, changeFrequency: "monthly" as const, priority: 0.3,
    })),
  ];
}
