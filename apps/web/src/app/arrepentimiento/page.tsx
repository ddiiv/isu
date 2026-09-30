import type { Metadata } from "next";
import { PaginaLegal } from "@/components/PaginaLegal";
import { obtenerConfig } from "@/lib/api";
import { FormArrepentimiento } from "@/components/FormArrepentimiento";

export const metadata: Metadata = { title: "Botón de arrepentimiento", alternates: { canonical: "/arrepentimiento" } };
export const revalidate = 300;

/*
 * Botón de arrepentimiento (Res. SCI 424/2020): tiene que estar a la vista
 * desde el inicio y permitir revocar la compra sin registrarse ni dar motivos.
 * El formulario genera el código de trámite en el momento y, si el pedido
 * todavía no salió, lo cancela solo.
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
        <li>Completá el formulario con tu número de pedido y el email con el que compraste.</li>
        <li>Te damos el <strong>código de trámite</strong> en el momento. Si el pedido todavía no salió, queda cancelado ahí mismo; si ya lo recibiste, te indicamos cómo devolvernos la prenda.</li>
        <li>El envío de la devolución corre por nuestra cuenta.</li>
        <li>Te devolvemos el total que pagaste, incluido el envío, por el mismo medio de pago.</li>
      </ul>
      <FormArrepentimiento />
      <p className="mt-6 text-sm">
        ¿Preferís hacerlo por WhatsApp?{" "}
        <a href={`https://wa.me/${config.whatsapp}?text=${texto}`} target="_blank" rel="noopener noreferrer" >
          Escribinos
        </a>
      </p>
    </PaginaLegal>
  );
}
