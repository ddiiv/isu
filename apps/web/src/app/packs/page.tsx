import type { Metadata } from "next";
import { PaginaColeccion } from "@/components/PaginaColeccion";

export const revalidate = 300;
export const metadata: Metadata = {
  title: "Packs: llevá más, pagá menos",
  description: "Armá tu pack de 2 a 5 prendas con tus talles y colores y pagá menos por cada una. Envíos a todo el país.",
  alternates: { canonical: "/packs" },
};

export default function Packs() {
  return <PaginaColeccion cual="packs" titulo="Packs" bajada="Llevá más, pagá menos. Elegí 2, 3, 4 o 5 unidades y armalas con tus colores y talles: cuantas más, más barata cada una." />;
}
