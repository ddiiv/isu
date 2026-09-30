import { formatearPesos } from "@isu/shared";

/*
 * Mails al cliente. HTML simple (tablas, estilos en línea: es lo que leen
 * bien Gmail, Outlook y los celulares) y siempre una versión en texto.
 *
 * TODO lo que viene del pedido se escapa: un "nombre" con HTML adentro no
 * puede convertir nuestro mail en un phishing con nuestro remitente.
 */
export const PLANTILLAS = [
  "bienvenida", "restablecer", "pedido_recibido", "pago_confirmado", "pedido_vencido", "arrepentimiento", "transferencia_informada",
  // Etapa 4: cómo viene el envío.
  "envio_en_camino", "envio_en_sucursal", "envio_llega_hoy", "envio_entregado", "envio_no_entregado",
] as const;
export type Plantilla = (typeof PLANTILLAS)[number];

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const MARCA = "#2c5f91", AHORRO = "#2e6b3f";

interface Item { nombre: string; color: string | null; talle: string | null; precio: number; cantidad: number }
interface DatosPedido {
  numero: string; nombre: string; medioPago: string; total: number; subtotal: number; descuento: number; envio: number;
  /** "cupón VERANO10 (10% OFF)" o "promo …" (etapa 6) */
  cupon?: string | null; descuentoCupon?: number;
  entrega: "envio" | "retiro"; local: string | null; venceEn: string | null; items: Item[]; enlace: string;
  transferencia: { titular: string; cuit: string; banco: string; cbu: string; alias: string } | null;
}

const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : "");
// Sólo enlaces nuestros (http/https): un dato raro no puede meter un javascript: en un botón.
const enlaceSeguro = (u: unknown) => (typeof u === "string" && /^https?:\/\/[^\s"'<>]+$/.test(u) ? u : "#");

function marco(titulo: string, cuerpo: string, pie = "Isuwaya · Hacemos la ropa que vendemos") {
  return `<!doctype html><html lang="es"><body style="margin:0;background:#f6f6f5;font-family:Arial,Helvetica,sans-serif;color:#171717">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f6f5;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:14px;overflow:hidden">
<tr><td style="background:${MARCA};color:#fff;padding:18px 24px;font-size:22px;font-weight:bold">Isuwaya</td></tr>
<tr><td style="padding:28px 24px"><h1 style="margin:0 0 16px;font-size:22px">${esc(titulo)}</h1>${cuerpo}</td></tr>
<tr><td style="padding:16px 24px;background:#f6f6f5;color:#6b6b6b;font-size:12px">${esc(pie)}</td></tr>
</table></td></tr></table></body></html>`;
}
const boton = (texto: string, url: string) =>
  `<p style="margin:24px 0"><a href="${esc(enlaceSeguro(url))}" style="background:#171717;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:bold;display:inline-block">${esc(texto)}</a></p>`;

function tablaItems(d: DatosPedido) {
  const filas = d.items.map((i) => `<tr><td style="padding:6px 0">${esc(i.cantidad)} × ${esc(i.nombre)}${i.color ? ` · ${esc(i.color)}` : ""}${i.talle ? ` · ${esc(i.talle)}` : ""}</td><td align="right">${esc(formatearPesos(i.precio * i.cantidad))}</td></tr>`).join("");
  const extra = [
    d.cupon ? `<tr><td style="color:${AHORRO}">${esc(d.cupon.charAt(0).toUpperCase() + d.cupon.slice(1))}</td><td align="right" style="color:${AHORRO}">${d.descuentoCupon ? `−${esc(formatearPesos(d.descuentoCupon))}` : "Envío gratis"}</td></tr>` : "",
    d.descuento ? `<tr><td style="color:${AHORRO}">Descuento por transferencia</td><td align="right" style="color:${AHORRO}">−${esc(formatearPesos(d.descuento))}</td></tr>` : "",
    d.entrega === "envio" ? `<tr><td>Envío</td><td align="right">${d.envio ? esc(formatearPesos(d.envio)) : "Gratis"}</td></tr>` : `<tr><td>Retiro en ${esc(d.local)}</td><td align="right">Gratis</td></tr>`,
  ].join("");
  return `<table role="presentation" width="100%" style="font-size:14px;border-top:1px solid #e7e5e4;border-bottom:1px solid #e7e5e4;margin:16px 0">${filas}${extra}
<tr><td style="padding:8px 0;font-weight:bold">Total</td><td align="right" style="font-weight:bold">${esc(formatearPesos(d.total))}</td></tr></table>`;
}
const textoItems = (d: DatosPedido) => d.items.map((i) => `- ${i.cantidad} × ${i.nombre}${i.color ? ` · ${i.color}` : ""}${i.talle ? ` · ${i.talle}` : ""}`).join("\n") + `\nTotal: ${formatearPesos(d.total)}`;

export function armar(plantilla: Plantilla, datos: Record<string, unknown>): { asunto: string; html: string; texto: string } {
  switch (plantilla) {
    case "bienvenida":
      return {
        asunto: "Bienvenida a Isuwaya",
        html: marco(`¡Hola, ${datos.nombre}!`, `<p>Ya tenés tu cuenta en Isuwaya. Desde ahí ves tus pedidos y comprás más rápido.</p>`),
        texto: `¡Hola, ${datos.nombre}! Ya tenés tu cuenta en Isuwaya.`,
      };
    case "restablecer": {
      const crear = datos.modo === "crear";
      const titulo = crear ? "Creá tu contraseña" : "Cambiá tu contraseña";
      return {
        asunto: `${titulo} · Isuwaya`,
        html: marco(titulo, `<p>Hola, ${esc(datos.nombre)}. Tocá el botón para ${crear ? "crear" : "elegir"} tu contraseña. El enlace vale una hora y sirve una sola vez.</p>${boton(titulo, String(datos.enlace))}<p style="color:#6b6b6b;font-size:13px">Si no lo pediste, ignorá este mail: tu cuenta sigue igual.</p>`),
        texto: `${titulo}: ${datos.enlace}\nVale una hora. Si no lo pediste, ignorá este mail.`,
      };
    }
    case "pedido_recibido": {
      const d = datos as unknown as DatosPedido;
      let como: string;
      if (d.medioPago === "transferencia" && d.transferencia) {
        const t = d.transferencia;
        como = `<p><b>Transferí ${esc(formatearPesos(d.total))}</b> antes del ${esc(fecha(d.venceEn))}:</p>
<table role="presentation" style="font-size:14px;background:#e9f3ec;border-radius:10px;padding:12px;width:100%">
<tr><td>Titular</td><td><b>${esc(t.titular)}</b></td></tr><tr><td>CUIT</td><td>${esc(t.cuit)}</td></tr><tr><td>Banco</td><td>${esc(t.banco)}</td></tr>
<tr><td>CBU</td><td><b>${esc(t.cbu)}</b></td></tr><tr><td>Alias</td><td><b>${esc(t.alias)}</b></td></tr></table>
<p>Después subí el comprobante desde tu pedido: así lo confirmamos más rápido.</p>`;
      } else if (d.medioPago === "local") {
        como = `<p>Lo pagás al retirarlo en <b>${esc(d.local)}</b> hasta el ${esc(fecha(d.venceEn))}. Te lo tenemos guardado.</p>`;
      } else {
        como = `<p>Si todavía no terminaste de pagar, lo podés hacer desde tu pedido hasta el ${esc(fecha(d.venceEn))}.</p>`;
      }
      return {
        asunto: `Recibimos tu pedido ${d.numero}`,
        html: marco(`¡Gracias, ${d.nombre}! Tu pedido es el ${d.numero}`, `<p>Ya te separamos las prendas.</p>${como}${tablaItems(d)}${boton("Ver mi pedido", d.enlace)}`),
        texto: `¡Gracias, ${d.nombre}! Tu pedido es el ${d.numero}.\n${textoItems(d)}\nVer el pedido: ${d.enlace}`,
      };
    }
    case "pago_confirmado": {
      const d = datos as unknown as DatosPedido;
      const sigue = d.entrega === "retiro" ? `Te avisamos cuando esté listo para retirar en ${esc(d.local)}.` : "Te avisamos cuando lo despachemos.";
      return {
        asunto: `Pago confirmado · pedido ${d.numero}`,
        html: marco("¡Pago confirmado!", `<p>Hola, ${esc(d.nombre)}. Ya está pago tu pedido <b>${esc(d.numero)}</b>. ${sigue}</p>${tablaItems(d)}${boton("Ver mi pedido", d.enlace)}`),
        texto: `Pago confirmado para el pedido ${d.numero}.\n${textoItems(d)}`,
      };
    }
    case "pedido_vencido": {
      const d = datos as unknown as DatosPedido;
      return {
        asunto: `Tu pedido ${d.numero} venció`,
        html: marco("Tu pedido venció", `<p>Hola, ${esc(d.nombre)}. No recibimos el pago del pedido <b>${esc(d.numero)}</b> a tiempo, así que liberamos las prendas. Si todavía las querés, podés volver a comprarlas en la tienda.</p><p>Si ya pagaste, respondé este mail con el comprobante y lo resolvemos.</p>`),
        texto: `No recibimos el pago del pedido ${d.numero} a tiempo y liberamos las prendas. Si ya pagaste, respondé este mail con el comprobante.`,
      };
    }
    case "transferencia_informada":
      return {
        asunto: `Recibimos tu comprobante · pedido ${datos.numero}`,
        html: marco("Recibimos tu comprobante", `<p>Hola, ${esc(datos.nombre)}. Estamos verificando la transferencia del pedido <b>${esc(datos.numero)}</b>. Te avisamos apenas se acredite.</p>`),
        texto: `Recibimos el comprobante del pedido ${datos.numero}. Te avisamos cuando se acredite.`,
      };
    case "envio_en_camino":
    case "envio_en_sucursal":
    case "envio_llega_hoy":
    case "envio_entregado":
    case "envio_no_entregado": {
      const d = datos as { numero: string; nombre: string; transporte: string; seguimiento: string | null; sucursal: string | null; enlace: string };
      const num = d.seguimiento ? ` (seguimiento ${esc(d.seguimiento)})` : "";
      const t: Record<typeof plantilla, [string, string, string]> = {
        envio_en_camino: [`Tu pedido ${d.numero} está en camino`, "¡Tu pedido salió!", `Ya lo despachamos con <b>${esc(d.transporte)}</b>${num}. Te avisamos cuando esté por llegar.`],
        envio_en_sucursal: [`Tu pedido ${d.numero} ya está en la sucursal`, "Ya podés retirarlo", `Tu pedido llegó a la sucursal <b>${esc(d.sucursal ?? d.transporte)}</b>. Llevá tu DNI para retirarlo.`],
        envio_llega_hoy: [`Tu pedido ${d.numero} llega hoy`, "¡Llega hoy!", `Tu pedido salió a reparto con <b>${esc(d.transporte)}</b>. Si no vas a estar, avisá a alguien que lo pueda recibir.`],
        envio_entregado: [`Entregamos tu pedido ${d.numero}`, "¡Pedido entregado!", "Esperamos que te encante. Si algo no te queda bien, respondé este mail y lo resolvemos."],
        envio_no_entregado: [`No pudimos entregar tu pedido ${d.numero}`, "No pudimos entregarlo", `<b>${esc(d.transporte)}</b> intentó entregar tu pedido y no pudo. Mirá el seguimiento para ver cómo sigue, o respondé este mail y te ayudamos.`],
        // (las demás plantillas no llegan acá)
      } as never;
      const [asunto, titulo, cuerpo] = t[plantilla];
      const textoPlano = cuerpo.replace(/<[^>]+>/g, "");
      return {
        asunto,
        html: marco(titulo, `<p>Hola, ${esc(d.nombre)}. ${cuerpo}</p>${plantilla === "envio_entregado" ? "" : boton("Seguir mi envío", d.enlace)}`),
        texto: `Hola, ${d.nombre}. ${textoPlano}${plantilla === "envio_entregado" ? "" : `\nSeguí tu envío: ${d.enlace}`}`,
      };
    }
    case "arrepentimiento":
      return {
        asunto: `Arrepentimiento de compra · código ${datos.codigo}`,
        html: marco("Recibimos tu pedido de arrepentimiento", `<p>Hola, ${esc(datos.nombre)}. Registramos la revocación de la compra <b>${esc(datos.numero)}</b>.</p><p>Código de trámite: <b>${esc(datos.codigo)}</b></p><p>${datos.resultado === "cancelado" ? "El pedido quedó cancelado y no se te cobra nada." : datos.resultado === "cancelado_reembolso" ? "El pedido quedó cancelado: te devolvemos el dinero por el mismo medio de pago." : "Te contactamos dentro de las 24 horas hábiles para coordinar la devolución."}</p>`),
        texto: `Registramos el arrepentimiento de la compra ${datos.numero}. Código de trámite: ${datos.codigo}.`,
      };
  }
}
