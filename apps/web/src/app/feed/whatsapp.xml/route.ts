import {
  descripcionAutomatica, detalleWhatsapp, feedXml, itemWhatsapp, itemsFeed, itemsFeedMayorista, publicoDePortal, tipoDesdePortal, variantesWhatsapp,
  type ItemFeed, type ProductoDetalle,
} from "@isu/shared";
import { obtenerConfig, obtenerProducto, obtenerSlugs } from "@/lib/api";
import { destinoMayorista } from "@/lib/mayorista";
import { contextoSeo } from "@/lib/seo";

/*
 * Feed para el catálogo de WhatsApp (Meta Commerce Manager → Fuente de datos →
 * "Lista de datos programada" con https://<tienda>/feed/whatsapp.xml, cada hora).
 * Ese WhatsApp vende por mayor: la lista es la del portal (/api/catalogo), TODOS
 * sus productos, con sus precios mayoristas. Si el producto está publicado en la
 * tienda, van sus variantes (WhatsApp las agrupa en la ficha para elegir color y
 * talle) con las fotos de cada color (sin propias, las generales; sin ninguna, la
 * imagen de la marca) y una marcada "principal" para los conjuntos (ver
 * variantesWhatsapp). Si no, un solo artículo con lo del portal (itemWhatsapp).
 * Sin stock sale igual, avisando. El link lleva al portal.
 *
 * Meta reemplaza el catálogo con cada carga: lo que no viene se borra. Por eso,
 * si el portal o la API fallan (aunque sea en una sola ficha) o el resultado
 * queda vacío, se responde 503 y no un feed incompleto (la fuente conserva el
 * catálogo anterior).
 */
export const dynamic = "force-dynamic";

type ProductoPortal = {
  sku?: unknown; titulo?: unknown; descripcion?: unknown; precio?: unknown; genero?: unknown; categoriaId?: unknown;
  foto?: unknown; fotos?: { ruta?: unknown }[]; combinaciones?: { sku?: unknown; color?: unknown; talle?: unknown; precio?: unknown }[];
};
type CatalogoPortal = { productos?: ProductoPortal[]; categorias?: { id?: unknown; nombre?: unknown }[] };

const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** El catálogo del portal; null si no contesta. */
async function catalogoDelPortal(portal: string): Promise<CatalogoPortal | null> {
  try {
    const r = await fetch(new URL("/api/catalogo", portal), { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) });
    return r.ok ? ((await r.json()) as CatalogoPortal) : null;
  } catch {
    return null;
  }
}

const noDisponible = () => new Response("Catálogo mayorista no disponible", { status: 503, headers: { "cache-control": "no-store", "retry-after": "900" } });

export async function GET() {
  const portal = destinoMayorista();
  const catalogo = await catalogoDelPortal(portal);
  if (!catalogo?.productos?.length) return noDisponible();
  // SKU de variante en mayúsculas → precio mayorista en pesos (combinación por combinación: una rara se saltea).
  const precios = new Map<string, number>();
  for (const p of catalogo.productos) {
    for (const c of p.combinaciones ?? []) if (texto(c.sku) && Number(c.precio) > 0) precios.set(texto(c.sku).toUpperCase(), Number(c.precio));
  }
  const categorias = new Map((catalogo.categorias ?? []).map((c) => [c.id, texto(c.nombre)]));
  const items: ItemFeed[] = [];
  try {
    const [slugs, config] = await Promise.all([obtenerSlugs(), obtenerConfig()]);
    const ctx = contextoSeo(config);
    // De a 8, para no pedirle a la API cientos de fichas a la vez. Una ficha que falla tira todo (ver arriba); un 404 es un producto que se despublicó.
    const tienda = new Map<string, ProductoDetalle>();
    for (let i = 0; i < slugs.length; i += 8) {
      for (const p of await Promise.all(slugs.slice(i, i + 8).map((s) => obtenerProducto(s.slug)))) if (p) tienda.set(p.sku.trim().toUpperCase(), p);
    }
    const vistos = new Set<string>();
    for (const pp of catalogo.productos) {
      const sku = texto(pp.sku);
      // En el portal hay SKUs repetidos con otras mayúsculas ("ISUFluSHO"): uno solo.
      if (!sku || vistos.has(sku.toUpperCase())) continue;
      vistos.add(sku.toUpperCase());
      const genero = texto(pp.genero);
      const tipoPortal = tipoDesdePortal(genero, categorias.get(pp.categoriaId) ?? "");
      const combinaciones = (pp.combinaciones ?? []).map((c) => ({ color: texto(c.color), talle: texto(c.talle), precio: Number(c.precio) }));
      const p = tienda.get(sku.toUpperCase());
      if (p) {
        const detalle = detalleWhatsapp(combinaciones, Number(pp.precio));
        const descripcion = [p.descripcion?.trim() || descripcionAutomatica(p, ctx.marca), detalle?.texto].filter(Boolean).join("\n\n");
        const variantes = itemsFeedMayorista(itemsFeed(p, ctx, descripcion, { soloFotosDelColor: true, sinFoto: `${ctx.sitio}/icon.png` }), precios, portal);
        // Si en la tienda sólo dice "Mujer", la categoría del portal completa el tipo para que caiga en su conjunto.
        const tipo = p.migas.length > 1 ? p.migas.map((m) => m.nombre).join(" > ") : tipoPortal;
        if (variantes.length) {
          items.push(...variantesWhatsapp(p, ctx, variantes, tipo));
          continue;
        }
      }
      const item = itemWhatsapp({
        sku, titulo: p?.nombre ?? (texto(pp.titulo) || sku), descripcion: texto(pp.descripcion), combinaciones, precio: Number(pp.precio),
        fotos: [pp.foto, ...(pp.fotos ?? []).map((f) => f.ruta)].map(texto).filter(Boolean).map((r) => new URL(r, portal).href),
        tipo: tipoPortal, ...publicoDePortal(genero),
        // Sin variantes en la tienda no se sabe el stock: que lo confirme el asistente.
        sinStock: false,
      }, ctx, portal);
      if (item) items.push(item);
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
