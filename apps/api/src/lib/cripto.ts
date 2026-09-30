import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/* Tokens al azar (sesión, acceso a un pedido, restablecer contraseña). En la base sólo va su hash. */
export const tokenNuevo = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function iguales(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
