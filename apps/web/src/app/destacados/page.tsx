import type { Metadata } from "next";
import { descripcionConEvento, tituloConEvento } from "@isu/shared";
import { PaginaColeccion } from "@/components/PaginaColeccion";
import { obtenerConfig } from "@/lib/api";
import { contextoSeo } from "@/lib/seo";

export const revalidate = 300;
export async function generateMetadata(): Promise<Metadata> {
  const ctx = contextoSeo(await obtenerConfig());
  return {
    title: tituloConEvento("Destacados", ctx),
    description: descripcionConEvento("Las prendas favoritas de Isuwaya para hombre, mujer y niños, elegidas para vos. Talles reales y envíos a todo el país.", ctx),
    alternates: { canonical: "/destacados" },
  };
}

export default function Destacados() {
  return <PaginaColeccion cual="destacados" titulo="Destacados" bajada="Nuestras favoritas de la temporada." />;
}
