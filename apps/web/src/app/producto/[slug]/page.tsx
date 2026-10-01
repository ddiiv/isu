import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { descripcionProducto, jsonLdProducto, slug as esquemaSlug } from "@isu/shared";
import { obtenerConfig, obtenerProducto } from "@/lib/api";
import { src } from "@/lib/fotos";
import { contextoSeo } from "@/lib/seo";
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
  const [p, config] = await Promise.all([cargar(params), obtenerConfig()]);
  if (!p) return {};
  const foto = p.exhibicion[0] ?? p.colores.find((c) => c.fotos[0])?.fotos[0];
  const descripcion = descripcionProducto(p, contextoSeo(config));
  return {
    title: p.seoTitulo ?? p.nombre,
    description: descripcion,
    alternates: { canonical: `/producto/${p.slug}` },
    openGraph: {
      type: "website", title: p.seoTitulo ?? p.nombre, description: descripcion, url: `/producto/${p.slug}`,
      images: foto ? [{ url: src(foto, 1200), width: foto.ancho ?? undefined, height: foto.alto ?? undefined, alt: foto.alt ?? p.nombre }] : undefined,
    },
  };
}

export default async function Producto({ params }: { params: Promise<{ slug: string }> }) {
  const [p, config] = await Promise.all([cargar(params), obtenerConfig()]);
  if (!p) notFound();
  const ctx = contextoSeo(config);

  return (
    <div className="contenedor pt-6 pb-16">
      <div className="mb-5"><Migas items={[...p.migas.map((m) => ({ nombre: m.nombre, href: m.ruta })), { nombre: p.nombre, href: `/producto/${p.slug}` }]} /></div>
      <FichaProducto p={p} config={config} />
      <JsonLd datos={jsonLdProducto(p, ctx, descripcionProducto(p, ctx))} />
    </div>
  );
}
