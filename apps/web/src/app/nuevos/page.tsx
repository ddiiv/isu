import type { Metadata } from "next";
import { descripcionConEvento, tituloConEvento } from "@isu/shared";
import { PaginaColeccion } from "@/components/PaginaColeccion";
import { obtenerConfig } from "@/lib/api";
import { contextoSeo } from "@/lib/seo";

export const revalidate = 300;
export async function generateMetadata(): Promise<Metadata> {
  const ctx = contextoSeo(await obtenerConfig());
  return {
    title: tituloConEvento("Nuevos ingresos", ctx),
    description: descripcionConEvento("Lo último que llegó a Isuwaya: remeras, buzos, pantalones y más para hombre, mujer y niños.", ctx),
    alternates: { canonical: "/nuevos" },
  };
}

export default function Nuevos() {
  return <PaginaColeccion cual="nuevos" titulo="Nuevos" bajada="Lo último que salió del taller. Talles reales y envíos a todo el país." />;
}
