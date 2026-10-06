import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { obtenerCategorias } from "@/lib/api";
import { PaginaSeccion } from "@/components/PaginaSeccion";

/* /liquidacion/hombre, /liquidacion/mujer…: la liquidación de una categoría de arriba (etapa 9). */
export const revalidate = 300;
export async function generateStaticParams() { return []; }

const categoria = async (slug: string) => (await obtenerCategorias()).find((c) => c.slug === slug);

export async function generateMetadata({ params }: { params: Promise<{ categoria: string }> }): Promise<Metadata> {
  const c = await categoria((await params).categoria);
  if (!c) return {};
  return {
    title: `Liquidación ${c.nombre}`,
    description: `Liquidación de ${c.nombre.toLowerCase()}: prendas de la temporada pasada y elegidas para liquidar, a precio más bajo. Hasta agotar stock.`,
    alternates: { canonical: `/liquidacion/${c.slug}` },
  };
}

export default async function LiquidacionDe({ params }: { params: Promise<{ categoria: string }> }) {
  const c = await categoria((await params).categoria);
  if (!c) notFound();
  return <PaginaSeccion cual="liquidacion" categoria={c.slug} />;
}
