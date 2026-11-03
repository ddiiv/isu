import { descripcionAutomatica, feedXml, itemsFeed, itemsFeedMayorista, type ItemFeed } from "@isu/shared";
import { obtenerConfig, obtenerProducto, obtenerSlugs } from "@/lib/api";
import { destinoMayorista } from "@/lib/mayorista";
import { contextoSeo } from "@/lib/seo";

/*
 * Feed para el catálogo de WhatsApp (Meta Commerce Manager → Fuente de datos →
 * "Lista de datos programada" con https://<tienda>/feed/whatsapp.xml, una vez
 * por día). Fotos y textos de la tienda, pero con los PRECIOS MAYORISTAS del
 * portal (/api/catalogo): ese WhatsApp vende por mayor. Sólo salen las
 * variantes que el portal vende con precio y que tienen foto de su color (o
 * generales): nunca la de otro color. El link lleva al portal. La
 * descripción es la de la ficha, sin la frase de precios y cuotas minoristas
 * que arma descripcionProducto para Google.
 *
 * Meta reemplaza el catálogo con cada carga: lo que no viene se borra. Por eso,
 * si el portal o la API fallan (aunque sea en una sola ficha) o el resultado
 * queda vacío, se responde 503 y no un feed incompleto (la fuente conserva el
 * catálogo anterior).
 */
export const dynamic = "force-dynamic";

type CatalogoPortal = { productos?: { combinaciones?: { sku?: unknown; precio?: unknown }[] }[] };

/** SKU de variante en mayúsculas → precio mayorista en pesos; null si el portal no contesta. */
async function preciosDelPortal(portal: string): Promise<Map<string, number> | null> {
  try {
    const r = await fetch(new URL("/api/catalogo", portal), { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return null;
    // Combinación por combinación: una rara se saltea, no deja sin catálogo a todas.
    const precios = new Map<string, number>();
    for (const p of ((await r.json()) as CatalogoPortal).productos ?? []) {
      for (const c of p.combinaciones ?? []) {
        const precio = Number(c.precio);
        if (typeof c.sku === "string" && precio > 0) precios.set(c.sku.trim().toUpperCase(), precio);
      }
    }
    return precios;
  } catch {
    return null;
  }
}

const noDisponible = () => new Response("Catálogo mayorista no disponible", { status: 503, headers: { "cache-control": "no-store", "retry-after": "900" } });

export async function GET() {
  const portal = destinoMayorista();
  const precios = await preciosDelPortal(portal);
  if (!precios?.size) return noDisponible();
  const items: ItemFeed[] = [];
  try {
    const [slugs, config] = await Promise.all([obtenerSlugs(), obtenerConfig()]);
    const ctx = contextoSeo(config);
    // De a 8, para no pedirle a la API cientos de fichas a la vez. Una ficha que falla tira todo (ver arriba); un 404 es un producto que se despublicó.
    for (let i = 0; i < slugs.length; i += 8) {
      const fichas = await Promise.all(slugs.slice(i, i + 8).map((s) => obtenerProducto(s.slug)));
      for (const p of fichas) if (p) items.push(...itemsFeedMayorista(itemsFeed(p, ctx, p.descripcion?.trim() || descripcionAutomatica(p, ctx.marca), { soloFotosDelColor: true }), precios, portal));
    }
    if (!items.length) return noDisponible();
    return new Response(feedXml(items, ctx, { disponibilidadConEspacio: true }), {
      headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=900, s-maxage=3600" },
    });
  } catch (err) {
    console.warn(`[feed whatsapp] ${(err as Error).message}`);
    return noDisponible();
  }
}
