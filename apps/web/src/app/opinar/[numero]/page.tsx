import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FormOpinar } from "@/components/resenas/FormOpinar";

/* Opinar de una compra entregada: se llega con el enlace firmado del mail (o desde el pedido). */
export const metadata: Metadata = { title: "Contanos qué te pareció", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function Opinar({ params, searchParams }: { params: Promise<{ numero: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { numero } = await params;
  const q = await searchParams;
  const t = typeof q.t === "string" ? q.t : "";
  const e = Number(typeof q.e === "string" ? q.e : 0);
  if (!/^ISU-\d{4,10}$/.test(numero) || !/^[A-Za-z0-9_-]{24}$/.test(t)) notFound();
  return (
    <div className="contenedor max-w-3xl pt-10 pb-20">
      <FormOpinar numero={numero} firma={t} estrellasIniciales={Number.isInteger(e) && e >= 1 && e <= 5 ? e : null} />
    </div>
  );
}
