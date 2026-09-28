import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Mi cuenta", robots: { index: false } };

/* Pantalla de la etapa 2. Existe para que el enlace del header no dé 404. */
export default function Pagina() {
  return (
    <div className="contenedor py-24 text-center">
      <h1 className="text-5xl">Mi cuenta</h1>
      <p className="mt-4 text-tinta-suave">Muy pronto vas a poder comprar online. Mientras tanto, escribinos por WhatsApp.</p>
      <Link href="/" className="boton-primario mt-8">Volver al inicio</Link>
    </div>
  );
}
