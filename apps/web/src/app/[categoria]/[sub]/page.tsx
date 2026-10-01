import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { apiDisponible, obtenerCategorias, obtenerConfig, obtenerProductos } from "@/lib/api";
import { Grilla } from "@/components/Grilla";
import { Migas } from "@/components/Migas";
import { SinProductos } from "@/components/SinProductos";
import { TextoCategoria } from "@/components/TextoCategoria";
import { contextoSeo } from "@/lib/seo";
import { descripcionCategoria } from "@isu/shared";

export const revalidate = 300;

export async function generateStaticParams() {
  if (!(await apiDisponible())) return [];
  return (await obtenerCategorias()).flatMap((c) => c.hijas.map((h) => ({ categoria: c.slug, sub: h.slug })));
}

async function buscar(categoria: string, sub: string) {
  const cat = (await obtenerCategorias()).find((c) => c.slug === categoria);
  const hija = cat?.hijas.find((h) => h.slug === sub);
  return cat && hija ? { cat, hija } : null;
}

export async function generateMetadata({ params }: { params: Promise<{ categoria: string; sub: string }> }): Promise<Metadata> {
  const { categoria, sub } = await params;
  const r = await buscar(categoria, sub);
  if (!r) return {};
  const [listado, config] = await Promise.all([obtenerProductos(r.cat.slug, r.hija.slug).catch(() => null), obtenerConfig()]);
  const titulo = `${r.hija.nombre} de ${r.cat.nombre.toLowerCase()}`;
  return {
    title: r.hija.seoTitulo || titulo,
    description: r.hija.seoDescripcion || descripcionCategoria(titulo, listado?.productos ?? [], contextoSeo(config)),
    alternates: { canonical: `/${r.cat.slug}/${r.hija.slug}` },
  };
}

export default async function Subcategoria({ params }: { params: Promise<{ categoria: string; sub: string }> }) {
  const { categoria, sub } = await params;
  const r = await buscar(categoria, sub);
  if (!r) notFound();
  const [listado, config] = await Promise.all([obtenerProductos(r.cat.slug, r.hija.slug), obtenerConfig()]);
  return (
    <div className="contenedor pt-8">
      <Migas items={[{ nombre: r.cat.nombre, href: `/${r.cat.slug}` }, { nombre: r.hija.nombre, href: `/${r.cat.slug}/${r.hija.slug}` }]} />
      <h1 className="mt-4 text-[clamp(2.6rem,7vw,5.5rem)] leading-[0.95]">{r.hija.nombre} <span className="text-tinta-tenue">· {r.cat.nombre}</span></h1>
      {listado?.productos.length
        ? <div className="mt-8"><Grilla productos={listado.productos} lista={`${r.cat.nombre} › ${r.hija.nombre}`} descuento={config.descuentoTransferencia} cuotas={config.cuotasSinInteres} /></div>
        : <SinProductos />}
      <TextoCategoria titulo={`${r.hija.nombre} de ${r.cat.nombre.toLowerCase()}`} texto={r.hija.texto} productos={listado?.productos ?? []} ruta={`/${r.cat.slug}/${r.hija.slug}`} />
    </div>
  );
}
