import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { obtenerCategorias } from "@/lib/api";
import { Migas } from "@/components/Migas";
import { SinProductos } from "@/components/SinProductos";

export const revalidate = 300;

export async function generateStaticParams() {
  return (await obtenerCategorias()).map((c) => ({ categoria: c.slug }));
}

async function buscar(slug: string) {
  return (await obtenerCategorias()).find((c) => c.slug === slug);
}

export async function generateMetadata({ params }: { params: Promise<{ categoria: string }> }): Promise<Metadata> {
  const cat = await buscar((await params).categoria);
  if (!cat) return {};
  return {
    title: `Ropa de ${cat.nombre.toLowerCase()}`,
    description: `Remeras, pantalones, buzos y más para ${cat.nombre.toLowerCase()}. Talles reales, envíos a todo el país y descuento pagando con transferencia.`,
    alternates: { canonical: `/${cat.slug}` },
  };
}

export default async function Categoria({ params }: { params: Promise<{ categoria: string }> }) {
  const cat = await buscar((await params).categoria);
  if (!cat) notFound();
  return (
    <div className="contenedor pt-8">
      <Migas items={[{ nombre: cat.nombre, href: `/${cat.slug}` }]} />
      <h1 className="mt-4 text-[clamp(2.6rem,7vw,5.5rem)] leading-[0.95]">{cat.nombre}</h1>
      {cat.hijas.length > 0 && (
        <ul className="mt-8 flex flex-wrap gap-2">
          {cat.hijas.map((h) => (
            <li key={h.id}><Link href={`/${cat.slug}/${h.slug}`} className="inline-block rounded-full border border-tinta px-4 py-2 text-[15px] font-bold hover:bg-tinta hover:text-white">{h.nombre}</Link></li>
          ))}
        </ul>
      )}
      <SinProductos />
    </div>
  );
}
