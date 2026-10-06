import { describe, expect, it } from "vitest";
import { conDescuento, desdePesos, formatearPesos, fotosMaximasDelProducto, puedeAgregarFoto, centavos, porcentajePack, Packs, rutaPack, leerRutaPack, nombreParaResena, Opiniones } from "./index.js";

describe("fotos", () => {
  it("el tope del padre es 5 por color", () => {
    expect(fotosMaximasDelProducto(0)).toBe(0);
    expect(fotosMaximasDelProducto(3)).toBe(15);
    expect(() => fotosMaximasDelProducto(-1)).toThrow();
    expect(() => fotosMaximasDelProducto(1.5)).toThrow();
  });

  const colores = ["negro", "blanco"];
  const base = { porColor: { negro: 0, blanco: 0 }, exhibicion: 0, cantidadDeColores: 2 };

  it("hasta 5 de un color", () => {
    expect(puedeAgregarFoto({ ...base, porColor: { negro: 4, blanco: 0 } }, { tipo: "color", color: "negro" }, colores)).toBeNull();
    expect(puedeAgregarFoto({ ...base, porColor: { negro: 5, blanco: 0 } }, { tipo: "color", color: "negro" }, colores)).toBe("color_lleno");
  });

  it("las de exhibición entran en el cupo del padre", () => {
    const lleno = { porColor: { negro: 5, blanco: 2 }, exhibicion: 3, cantidadDeColores: 2 };
    expect(puedeAgregarFoto(lleno, { tipo: "exhibicion", color: null }, colores)).toBe("producto_lleno");
    expect(puedeAgregarFoto(lleno, { tipo: "color", color: "blanco" }, colores)).toBe("producto_lleno");
    const casi = { porColor: { negro: 5, blanco: 2 }, exhibicion: 2, cantidadDeColores: 2 };
    expect(puedeAgregarFoto(casi, { tipo: "exhibicion", color: "negro" }, colores)).toBeNull();
  });

  it("no acepta colores que el producto no tiene", () => {
    expect(puedeAgregarFoto(base, { tipo: "color", color: "rojo" }, colores)).toBe("color_inexistente");
    expect(puedeAgregarFoto(base, { tipo: "color", color: null }, colores)).toBe("color_inexistente");
    expect(puedeAgregarFoto({ ...base, cantidadDeColores: 0 }, { tipo: "exhibicion", color: null }, [])).toBe("sin_colores");
  });
});

describe("plata", () => {
  it("convierte pesos a centavos sin errores de coma flotante", () => {
    expect(desdePesos("12345.60")).toBe(1234560);
    expect(desdePesos(0.1 + 0.2)).toBe(30);
    expect(desdePesos("18000,5")).toBe(1800050);
    expect(() => desdePesos("abc")).toThrow();
  });
  it("formatea en pesos argentinos sin decimales", () => {
    expect(formatearPesos(1234500).replace(/\s/g, " ")).toBe("$ 12.345");
  });
  it("aplica descuento y redondea al peso hacia abajo", () => {
    expect(conDescuento(centavos(1127100), 25)).toBe(845300);
    expect(() => conDescuento(centavos(100), 120)).toThrow();
  });
});

describe("packs y reseñas (etapa 8)", () => {
  it("el % según las unidades, con tope en 5", () => {
    const p = [10, 15, 18, 20];
    expect([0, 1, 2, 3, 4, 5, 6, 12].map((n) => porcentajePack(p, n))).toEqual([0, 0, 10, 15, 18, 20, 20, 20]);
    expect(porcentajePack(p, 2.5)).toBe(0);
    expect(Packs.safeParse([10, 15, 18, 20]).success).toBe(true);
    expect(Packs.safeParse([10, 5, 18, 20]).success).toBe(false);
    expect(Packs.safeParse([10, 15, 18]).success).toBe(false);
    expect(Packs.safeParse([10, 15, 18, 61]).success).toBe(false);
  });
  it("la dirección del pack: pack-x2 a pack-x5", () => {
    expect(rutaPack("remera-oversize", 3)).toBe("/producto/pack-x3-remera-oversize");
    expect(leerRutaPack("pack-x3-remera-oversize")).toEqual({ unidades: 3, slug: "remera-oversize" });
    for (const malo of ["pack-x1-remera", "pack-x6-remera", "pack-x3-", "pack-x3--a", "remera-oversize", "pack-x3-Remera", "pack-x10-remera"]) {
      expect(leerRutaPack(malo), malo).toBeNull();
    }
  });
  it("el nombre de quien opina: nombre e inicial", () => {
    expect(nombreParaResena("ana maría", "García")).toBe("Ana G.");
    expect(nombreParaResena("  JUAN ", "pérez")).toBe("Juan P.");
    expect(nombreParaResena("Lu", "")).toBe("Lu");
  });
  it("las opiniones: una por prenda, el calce sólo en prendas, texto limpio", () => {
    const ok = Opiniones.parse({ resenas: [{ productoId: 1, estrellas: 5, texto: "  Hermosa\r\n\n\n\nla tela  ", calce: "justo" }, { productoId: null, estrellas: 4, texto: "   " }] });
    expect(ok.resenas[0]).toEqual({ productoId: 1, estrellas: 5, texto: "Hermosa\n\nla tela", calce: "justo" });
    expect(ok.resenas[1]).toEqual({ productoId: null, estrellas: 4, texto: null, calce: null });
    expect(Opiniones.safeParse({ resenas: [{ productoId: 1, estrellas: 5 }, { productoId: 1, estrellas: 3 }] }).success).toBe(false);
    expect(Opiniones.safeParse({ resenas: [{ productoId: null, estrellas: 5, calce: "chico" }] }).success).toBe(false);
    expect(Opiniones.safeParse({ resenas: [{ productoId: 1, estrellas: 0 }] }).success).toBe(false);
    expect(Opiniones.safeParse({ resenas: [{ productoId: 1, estrellas: 5, texto: "x".repeat(1001) }] }).success).toBe(false);
    expect(Opiniones.safeParse({ resenas: [{ productoId: 1, estrellas: 5, extra: 1 }] }).success).toBe(false);
  });
});
