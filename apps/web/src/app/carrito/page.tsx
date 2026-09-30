import type { Metadata } from "next";
import { obtenerConfig } from "@/lib/api";
import { PaginaCarrito } from "@/components/carrito/PaginaCarrito";

export const metadata: Metadata = { title: "Carrito", robots: { index: false, follow: false } };

export default async function Carrito() {
  const config = await obtenerConfig();
  return <PaginaCarrito descuento={config.descuentoTransferencia} />;
}
