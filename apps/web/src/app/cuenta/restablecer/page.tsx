import type { Metadata } from "next";
import { Restablecer } from "@/components/cuenta/Restablecer";

export const metadata: Metadata = { title: "Nueva contraseña", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default function PaginaRestablecer() {
  return <Restablecer />;
}
