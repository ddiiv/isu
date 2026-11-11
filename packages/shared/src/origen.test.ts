import { describe, expect, it } from "vitest";
import { limpiarOrigen, origenAGuardar, origenVigente, referidoDe } from "./origen.js";
import { OrigenPedido } from "./checkout.js";

const AHORA = Date.UTC(2026, 5, 1);
const url = (s: string) => new URLSearchParams(s);

describe("origen de la compra", () => {
  it("sanitiza: minúsculas, sólo [a-z0-9._-], hasta 60", () => {
    expect(limpiarOrigen("Insta Gram!<b>")).toBe("instagramb");
    expect(limpiarOrigen("a".repeat(100))).toHaveLength(60);
    expect(limpiarOrigen("¡¡")).toBeUndefined();
    expect(limpiarOrigen({ x: 1 })).toBeUndefined();
  });
  it("toma los UTM y de los click id sólo que existieron", () => {
    const g = origenAGuardar(null, url("utm_source=Instagram&utm_medium=bio&utm_campaign=lanzamiento&gclid=SECRETO123"), "", "isuwaya.com", AHORA)!;
    expect(g).toEqual({ fuente: "instagram", medio: "bio", campana: "lanzamiento", gclid: true, fecha: AHORA });
    expect(JSON.stringify(g)).not.toContain("secreto");
    expect(origenAGuardar(null, url("fbclid=abc"), "", "isuwaya.com", AHORA)).toEqual({ gclid: true, fecha: AHORA });
  });
  it("la campaña nueva pisa a la guardada; sin campaña no toca lo vigente", () => {
    const viejo = { fuente: "google", fecha: AHORA - 1000 };
    expect(origenAGuardar(viejo, url("utm_source=tiktok"), "", "isuwaya.com", AHORA)?.fuente).toBe("tiktok");
    expect(origenAGuardar(viejo, url(""), "https://instagram.com/", "isuwaya.com", AHORA)).toBeNull();
  });
  it("el referido sólo en la primera visita y de otro sitio, sin ruta", () => {
    expect(origenAGuardar(null, url(""), "https://www.instagram.com/p/abc?x=1", "isuwaya.com", AHORA)).toEqual({ referido: "instagram.com", fecha: AHORA });
    expect(referidoDe("https://isuwaya.com/producto/x", "isuwaya.com")).toBeUndefined();
    expect(referidoDe("no es una url", "isuwaya.com")).toBeUndefined();
    expect(origenAGuardar(null, url(""), "", "isuwaya.com", AHORA)).toBeNull();
  });
  it("vence a los 30 días y rechaza basura", () => {
    expect(origenVigente({ fuente: "x", fecha: AHORA - 29 * 864e5 }, AHORA)).toEqual({ fuente: "x" });
    expect(origenVigente({ fuente: "x", fecha: AHORA - 31 * 864e5 }, AHORA)).toBeNull();
    expect(origenVigente("basura", AHORA)).toBeNull();
    expect(origenVigente({ fuente: "x" }, AHORA)).toBeNull();
    expect(origenVigente({ fuente: "<script>", fecha: AHORA, gclid: "valor" }, AHORA)).toEqual({ fuente: "script" });
  });
  it("el esquema es estricto", () => {
    expect(OrigenPedido.safeParse({ fuente: "instagram", gclid: true }).success).toBe(true);
    expect(OrigenPedido.safeParse({ fuente: "instagram", gclid: "valor" }).success).toBe(false);
    expect(OrigenPedido.safeParse({ fuente: "Ins ta" }).success).toBe(false);
    expect(OrigenPedido.safeParse({ fuente: "x", otro: 1 }).success).toBe(false);
    expect(OrigenPedido.safeParse({ fuente: "a".repeat(61) }).success).toBe(false);
  });
});
