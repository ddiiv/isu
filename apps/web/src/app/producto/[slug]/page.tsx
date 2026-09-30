import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { slug as esquemaSlug } from "@isu/shared";
import { obtenerConfig, obtenerProducto } from "@/lib/api";
import { src } from "@/lib/fotos";
import { SITIO } from "@/lib/sitio";
import { Migas } from "@/components/Migas";
import { JsonLd } from "@/components/JsonLd";
import { FichaProducto } from "@/components/FichaProducto";

/* Ficha de producto: estática (ISR) y regenerada al instante cuando Stocker avisa un cambio. */
export const revalidate = 300;
export async function generateStaticParams() { return []; }

async function cargar(params: Promise<{ slug: string }>) {
  const { slug } = await params;
  // Un slug inválido ni siquiera llega a la API.
  if (!esquemaSlug.safeParse(slug).success) return null;
  return obtenerProducto(slug);
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const p = await cargar(params);
  if (!p) return {};
  const foto = p.exhibicion[0] ?? p.colores.find((c) => c.fotos[0])?.fotos[0];
  const descripcion = p.seoDescripcion ?? (p.descripcion ? p.descripcion.slice(0, 155) : `${p.nombre} de Isuwaya. Envíos a todo el país y descuento pagando con transferencia.`);
  return {
    title: p.seoTitulo ?? p.nombre,
    description: descripcion,
    alternates: { canonical: `/producto/${p.slug}` },
    openGraph: { type: "website", title: p.nombre, description: descripcion, url: `/producto/${p.slug}`, images: foto ? [{ url: src(foto, 1200), width: foto.ancho ?? undefined, height: foto.alto ?? undefined }] : undefined },
  };
}

export default async function Producto({ params }: { params: Promise<{ slug: string }> }) {
  const [p, config] = await Promise.all([cargar(params), obtenerConfig()]);
  if (!p) notFound();
  const imagenes = [...p.exhibicion, ...p.colores.flatMap((c) => c.fotos)].slice(0, 6).map((f) => src(f, 1200));
  const hay = p.variantes.some((v) => v.stock > 0);

  return (
    <div className="contenedor pt-6 pb-16">
      <div className="mb-5"><Migas items={[...p.migas.map((m) => ({ nombre: m.nombre, href: m.ruta })), { nombre: p.nombre, href: `/producto/${p.slug}` }]} /></div>
      <FichaProducto p={p} config={config} />
      <JsonLd datos={{
        "@context": "https://schema.org",
        "@type": "Product",
        name: p.nombre,
        sku: p.sku,
        description: p.descripcion ?? undefined,
        image: imagenes.length ? imagenes : undefined,
        brand: { "@type": "Brand", name: SITIO.nombre },
        color: p.colores.filter((c) => c.nombre !== "Único").map((c) => c.nombre).join(", ") || undefined,
        size: [...new Set(p.variantes.map((v) => v.talle).filter(Boolean))].join(", ") || undefined,
        offers: {
          "@type": "AggregateOffer",
          url: `${SITIO.url}/producto/${p.slug}`,
          priceCurrency: "ARS",
          lowPrice: (p.precio / 100).toFixed(2),
          highPrice: (p.precioHasta / 100).toFixed(2),
          offerCount: p.variantes.filter((v) => v.stock > 0).length || p.variantes.length,
          availability: hay ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
          itemCondition: "https://schema.org/NewCondition",
        },
      }} />
    </div>
  );
}
