import { describe, expect, it } from "vitest";
import { conDescuento, desdePesos, formatearPesos, fotosMaximasDelProducto, puedeAgregarFoto, centavos } from "./index.js";

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
