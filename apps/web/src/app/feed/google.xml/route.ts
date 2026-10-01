import { descripcionProducto, feedXml, itemsFeed, type ItemFeed } from "@isu/shared";
import { obtenerConfig, obtenerProducto, obtenerSlugs } from "@/lib/api";
import { contextoSeo } from "@/lib/seo";

/*
 * Feed de productos para Google Merchant Center (Google Shopping y la
 * pestaña "Shopping" gratis). En Merchant Center: Productos → Fuentes de datos
 * → Agregar → "Archivo programado" con https://<tienda>/feed/google.xml, una
 * vez por día. Una fila por talle y color, con precio, oferta y stock reales.
 *
 * Se arma en cada pedido (en el build de Railway no hay API: estático saldría
 * vacío), pero las fichas salen de la misma caché que las páginas y
 * Cloudflare lo guarda una hora.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const [slugs, config] = await Promise.all([obtenerSlugs(), obtenerConfig()]);
  const ctx = contextoSeo(config);
  const items: ItemFeed[] = [];
  // De a 8, para no pedirle a la API cientos de fichas a la vez.
  for (let i = 0; i < slugs.length; i += 8) {
    const fichas = await Promise.all(slugs.slice(i, i + 8).map((s) => obtenerProducto(s.slug).catch(() => null)));
    for (const p of fichas) if (p) items.push(...itemsFeed(p, ctx, descripcionProducto(p, ctx)));
  }
  return new Response(feedXml(items, ctx), {
    headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=900, s-maxage=3600" },
  });
}
