import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { obtenerCategorias } from "@/lib/api";
import { PaginaSeccion, TEMPORADAS, type Temporada } from "@/components/PaginaSeccion";

/* /liquidacion/hombre, /liquidacion/mujer…: la liquidación de una categoría de arriba (etapa 9); /liquidacion/invierno y /liquidacion/verano: la de cada temporada. */
export const revalidate = 300;
export async function generateStaticParams() { return []; }

const temporadaDe = (slug: string) => TEMPORADAS.find((t) => t === slug) as Temporada | undefined;
const categoria = async (slug: string) => (await obtenerCategorias()).find((c) => c.slug === slug);

export async function generateMetadata({ params }: { params: Promise<{ categoria: string }> }): Promise<Metadata> {
  const slug = (await params).categoria;
  const t = temporadaDe(slug);
  if (t) {
    return {
      title: `Liquidación de ${t}`,
      description: `Liquidación de ${t}: prendas de la temporada pasada y elegidas para liquidar, a precio más bajo. Hasta agotar stock.`,
      alternates: { canonical: `/liquidacion/${t}` },
    };
  }
  const c = await categoria(slug);
  if (!c) return {};
  return {
    title: `Liquidación ${c.nombre}`,
    description: `Liquidación de ${c.nombre.toLowerCase()}: prendas de la temporada pasada y elegidas para liquidar, a precio más bajo. Hasta agotar stock.`,
    alternates: { canonical: `/liquidacion/${c.slug}` },
  };
}

export default async function LiquidacionDe({ params }: { params: Promise<{ categoria: string }> }) {
  const slug = (await params).categoria;
  const t = temporadaDe(slug);
  if (t) return <PaginaSeccion cual="liquidacion" temporada={t} />;
  const c = await categoria(slug);
  if (!c) notFound();
  return <PaginaSeccion cual="liquidacion" categoria={c.slug} />;
}
