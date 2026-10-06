import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { maxPorcentajePack } from "@isu/shared";
import { obtenerCategorias, obtenerConfig } from "@/lib/api";
import { PaginaSeccion } from "@/components/PaginaSeccion";

/* /packs/hombre, /packs/mujer, /packs/ninos: los packs de una categoría de arriba (etapa 9). */
export const revalidate = 300;
export async function generateStaticParams() { return []; }

const categoria = async (slug: string) => (await obtenerCategorias()).find((c) => c.slug === slug);

export async function generateMetadata({ params }: { params: Promise<{ categoria: string }> }): Promise<Metadata> {
  const [c, { packs }] = await Promise.all([categoria((await params).categoria), obtenerConfig()]);
  if (!c) return {};
  return {
    title: `Packs ${c.nombre}: llevá más, pagá menos`,
    description: `Packs de ${c.nombre.toLowerCase()}: de ${packs.minimo} a ${packs.maximo} prendas con tus talles y colores, hasta ${maxPorcentajePack(packs)}% OFF en cada una.`,
    alternates: { canonical: `/packs/${c.slug}` },
  };
}

export default async function PacksDe({ params }: { params: Promise<{ categoria: string }> }) {
  const c = await categoria((await params).categoria);
  if (!c) notFound();
  return <PaginaSeccion cual="packs" categoria={c.slug} />;
}
