import type { Metadata } from "next";
import { PaginaLegal } from "@/components/PaginaLegal";

export const metadata: Metadata = { title: "Política de privacidad", alternates: { canonical: "/privacidad" } };

export default function Privacidad() {
  return (
    <PaginaLegal titulo="Política de privacidad" ruta="/privacidad">
      <p>Esta política explica qué datos personales recolectamos cuando visitás este sitio o comprás en él, para qué los usamos y qué derechos tenés sobre ellos, según la Ley 25.326 de Protección de Datos Personales.</p>

      <h2>Qué datos recolectamos</h2>
      <ul>
        <li><strong>Datos del pedido:</strong> nombre, DNI o CUIT, email, teléfono, dirección de entrega y los productos que compraste.</li>
        <li><strong>Datos de pago:</strong> los procesa Mercado Pago. Nosotros no vemos ni guardamos los números de tu tarjeta.</li>
        <li><strong>Consultas al asistente de la tienda:</strong> la conversación no se guarda (queda sólo en tu navegador mientras la pestaña está abierta). Las preguntas que no supo responder se guardan sin datos personales (se borran emails, teléfonos y números) hasta 90 días, para mejorar las respuestas. Para ver un pedido desde el asistente se usan el número de pedido y el email, y no se guardan.</li>
        <li><strong>Datos de navegación:</strong> dirección IP, tipo de navegador y páginas visitadas, mediante cookies y Google Analytics.</li>
      </ul>

      <h2>Para qué los usamos</h2>
      <ul>
        <li>Preparar y enviar tu pedido, emitir la factura y avisarte por email y WhatsApp en qué estado está.</li>
        <li>Responder tus consultas y gestionar cambios, devoluciones y arrepentimientos.</li>
        <li>Prevenir fraudes y proteger la seguridad del sitio.</li>
        <li>Entender cómo se usa el sitio para mejorarlo. Sólo te mandamos promociones si nos diste permiso, y podés darte de baja cuando quieras.</li>
      </ul>

      <h2>Con quién los compartimos</h2>
      <p>Sólo con quienes necesitamos para completar tu compra: Mercado Pago (pagos), Correo Argentino, Andreani, OCA, Mercado Envíos y Cabify (entregas), el proveedor de mensajería de WhatsApp y de email (avisos), Google Analytics (estadísticas) y, si el asistente con inteligencia artificial está activo, Anthropic (sólo el texto de la consulta, para generar la respuesta). No vendemos tus datos.</p>

      <h2>Cuánto tiempo los guardamos</h2>
      <p>Mientras tengas una cuenta o mientras sean necesarios para cumplir obligaciones fiscales y de defensa del consumidor.</p>

      <h2>Tus derechos</h2>
      <p>Podés pedir acceso, rectificación, actualización o supresión de tus datos escribiéndonos por WhatsApp o email. Respondemos en los plazos que fija la ley (10 días para el acceso, 5 días hábiles para rectificar o suprimir).</p>
      <p>El titular de los datos personales tiene la facultad de ejercer el derecho de acceso a los mismos en forma gratuita a intervalos no inferiores a seis meses, salvo que se acredite un interés legítimo al efecto conforme lo establecido en el artículo 14, inciso 3 de la Ley N° 25.326. La AGENCIA DE ACCESO A LA INFORMACIÓN PÚBLICA, en su carácter de Órgano de Control de la Ley N° 25.326, tiene la atribución de atender las denuncias y reclamos que interpongan quienes resulten afectados en sus derechos por incumplimiento de las normas vigentes en materia de protección de datos personales.</p>

      <h2>Cookies</h2>
      <p>Usamos cookies propias para que funcionen el carrito y tu sesión, y de Google Analytics para medir visitas. Podés borrarlas o bloquearlas desde tu navegador; si bloqueás las propias, el carrito puede no funcionar.</p>
    </PaginaLegal>
  );
}
