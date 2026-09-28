import type { Metadata } from "next";
import Link from "next/link";
import { PaginaLegal } from "@/components/PaginaLegal";

export const metadata: Metadata = { title: "Términos y condiciones", alternates: { canonical: "/terminos" } };

export default function Terminos() {
  return (
    <PaginaLegal titulo="Términos y condiciones" ruta="/terminos">
      <p>Estos términos rigen el uso de este sitio y las compras que hagas en él. Al comprar, aceptás estas condiciones. Si no estás de acuerdo con alguna, no uses el sitio.</p>

      <h2>Productos, precios y stock</h2>
      <ul>
        <li>Los precios están en pesos argentinos e incluyen IVA. Pueden cambiar sin aviso, pero se respeta el precio que figuraba al confirmar tu compra.</li>
        <li>El stock del sitio se actualiza en tiempo real con el de nuestros locales y depósito. Si por un error una prenda se vendió por dos canales a la vez y no la podemos entregar, te avisamos y te devolvemos el total.</li>
        <li>Las fotos y colores son lo más fieles posible; pueden variar levemente según la pantalla.</li>
        <li>Las promociones valen en las fechas indicadas y no son acumulables salvo que se diga lo contrario.</li>
      </ul>

      <h2>Medios de pago</h2>
      <ul>
        <li><strong>Tarjeta de crédito, débito o dinero en cuenta</strong> a través de Mercado Pago, con las cuotas que se indiquen en cada momento.</li>
        <li><strong>Transferencia bancaria</strong>, con el descuento que figure en el sitio. Tenés 48 horas para transferir e informar el pago; pasado ese plazo el pedido se cancela y la mercadería se libera.</li>
        <li><strong>Pago Fácil y otros medios en efectivo</strong> a través de Mercado Pago. El pedido se confirma cuando se acredita el pago.</li>
        <li><strong>Pago en el local</strong> al retirar: reservamos las prendas por el plazo que se indique al comprar.</li>
      </ul>

      <h2>Envíos y retiro</h2>
      <p>Enviamos a todo el país con Correo Argentino, Andreani o Mercado Envíos, y en el día dentro de CABA y GBA según la zona y el horario de compra. El costo y el plazo se calculan en el checkout con tu código postal. También podés retirar gratis en <Link href="/locales">nuestros locales</Link>.</p>

      <h2>Cambios, devoluciones y arrepentimiento</h2>
      <p>Ver <Link href="/devoluciones">Cambios y devoluciones</Link> y el <Link href="/arrepentimiento">Botón de arrepentimiento</Link>.</p>

      <h2>Tu cuenta</h2>
      <p>Sos responsable de mantener tu contraseña en secreto. Si sospechás que alguien usó tu cuenta, escribinos de inmediato. Podemos suspender cuentas usadas para fraudes o abusos.</p>

      <h2>Propiedad intelectual</h2>
      <p>Las fotos, diseños, textos, logos y marcas del sitio son de Isuwaya o de sus licenciantes. No se pueden copiar, republicar, vender ni usar con fines comerciales sin autorización escrita. Podés ver e imprimir páginas para tu uso personal.</p>

      <h2>Enlaces a otros sitios</h2>
      <p>Algunos enlaces llevan a sitios de terceros (Mercado Pago, empresas de correo, redes sociales). No somos responsables por su contenido ni por sus políticas.</p>

      <h2>Cambios a estos términos</h2>
      <p>Podemos actualizar estos términos. La versión vigente es la publicada en esta página, con su fecha de actualización. Una compra ya confirmada se rige por los términos vigentes al momento de hacerla.</p>

      <h2>Ley aplicable</h2>
      <p>Estos términos se rigen por las leyes de la República Argentina, en particular la Ley 24.240 de Defensa del Consumidor. Para cualquier reclamo podés acudir a <a href="https://www.argentina.gob.ar/produccion/defensadelconsumidor/formulario" target="_blank" rel="noopener noreferrer">Defensa del Consumidor</a>.</p>
    </PaginaLegal>
  );
}
