import type { MetadataRoute } from "next";
import { obtenerCategorias } from "@/lib/api";
import { SITIO } from "@/lib/sitio";

export const revalidate = 3600;

/* Home, categorías y páginas fijas. En la etapa 1 se suman las fichas de producto. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const categorias = await obtenerCategorias();
  const ahora = new Date();
  const url = (p: string) => `${SITIO.url}${p}`;
  return [
    { url: url("/"), lastModified: ahora, changeFrequency: "daily", priority: 1 },
    ...categorias.flatMap((c) => [
      { url: url(`/${c.slug}`), lastModified: ahora, changeFrequency: "daily" as const, priority: 0.8 },
      ...c.hijas.map((h) => ({ url: url(`/${c.slug}/${h.slug}`), lastModified: ahora, changeFrequency: "daily" as const, priority: 0.7 })),
    ]),
    ...["/locales", "/devoluciones", "/terminos", "/privacidad", "/arrepentimiento"].map((p) => ({
      url: url(p), lastModified: ahora, changeFrequency: "monthly" as const, priority: 0.3,
    })),
  ];
}
