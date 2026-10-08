import { describe, expect, it } from "vitest";
import { BANNERS_SUGERIDOS, BannerPublico, BotonBanner, conVariables, RutaTienda, VARIABLES_BANNER } from "./index.js";

/* Etapa 12: banners interactivos. */
describe("variables de los textos", () => {
  const vars = { descuento: "20", cuotas: "3", envioGratis: "$ 80.000", packsHasta: "25", packsMinimo: "2", packsMaximo: "10" };
  it("pone los valores de Ajustes", () => {
    expect(conVariables("{descuento}% OFF y {cuotas} cuotas", vars)).toBe("20% OFF y 3 cuotas");
    expect(conVariables("Envío gratis desde {envioGratis}", vars)).toBe("Envío gratis desde $ 80.000");
    expect(conVariables(null, vars)).toBeNull();
    expect(conVariables("Sin variables", {})).toBe("Sin variables");
  });
  it("si una no tiene valor hoy, el texto no sirve (undefined: el banner no sale)", () => {
    expect(conVariables("Envío gratis desde {envioGratis}", { descuento: "20" })).toBeUndefined();
    expect(conVariables("{descuento}% OFF", { descuento: "" })).toBeUndefined();
  });
  it("una desconocida queda tal cual (la API la rechaza al guardar)", () => {
    expect(conVariables("{descuentos}% OFF", vars)).toBe("{descuentos}% OFF");
  });
});

describe("links de los banners: sólo páginas de esta tienda", () => {
  it("acepta direcciones de la tienda", () => {
    for (const r of ["/", "/packs", "/mujer/remeras", "/producto/remera-lisa", "/buscar?q=lino"]) expect(RutaTienda.safeParse(r).success, r).toBe(true);
  });
  it("rechaza otros sitios y trucos", () => {
    for (const r of ["https://evil.com", "//evil.com", "/\\evil.com", "\\\\evil.com", "javascript:alert(1)", "packs", "/ con espacio", "", `/${"a".repeat(300)}`]) {
      expect(RutaTienda.safeParse(r).success, r).toBe(false);
    }
  });
  it("un botón: texto, link y estilo (relleno por defecto)", () => {
    expect(BotonBanner.parse({ texto: " Ver packs ", enlace: "/packs" })).toEqual({ texto: "Ver packs", enlace: "/packs", estilo: "lleno" });
    expect(BotonBanner.safeParse({ texto: "", enlace: "/packs" }).success).toBe(false);
    expect(BotonBanner.safeParse({ texto: "x".repeat(31), enlace: "/packs" }).success).toBe(false);
    expect(BotonBanner.safeParse({ texto: "Ir", enlace: "/packs", onclick: "x" }).success).toBe(false);
  });
});

describe("banners sugeridos", () => {
  it("usan sólo variables que existen y links de la tienda", () => {
    for (const s of BANNERS_SUGERIDOS) {
      const textos = [s.alt, s.titulo, s.texto, s.etiqueta ?? "", ...s.botones.map((b) => b.texto)].join(" ");
      for (const m of textos.matchAll(/\{(\w+)\}/g)) expect(Object.keys(VARIABLES_BANNER), s.sugerido).toContain(m[1]);
      for (const b of s.botones) expect(BotonBanner.safeParse(b).success, `${s.sugerido}: ${b.enlace}`).toBe(true);
      expect(s.titulo.length).toBeLessThanOrEqual(90);
      expect(s.texto.length).toBeLessThanOrEqual(220);
    }
    expect(new Set(BANNERS_SUGERIDOS.map((s) => s.sugerido)).size).toBe(BANNERS_SUGERIDOS.length);
  });
  it("un banner viejo (etapa 8, sólo foto) sigue leyéndose", () => {
    const b = BannerPublico.parse({ id: 1, alt: "Packs", enlace: "/packs", foto: { clave: "b/1/abcdef0123456789", ancho: 1800, alto: 700 }, fotoMovil: null });
    expect(b).toMatchObject({ titulo: null, botones: [], fondo: "marca", alineacion: "izquierda", producto: null });
  });
});
