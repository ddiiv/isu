import nodemailer from "nodemailer";
import type pg from "pg";
import { z } from "zod";
import { armar, PLANTILLAS, type Plantilla } from "./plantillas.js";
import { cargarPedido } from "./pedido.js";
import { pdfPedido } from "./pdf.js";

/*
 * Envío por SMTP (en local, Mailpit; en producción, el proveedor que se elija:
 * Gmail Workspace, Brevo, SES…). Sin SMTP_URL configurado, el mail se anota
 * en el log y no se manda: una tienda sin mails sigue vendiendo.
 */
const Trabajo = z.object({
  plantilla: z.enum(PLANTILLAS),
  para: z.string().email().max(150),
  datos: z.record(z.string(), z.unknown()),
});

/*
 * «Pago confirmado» lleva el PDF del pedido; «venta_tienda» (el aviso interno) sale a `ventas`
 * (CORREO_VENTAS; sin ella no se manda) con el PDF y el link al pedido en el backoffice (`adminUrl`).
 * Los datos del PDF salen de la base, del pedido de ese número; el PDF no se guarda en ningún lado.
 */
export function crearCorreo(o: { smtp?: string; de: string; responder?: string; pool?: pg.Pool; ventas?: string; adminUrl?: string }) {
  // Topes propios: los de nodemailer (2 min para conectar, 10 de inactividad) dejan colgado el trabajo de la cola.
  const t = o.smtp ? nodemailer.createTransport({ url: o.smtp, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 30_000 }) : null;
  return async (datos: unknown) => {
    const j = Trabajo.parse(datos);
    // Recordatorio de carrito: si entre que se encoló y ahora la persona se dio de baja o compró (un reintento con espera, o el hueco
    // entre marcar y encolar), el mail se descarta sin error.
    if (j.plantilla === "carrito_abandonado" && o.pool) {
      const vigente = await o.pool.query("SELECT 1 FROM tienda.carritos_abandonados WHERE email = lower($1) AND baja_en IS NULL AND convertido_en IS NULL", [j.para]);
      if (!vigente.rows.length) return { enviado: false, omitido: "baja o compra" };
    }
    const interno = j.plantilla === "venta_tienda";
    if (interno && !o.ventas) return { enviado: false, omitido: "sin CORREO_VENTAS" };
    const cargar = (interno || j.plantilla === "pago_confirmado") && o.pool && typeof j.datos.numero === "string" ? cargarPedido(o.pool, j.datos.numero) : null;
    // Al cliente el mail le llega igual aunque la base no conteste (sale sin el PDF); el interno se arma con la base y reintenta.
    const pedido = interno ? await cargar : await cargar?.catch((e: Error) => { console.error("[correo] no se pudo leer el pedido para el PDF:", e.message); return null; }) ?? null;
    // El aviso interno se arma entero con lo que dice la base; si el pedido no está, reintentar no lo arregla.
    if (interno && !pedido) throw Object.assign(new Error("Venta de un pedido que no existe"), { sinReintento: true });
    // Un pago_confirmado sólo lleva el PDF si el pedido es de quien recibe el mail.
    const adjuntar = pedido && (interno || pedido.email.toLowerCase() === j.para.toLowerCase()) ? pedido : null;
    const m = armar(j.plantilla as Plantilla, interno ? { ...pedido, enlaceAdmin: o.adminUrl ? `${o.adminUrl.replace(/\/+$/, "")}/pedidos/${pedido!.numero}` : null } : j.datos);
    const para = interno ? o.ventas! : j.para;
    if (!t) {
      console.warn(`[correo] sin SMTP_URL: no se manda «${m.asunto}» a ${para.replace(/^(.).*@/, "$1***@")}`);
      return { enviado: false };
    }
    let attachments: Array<{ filename: string; content: Buffer; contentType: string }> | undefined;
    if (adjuntar) {
      // Un PDF que no sale no frena el mail: el cliente tiene que enterarse igual de que pagó.
      try { attachments = [{ filename: `pedido-${adjuntar.numero}.pdf`, content: await pdfPedido(adjuntar, interno), contentType: "application/pdf" }]; }
      catch (e) { console.error(`[correo] no se pudo armar el PDF de ${adjuntar.numero}:`, (e as Error).message); }
    }
    // Sólo el recordatorio de carrito lleva el enlace de baja también en la cabecera (el cliente de mail muestra «Cancelar suscripción»).
    const baja = j.plantilla === "carrito_abandonado" && typeof j.datos.baja === "string" && /^https:\/\/[^\s"'<>]+$/.test(j.datos.baja) ? { "List-Unsubscribe": `<${j.datos.baja}>` } : undefined;
    const r = await t.sendMail({ from: o.de, to: para, replyTo: o.responder, subject: m.asunto, html: m.html, text: m.texto, attachments, headers: baja });
    return { enviado: true, id: r.messageId };
  };
}
