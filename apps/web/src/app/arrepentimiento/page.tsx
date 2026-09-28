import type { Metadata } from "next";
import { PaginaLegal } from "@/components/PaginaLegal";
import { obtenerConfig } from "@/lib/api";

export const metadata: Metadata = { title: "Botón de arrepentimiento", alternates: { canonical: "/arrepentimiento" } };
export const revalidate = 300;

/*
 * Botón de arrepentimiento (Res. SCI 424/2020): tiene que estar a la vista
 * desde el inicio y permitir revocar la compra sin registrarse ni dar motivos.
 * En la etapa 2 se suma el formulario que genera el código de trámite
 * automáticamente; hasta entonces el pedido se hace por WhatsApp.
 */
export default async function Arrepentimiento() {
  const config = await obtenerConfig();
  const texto = encodeURIComponent("Hola Isuwaya, quiero ejercer mi derecho de arrepentimiento. Mi número de pedido es: ");
  return (
    <PaginaLegal titulo="Botón de arrepentimiento" ruta="/arrepentimiento">
      <p>
        Si compraste online, tenés <strong>10 días corridos</strong> desde que recibiste el producto para arrepentirte de la compra, sin dar explicaciones
        y sin ningún costo (Ley 24.240, art. 34). No hace falta que tengas una cuenta en el sitio.
      </p>
      <h2>Cómo pedirlo</h2>
      <ul>
        <li>Mandanos tu número de pedido, nombre completo y el email con el que compraste.</li>
        <li>Te respondemos con un <strong>código de trámite</strong> en menos de 24 horas y te indicamos cómo devolvernos la prenda.</li>
        <li>El envío de la devolución corre por nuestra cuenta.</li>
        <li>Te devolvemos el total que pagaste, incluido el envío, por el mismo medio de pago.</li>
      </ul>
      <p className="mt-8">
        <a href={`https://wa.me/${config.whatsapp}?text=${texto}`} target="_blank" rel="noopener noreferrer" className="boton-marca no-underline">
          Quiero arrepentirme de mi compra
        </a>
      </p>
    </PaginaLegal>
  );
}
