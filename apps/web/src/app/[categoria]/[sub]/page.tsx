import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { obtenerCategorias } from "@/lib/api";
import { Migas } from "@/components/Migas";
import { SinProductos } from "@/components/SinProductos";

export const revalidate = 300;

export async function generateStaticParams() {
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
  return {
    title: `${r.hija.nombre} de ${r.cat.nombre.toLowerCase()}`,
    description: `${r.hija.nombre} para ${r.cat.nombre.toLowerCase()} de Isuwaya. Talles reales, envíos a todo el país y descuento pagando con transferencia.`,
    alternates: { canonical: `/${r.cat.slug}/${r.hija.slug}` },
  };
}

export default async function Subcategoria({ params }: { params: Promise<{ categoria: string; sub: string }> }) {
  const { categoria, sub } = await params;
  const r = await buscar(categoria, sub);
  if (!r) notFound();
  return (
    <div className="contenedor pt-8">
      <Migas items={[{ nombre: r.cat.nombre, href: `/${r.cat.slug}` }, { nombre: r.hija.nombre, href: `/${r.cat.slug}/${r.hija.slug}` }]} />
      <h1 className="mt-4 text-[clamp(2.6rem,7vw,5.5rem)] leading-[0.95]">{r.hija.nombre} <span className="text-tinta-tenue">· {r.cat.nombre}</span></h1>
      <SinProductos />
    </div>
  );
}
