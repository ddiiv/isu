import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { descripcionConEvento, maxPorcentajePack, tituloConEvento } from "@isu/shared";
import { obtenerCategorias, obtenerConfig } from "@/lib/api";
import { PaginaSeccion } from "@/components/PaginaSeccion";
import { contextoSeo } from "@/lib/seo";

/* /packs/hombre, /packs/mujer, /packs/ninos: los packs de una categoría de arriba (etapa 9). */
export const revalidate = 300;
export async function generateStaticParams() { return []; }

const categoria = async (slug: string) => (await obtenerCategorias()).find((c) => c.slug === slug);

export async function generateMetadata({ params }: { params: Promise<{ categoria: string }> }): Promise<Metadata> {
  const [c, config] = await Promise.all([categoria((await params).categoria), obtenerConfig()]);
  if (!c) return {};
  const { packs } = config;
  const ctx = contextoSeo(config);
  return {
    title: tituloConEvento(`Packs ${c.nombre}: llevá más, pagá menos`, ctx),
    description: descripcionConEvento(`Packs de ${c.nombre.toLowerCase()}: de ${packs.minimo} a ${packs.maximo} prendas con tus talles y colores, hasta ${maxPorcentajePack(packs)}% OFF en cada una.`, ctx),
    alternates: { canonical: `/packs/${c.slug}` },
  };
}

export default async function PacksDe({ params }: { params: Promise<{ categoria: string }> }) {
  const c = await categoria((await params).categoria);
  if (!c) notFound();
  return <PaginaSeccion cual="packs" categoria={c.slug} />;
}
