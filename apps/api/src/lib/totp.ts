import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

/*
 * Doble factor con TOTP (RFC 6238): el mismo que usan Google Authenticator,
 * Authy o 1Password. 6 dígitos, 30 segundos, SHA-1 (lo que soportan todas
 * las apps). Se acepta un paso de diferencia de reloj para cada lado.
 *
 * El secreto se guarda cifrado con AES-256-GCM: quien lea la base no puede
 * generar códigos.
 */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32(buf: Buffer): string {
  let bits = 0, valor = 0, s = "";
  for (const b of buf) {
    valor = (valor << 8) | b; bits += 8;
    while (bits >= 5) { s += B32[(valor >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) s += B32[(valor << (5 - bits)) & 31];
  return s;
}
export function desdeBase32(s: string): Buffer {
  const limpio = s.replace(/=+$/, "").toUpperCase();
  let bits = 0, valor = 0;
  const out: number[] = [];
  for (const c of limpio) {
    const i = B32.indexOf(c);
    if (i < 0) throw new Error("base32 inválido");
    valor = (valor << 5) | i; bits += 5;
    if (bits >= 8) { out.push((valor >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const secretoNuevo = () => base32(randomBytes(20));

export function codigo(secreto: string, paso: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(paso));
  const h = createHmac("sha1", desdeBase32(secreto)).update(msg).digest();
  const o = h[h.length - 1]! & 15;
  const n = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 1_000_000).padStart(6, "0");
}

/** Devuelve el paso aceptado (para no aceptar el mismo código dos veces) o null. */
export function verificar(secreto: string, dado: string, ahora = Date.now()): number | null {
  if (!/^\d{6}$/.test(dado)) return null;
  const actual = Math.floor(ahora / 30_000);
  for (const d of [0, -1, 1]) if (codigo(secreto, actual + d) === dado) return actual + d;
  return null;
}

export const urlOtpauth = (secreto: string, email: string) =>
  `otpauth://totp/${encodeURIComponent(`Isuwaya:${email}`)}?secret=${secreto}&issuer=Isuwaya&algorithm=SHA1&digits=6&period=30`;

function clave(textoBase64: string): Buffer {
  const k = Buffer.from(textoBase64, "base64");
  if (k.length !== 32) throw new Error("ADMIN_CLAVE_CIFRADO tiene que ser 32 bytes en base64 (openssl rand -base64 32)");
  return k;
}
export function cifrar(texto: string, claveB64: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", clave(claveB64), iv);
  const datos = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), datos].map((b) => b.toString("base64")).join(".");
}
export function descifrar(guardado: string, claveB64: string): string {
  const [iv, tag, datos] = guardado.split(".").map((p) => Buffer.from(p, "base64"));
  const d = createDecipheriv("aes-256-gcm", clave(claveB64), iv!);
  d.setAuthTag(tag!);
  return Buffer.concat([d.update(datos!), d.final()]).toString("utf8");
}
