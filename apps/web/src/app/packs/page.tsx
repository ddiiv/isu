import type { Metadata } from "next";
import { descripcionConEvento, maxPorcentajePack, tituloConEvento } from "@isu/shared";
import { obtenerConfig } from "@/lib/api";
import { contextoSeo } from "@/lib/seo";
import { PaginaSeccion } from "@/components/PaginaSeccion";

export const revalidate = 300;
export async function generateMetadata(): Promise<Metadata> {
  const config = await obtenerConfig();
  const { packs } = config;
  const ctx = contextoSeo(config);
  return {
    title: tituloConEvento("Packs: llevá más, pagá menos", ctx),
    description: descripcionConEvento(`Armá tu pack de ${packs.minimo} a ${packs.maximo} prendas con tus talles y colores: hasta ${maxPorcentajePack(packs)}% OFF en cada una. Packs de hombre, mujer y niños.`, ctx),
    alternates: { canonical: "/packs" },
  };
}

export default function Packs() {
  return <PaginaSeccion cual="packs" />;
}
