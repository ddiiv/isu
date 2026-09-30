import type { Metadata } from "next";
import { obtenerConfig } from "@/lib/api";
import { Migas } from "@/components/Migas";
import { ArmadorOutfits } from "@/components/outfits/ArmadorOutfits";

export const revalidate = 300;
export const metadata: Metadata = {
  title: "Armá tu outfit",
  description: "Elegí tu talle o cargá tus medidas, decinos cuánto querés gastar y te armamos outfits con lo que hay en stock.",
  alternates: { canonical: "/outfits" },
};

export default async function Outfits() {
  const config = await obtenerConfig();
  return (
    <div className="contenedor pt-8 pb-16">
      <Migas items={[{ nombre: "Armá tu outfit", href: "/outfits" }]} />
      <h1 className="mt-4 text-[clamp(2.6rem,7vw,5.5rem)] leading-[0.95]">Armá tu outfit</h1>
      <p className="mt-3 max-w-2xl text-lg text-tinta-suave">Cuatro preguntas y listo: te mostramos combinaciones con prendas que hay en tu talle y entran en tu presupuesto.</p>
      <div className="mt-10"><ArmadorOutfits descuento={config.descuentoTransferencia} /></div>
    </div>
  );
}
