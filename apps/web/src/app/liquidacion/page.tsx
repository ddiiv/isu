import type { Metadata } from "next";
import { PaginaSeccion } from "@/components/PaginaSeccion";

/* Liquidación (etapa 9): lo que tiene un descuento marcado como liquidación en el backoffice. */
export const revalidate = 300;
export const metadata: Metadata = {
  title: "Liquidación: fin de temporada",
  description: "Prendas de la temporada pasada y elegidas para liquidar, a precio más bajo. Hombre, mujer y niños. Hasta agotar stock.",
  alternates: { canonical: "/liquidacion" },
};

export default function Liquidacion() {
  return <PaginaSeccion cual="liquidacion" />;
}
