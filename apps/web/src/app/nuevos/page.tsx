import type { Metadata } from "next";
import { PaginaColeccion } from "@/components/PaginaColeccion";

export const revalidate = 300;
export const metadata: Metadata = {
  title: "Nuevos ingresos",
  description: "Lo último que llegó a Isuwaya: remeras, buzos, pantalones y más para hombre, mujer y niños.",
  alternates: { canonical: "/nuevos" },
};

export default function Nuevos() {
  return <PaginaColeccion cual="nuevos" titulo="Nuevos" bajada="Lo último que salió del taller. Talles reales y envíos a todo el país." />;
}
