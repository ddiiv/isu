import type { MetadataRoute } from "next";
import { obtenerCategorias, obtenerSlugs } from "@/lib/api";
import { SITIO } from "@/lib/sitio";

export const revalidate = 3600;

/* Home, categorías, fichas de producto y páginas fijas. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [categorias, productos] = await Promise.all([obtenerCategorias(), obtenerSlugs()]);
  const ahora = new Date();
  const url = (p: string) => `${SITIO.url}${p}`;
  return [
    { url: url("/"), lastModified: ahora, changeFrequency: "daily", priority: 1 },
    ...categorias.flatMap((c) => [
      { url: url(`/${c.slug}`), lastModified: ahora, changeFrequency: "daily" as const, priority: 0.8 },
      ...c.hijas.map((h) => ({ url: url(`/${c.slug}/${h.slug}`), lastModified: ahora, changeFrequency: "daily" as const, priority: 0.7 })),
    ]),
    ...productos.map((p) => ({ url: url(`/producto/${p.slug}`), lastModified: new Date(p.actualizadoEn), changeFrequency: "daily" as const, priority: 0.6 })),
    ...["/nuevos", "/destacados", "/outfits"].map((p) => ({ url: url(p), lastModified: ahora, changeFrequency: "daily" as const, priority: 0.7 })),
    ...["/locales", "/devoluciones", "/terminos", "/privacidad", "/arrepentimiento"].map((p) => ({
      url: url(p), lastModified: ahora, changeFrequency: "monthly" as const, priority: 0.3,
    })),
  ];
}
