import type { Metadata } from "next";
import { maxPorcentajePack } from "@isu/shared";
import { obtenerConfig } from "@/lib/api";
import { PaginaSeccion } from "@/components/PaginaSeccion";

export const revalidate = 300;
export async function generateMetadata(): Promise<Metadata> {
  const { packs } = await obtenerConfig();
  return {
    title: "Packs: llevá más, pagá menos",
    description: `Armá tu pack de ${packs.minimo} a ${packs.maximo} prendas con tus talles y colores: hasta ${maxPorcentajePack(packs)}% OFF en cada una. Packs de hombre, mujer y niños.`,
    alternates: { canonical: "/packs" },
  };
}

export default function Packs() {
  return <PaginaSeccion cual="packs" />;
}
