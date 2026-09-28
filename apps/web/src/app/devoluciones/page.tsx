import type { Metadata } from "next";
import Link from "next/link";
import { PaginaLegal } from "@/components/PaginaLegal";

export const metadata: Metadata = { title: "Cambios y devoluciones", alternates: { canonical: "/devoluciones" } };

export default function Devoluciones() {
  return (
    <PaginaLegal titulo="Cambios y devoluciones" ruta="/devoluciones">
      <p>Queremos que la prenda te quede bien. Si no es así, la cambiamos o te devolvemos la plata según estas reglas.</p>

      <h2>Cambios</h2>
      <ul>
        <li>Tenés <strong>30 días corridos</strong> desde que recibiste tu compra para pedir un cambio de talle o de color.</li>
        <li>La prenda tiene que estar sin uso, sin lavar, con sus etiquetas y en el mismo estado en que la recibiste.</li>
        <li>Necesitamos el número de pedido o el comprobante de compra.</li>
        <li>Podés cambiarla en cualquiera de <Link href="/locales">nuestros locales</Link> sin costo, o por envío: en ese caso el envío de ida y vuelta del cambio corre por tu cuenta, salvo que la prenda tenga una falla.</li>
        <li>El cambio está sujeto al stock del talle o color que quieras. Si no hay, te ofrecemos otra prenda o te devolvemos el dinero.</li>
      </ul>

      <h2>Prendas con falla</h2>
      <p>Si la prenda llegó con una falla de fabricación o no es la que pediste, escribinos dentro de los 30 días con una foto. El cambio o la devolución no tienen ningún costo para vos: nos hacemos cargo de los envíos.</p>

      <h2>Derecho de arrepentimiento (10 días)</h2>
      <p>
        Por ser una compra a distancia, tenés derecho a arrepentirte dentro de los <strong>10 días corridos</strong> desde que recibiste el producto,
        sin dar explicaciones y sin costo (Ley 24.240, art. 34). Vale para todas las prendas, también las que compraste en oferta.
        Podés pedirlo desde el <Link href="/arrepentimiento">Botón de arrepentimiento</Link>.
      </p>

      <h2>Devolución del dinero</h2>
      <ul>
        <li>Revisamos la prenda cuando nos llega y te avisamos por email o WhatsApp si la devolución fue aprobada.</li>
        <li>Te devolvemos el dinero por el mismo medio con el que pagaste: tarjeta o Mercado Pago (según los plazos de tu banco o de Mercado Pago), o transferencia a una cuenta a tu nombre.</li>
        <li>En un arrepentimiento o una prenda con falla te devolvemos también lo que pagaste de envío.</li>
      </ul>

      <h2>¿Cómo lo pido?</h2>
      <p>Escribinos por WhatsApp con tu número de pedido y te indicamos los pasos. Atendemos de lunes a viernes de 8 a 14 h.</p>
    </PaginaLegal>
  );
}
