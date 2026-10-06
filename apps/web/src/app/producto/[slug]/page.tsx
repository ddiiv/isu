import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { descripcionProducto, jsonLdProducto, leerRutaPack, maxPorcentajePack, rutaPack, slug as esquemaSlug } from "@isu/shared";
import { obtenerConfig, obtenerProducto, obtenerResenas } from "@/lib/api";
import { src } from "@/lib/fotos";
import { contextoSeo } from "@/lib/seo";
import { Migas } from "@/components/Migas";
import { JsonLd } from "@/components/JsonLd";
import { FichaProducto } from "@/components/FichaProducto";
import { FichaPack } from "@/components/FichaPack";
import { OpinionesProducto } from "@/components/resenas/OpinionesProducto";

/*
 * Ficha de producto: estática (ISR) y regenerada al instante cuando Stocker avisa un cambio.
 *
 * Etapa 8: /producto/pack-x3-<slug> es la página del pack de esa prenda (del
 * mínimo al máximo de Ajustes → Packs). Si la prenda no se vende en pack,
 * manda a su ficha; una cantidad fuera del rango, a la más cercana.
 */
export const revalidate = 300;
export async function generateStaticParams() { return []; }

async function cargar(params: Promise<{ slug: string }>) {
  const { slug } = await params;
  // Un slug inválido ni siquiera llega a la API.
  if (!esquemaSlug.safeParse(slug).success) return null;
  const pack = leerRutaPack(slug);
  if (pack) {
    const p = await obtenerProducto(pack.slug);
    if (p) return { p, pack: p.pack ? pack.unidades : null, slugPedido: slug };
  }
  const p = await obtenerProducto(slug);
  return p ? { p, pack: null, slugPedido: slug } : null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const [r, config] = await Promise.all([cargar(params), obtenerConfig()]);
  if (!r) return {};
  const { p, pack } = r;
  const foto = p.exhibicion[0] ?? p.colores.find((c) => c.fotos[0])?.fotos[0];
  const imagenes = foto ? [{ url: src(foto, 1200), width: foto.ancho ?? undefined, height: foto.alto ?? undefined, alt: foto.alt ?? p.nombre }] : undefined;
  if (pack) {
    const titulo = `Pack x${pack} ${p.nombre}`;
    const descripcion = `Armá tu pack de ${p.nombre}: de ${config.packs.minimo} a ${config.packs.maximo} unidades con tus talles y colores, hasta ${maxPorcentajePack(config.packs)}% OFF.`;
    // Todas las cantidades son la misma oferta: Google indexa la del mínimo.
    return { title: titulo, description: descripcion, alternates: { canonical: rutaPack(p.slug, config.packs.minimo) }, openGraph: { type: "website", title: titulo, description: descripcion, url: rutaPack(p.slug, pack), images: imagenes } };
  }
  const descripcion = descripcionProducto(p, contextoSeo(config));
  return {
    title: p.seoTitulo ?? p.nombre,
    description: descripcion,
    alternates: { canonical: `/producto/${p.slug}` },
    openGraph: { type: "website", title: p.seoTitulo ?? p.nombre, description: descripcion, url: `/producto/${p.slug}`, images: imagenes },
  };
}

export default async function Producto({ params }: { params: Promise<{ slug: string }> }) {
  const [r, config] = await Promise.all([cargar(params), obtenerConfig()]);
  if (!r) notFound();
  const { p, pack, slugPedido } = r;
  // pack-x3-<slug> de una prenda que no se vende en pack: a su ficha.
  if (!pack && slugPedido !== p.slug) redirect(`/producto/${p.slug}`);
  // Una cantidad fuera de lo que se ofrece (pack-x15-…): a la más cercana.
  if (pack && (pack < config.packs.minimo || pack > config.packs.maximo)) {
    redirect(rutaPack(p.slug, Math.min(config.packs.maximo, Math.max(config.packs.minimo, pack))));
  }
  const ctx = contextoSeo(config);
  const migas = [...p.migas.map((m) => ({ nombre: m.nombre, href: m.ruta })), { nombre: p.nombre, href: `/producto/${p.slug}` }];

  if (pack) {
    return (
      <div className="contenedor pt-6 pb-16">
        <div className="mb-5"><Migas items={[{ nombre: "Packs", href: "/packs" }, { nombre: `Pack ${p.nombre}`, href: rutaPack(p.slug, pack) }]} /></div>
        <FichaPack p={p} config={config} unidades={pack} />
      </div>
    );
  }

  const resenas = p.resenas.cantidad > 0 ? await obtenerResenas(p.slug) : null;
  return (
    <div className="contenedor pt-6 pb-16">
      <div className="mb-5"><Migas items={migas} /></div>
      <FichaProducto p={p} config={config} />
      <OpinionesProducto slug={p.slug} inicial={resenas} />
      <JsonLd datos={jsonLdProducto(p, ctx, descripcionProducto(p, ctx), resenas?.resenas ?? [])} />
    </div>
  );
}
