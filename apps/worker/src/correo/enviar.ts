import nodemailer from "nodemailer";
import { z } from "zod";
import { armar, PLANTILLAS, type Plantilla } from "./plantillas.js";

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

export function crearCorreo(o: { smtp?: string; de: string; responder?: string }) {
  // Topes propios: los de nodemailer (2 min para conectar, 10 de inactividad) dejan colgado el trabajo de la cola.
  const t = o.smtp ? nodemailer.createTransport({ url: o.smtp, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 30_000 }) : null;
  return async (datos: unknown) => {
    const j = Trabajo.parse(datos);
    const m = armar(j.plantilla as Plantilla, j.datos);
    if (!t) {
      console.warn(`[correo] sin SMTP_URL: no se manda «${m.asunto}» a ${j.para.replace(/^(.).*@/, "$1***@")}`);
      return { enviado: false };
    }
    const r = await t.sendMail({ from: o.de, to: j.para, replyTo: o.responder, subject: m.asunto, html: m.html, text: m.texto });
    return { enviado: true, id: r.messageId };
  };
}
