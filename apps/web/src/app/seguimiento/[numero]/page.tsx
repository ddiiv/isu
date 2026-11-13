import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SeguimientoPublico } from "@/components/pedido/SeguimientoPublico";

/*
 * Seguimiento sin iniciar sesión: el enlace del WhatsApp o del mail
 * (/seguimiento/ISU-1001?t=…). Sólo cómo viene el envío; la firma `t` la
 * verifica la API. No se indexa ni se manda el enlace a otros sitios.
 */
export const metadata: Metadata = { title: "Seguí tu envío", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function Seguimiento({ params, searchParams }: { params: Promise<{ numero: string }>; searchParams: Promise<{ t?: string }> }) {
  let crudo = (await params).numero;
  try { crudo = decodeURIComponent(crudo); } catch { notFound(); }
  // El botón de WhatsApp pega «ISU-1001?t=…» al final de la URL; si llega con el «?» codificado, viene todo en el número.
  const [numero, enRuta] = crudo.split("?t=");
  const t = enRuta ?? (await searchParams).t;
  if (!/^ISU-\d{4,10}$/.test(numero!) || typeof t !== "string" || !/^[A-Za-z0-9_-]{24}$/.test(t)) notFound();
  return <SeguimientoPublico numero={numero!} firma={t} />;
}
