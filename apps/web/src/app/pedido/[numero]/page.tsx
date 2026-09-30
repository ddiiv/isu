import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { obtenerConfig } from "@/lib/api";
import { EstadoPedido } from "@/components/pedido/EstadoPedido";

export const metadata: Metadata = { title: "Tu pedido", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function Pedido({ params }: { params: Promise<{ numero: string }> }) {
  const { numero } = await params;
  if (!/^ISU-\d{4,10}$/.test(numero)) notFound();
  const config = await obtenerConfig();
  return <EstadoPedido numero={numero} whatsapp={config.whatsapp} />;
}
