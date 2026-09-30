import type { Metadata } from "next";
import { PaginaColeccion } from "@/components/PaginaColeccion";

export const revalidate = 300;
export const metadata: Metadata = {
  title: "Destacados",
  description: "Las prendas favoritas de Isuwaya, elegidas para vos.",
  alternates: { canonical: "/destacados" },
};

export default function Destacados() {
  return <PaginaColeccion cual="destacados" titulo="Destacados" bajada="Nuestras favoritas de la temporada." />;
}
