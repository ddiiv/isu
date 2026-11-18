import type { Metadata } from "next";
import { PaginaColeccion } from "@/components/PaginaColeccion";

/* Las prendas con un descuento que termina en 48 horas o menos (colección "relampago" de la API). */
export const revalidate = 60;
export const metadata: Metadata = {
  title: "Relámpago: descuentos por tiempo limitado",
  description: "Prendas con un descuento que termina en menos de 48 horas. Aprovechalas antes de que se acabe el tiempo.",
  alternates: { canonical: "/relampago" },
};

export default function Relampago() {
  return <PaginaColeccion cual="relampago" titulo="Relámpago" bajada="Descuentos por tiempo limitado: cuando se acaba la cuenta regresiva, vuelve el precio de siempre." />;
}
