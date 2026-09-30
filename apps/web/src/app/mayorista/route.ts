import { NextResponse } from "next/server";
import { destinoMayorista } from "@/lib/mayorista";

/*
 * Botón "Mayorista": lleva a la tienda por mayor. El destino se lee en CADA
 * clic (no en el build): cambiar MAYORISTA_URL en Railway vale al instante,
 * sin volver a publicar la tienda.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.redirect(destinoMayorista(), { status: 302, headers: { "cache-control": "no-store", "x-robots-tag": "noindex" } });
}
