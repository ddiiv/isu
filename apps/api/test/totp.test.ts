import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { base32, cifrar, codigo, descifrar, desdeBase32, secretoNuevo, verificar } from "../src/lib/totp.js";

describe("TOTP (RFC 6238)", () => {
  it("coincide con los vectores de prueba del RFC (SHA-1)", () => {
    // Secreto del RFC: "12345678901234567890" en ASCII; se comparan los 6 últimos dígitos.
    const s = base32(Buffer.from("12345678901234567890"));
    expect(codigo(s, Math.floor(59 / 30))).toBe("287082");
    expect(codigo(s, Math.floor(1111111109 / 30))).toBe("081804");
    expect(codigo(s, Math.floor(1234567890 / 30))).toBe("005924");
    expect(codigo(s, Math.floor(2000000000 / 30))).toBe("279037");
  });
  it("base32 ida y vuelta", () => {
    const b = randomBytes(20);
    expect(desdeBase32(base32(b)).equals(b)).toBe(true);
  });
  it("acepta un paso de desfase y nada más", () => {
    const s = secretoNuevo();
    const t = 1_800_000_000_000;
    const paso = Math.floor(t / 30_000);
    expect(verificar(s, codigo(s, paso), t)).toBe(paso);
    expect(verificar(s, codigo(s, paso - 1), t)).toBe(paso - 1);
    expect(verificar(s, codigo(s, paso + 2), t)).toBeNull();
    expect(verificar(s, "12345", t)).toBeNull();
    expect(verificar(s, "abcdef", t)).toBeNull();
  });
  it("el secreto se guarda cifrado y no se puede alterar", () => {
    const k = randomBytes(32).toString("base64");
    const c = cifrar("SECRETO", k);
    expect(c).not.toContain("SECRETO");
    expect(descifrar(c, k)).toBe("SECRETO");
    const [iv, tag, datos] = c.split(".");
    const alterado = [iv, tag, Buffer.from("x" + Buffer.from(datos!, "base64").toString("latin1")).toString("base64")].join(".");
    expect(() => descifrar(alterado, k)).toThrow();
    expect(() => descifrar(c, randomBytes(32).toString("base64"))).toThrow();
  });
});
