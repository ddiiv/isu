import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { apiDisponible, obtenerCategorias, obtenerConfig, obtenerProductos } from "@/lib/api";
import { Grilla } from "@/components/Grilla";
import { Migas } from "@/components/Migas";
import { SinProductos } from "@/components/SinProductos";
import { TextoCategoria } from "@/components/TextoCategoria";
import { contextoSeo } from "@/lib/seo";
import { descripcionCategoria, descripcionCategoriaPrincipal } from "@isu/shared";

export const revalidate = 300;

export async function generateStaticParams() {
  if (!(await apiDisponible())) return [];
  // Sin API (build de CI o la API caída) quedan las de respaldo (id negativo): no se generan en el
  // build y se arman en el primer pedido. Si no, el build falla al no poder traer los productos.
  return (await obtenerCategorias()).filter((c) => c.id > 0).map((c) => ({ categoria: c.slug }));
}

async function buscar(slug: string) {
  return (await obtenerCategorias()).find((c) => c.slug === slug);
}

export async function generateMetadata({ params }: { params: Promise<{ categoria: string }> }): Promise<Metadata> {
  const cat = await buscar((await params).categoria);
  if (!cat) return {};
  const [listado, config] = await Promise.all([obtenerProductos(cat.slug).catch(() => null), obtenerConfig()]);
  const titulo = `Ropa de ${cat.nombre.toLowerCase()}`;
  return {
    title: cat.seoTitulo || titulo,
    // Con subcategorías, como las tiendas grandes en Google: «Explorá toda la ropa de mujer Isuwaya: remeras y tops, …».
    description: cat.seoDescripcion || (cat.hijas.length
      ? descripcionCategoriaPrincipal(cat.nombre, cat.hijas.map((h) => h.nombre), contextoSeo(config))
      : descripcionCategoria(titulo, listado?.productos ?? [], contextoSeo(config))),
    alternates: { canonical: `/${cat.slug}` },
  };
}

export default async function Categoria({ params }: { params: Promise<{ categoria: string }> }) {
  const cat = await buscar((await params).categoria);
  if (!cat) notFound();
  const [listado, config] = await Promise.all([obtenerProductos(cat.slug), obtenerConfig()]);
  return (
    <div className="contenedor pt-8">
      <Migas items={[{ nombre: cat.nombre, href: `/${cat.slug}` }]} />
      <h1 className="mt-4 text-[clamp(2.6rem,7vw,5.5rem)] leading-[0.95]">{cat.nombre}</h1>
      {cat.hijas.length > 0 && (
        <ul className="mt-6 flex flex-wrap gap-2">
          {cat.hijas.map((h) => (
            <li key={h.id}><Link href={`/${cat.slug}/${h.slug}`} className="inline-block rounded-full border border-tinta px-4 py-2 text-[15px] font-bold hover:bg-tinta hover:text-white">{h.nombre}</Link></li>
          ))}
        </ul>
      )}
      {listado?.productos.length
        ? <div className="mt-8"><Grilla productos={listado.productos} lista={cat.nombre} descuento={config.descuentoTransferencia} cuotas={config.cuotasSinInteres} /></div>
        : <SinProductos />}
      <TextoCategoria titulo={`Ropa de ${cat.nombre.toLowerCase()}`} texto={cat.texto} productos={listado?.productos ?? []} ruta={`/${cat.slug}`} />
    </div>
  );
}
