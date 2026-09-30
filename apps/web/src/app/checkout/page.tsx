import type { Metadata } from "next";
import { obtenerConfig } from "@/lib/api";
import { Checkout } from "@/components/checkout/Checkout";

export const metadata: Metadata = { title: "Finalizar compra", robots: { index: false, follow: false } };

export default async function PaginaCheckout() {
  const config = await obtenerConfig();
  return <Checkout config={config} />;
}
