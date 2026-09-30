import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/*
 * Enlace de seguimiento que va en el WhatsApp y en los mails del envío:
 * /seguimiento/ISU-1001?t=… — muestra SÓLO cómo viene el envío (sin datos
 * personales ni montos), sin iniciar sesión. `t` es una firma del número con
 * una clave derivada de INTERNO_TOKEN: no se puede adivinar la de otro pedido.
 * La usan la API (verifica) y el worker (arma el enlace).
 */
const clave = (secreto: string) => createHash("sha256").update(`isu:seguimiento:${secreto}`).digest();

export const firmaSeguimiento = (numero: string, secreto: string) =>
  createHmac("sha256", clave(secreto)).update(numero).digest("base64url").slice(0, 24);

export function firmaSeguimientoValida(numero: string, firma: string, secreto: string): boolean {
  const a = Buffer.from(firmaSeguimiento(numero, secreto));
  const b = Buffer.from(firma);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const enlaceSeguimiento = (sitio: string, numero: string, secreto: string) =>
  `${sitio.replace(/\/+$/, "")}/seguimiento/${encodeURIComponent(numero)}?t=${firmaSeguimiento(numero, secreto)}`;
