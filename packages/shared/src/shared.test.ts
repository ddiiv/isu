import { describe, expect, it } from "vitest";
import { conDescuento, desdePesos, formatearPesos, formatearPesosExactos, fotosMaximasDelProducto, puedeAgregarFoto, centavos, porcentajePack, Packs, PACKS_POR_DEFECTO, leerPacks, cantidadesPack, maxPorcentajePack, rutaPack, leerRutaPack, nombreParaResena, Opiniones } from "./index.js";

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
  it("el monto a transferir no se redondea: los centavos identifican el pedido", () => {
    expect(formatearPesosExactos(1600037).replace(/\s/g, " ")).toBe("$ 16.000,37");
    expect(formatearPesosExactos(1600000).replace(/\s/g, " ")).toBe("$ 16.000");
    expect(formatearPesosExactos(1600001).replace(/\s/g, " ")).toBe("$ 16.000,01");
  });
  it("aplica descuento y redondea al peso hacia abajo", () => {
    expect(conDescuento(centavos(1127100), 25)).toBe(845300);
    expect(() => conDescuento(centavos(100), 120)).toThrow();
  });
});

describe("packs y reseñas (etapa 8)", () => {
  it("el % según las unidades, del mínimo al máximo (de fábrica, 2 a 10); con más del máximo, el del máximo", () => {
    const p = PACKS_POR_DEFECTO;
    expect(p).toEqual({ minimo: 2, maximo: 10, porcentajes: [10, 15, 18, 20, 21, 22, 23, 24, 25] });
    expect([0, 1, 2, 3, 5, 7, 10, 11, 30].map((n) => porcentajePack(p, n))).toEqual([0, 0, 10, 15, 20, 22, 25, 25, 25]);
    expect(porcentajePack(p, 2.5)).toBe(0);
    expect(cantidadesPack(p)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(maxPorcentajePack(p)).toBe(25);
    // Otro rango: de 3 a 4.
    const corto = { minimo: 3, maximo: 4, porcentajes: [12, 20] };
    expect([2, 3, 4, 9].map((n) => porcentajePack(corto, n))).toEqual([0, 12, 20, 20]);
  });
  it("el ajuste se valida: un % por cantidad, nunca menos llevando más, hasta 60%", () => {
    expect(Packs.safeParse({ minimo: 2, maximo: 5, porcentajes: [10, 15, 18, 20] }).success).toBe(true);
    for (const malo of [
      { minimo: 2, maximo: 5, porcentajes: [10, 5, 18, 20] }, { minimo: 2, maximo: 5, porcentajes: [10, 15, 18] },
      { minimo: 2, maximo: 5, porcentajes: [10, 15, 18, 61] }, { minimo: 5, maximo: 3, porcentajes: [10] },
      { minimo: 1, maximo: 3, porcentajes: [5, 10, 15] }, { minimo: 2, maximo: 21, porcentajes: Array(20).fill(10) },
      { minimo: 2, maximo: 3, porcentajes: [10, 15], extra: 1 }, [10, 15, 18, 20],
    ]) expect(Packs.safeParse(malo).success, JSON.stringify(malo)).toBe(false);
  });
  it("el formato viejo ([x2, x3, x4, x5]) se lee como de 2 a 5; uno roto, el de fábrica", () => {
    expect(leerPacks([10, 15, 18, 20])).toEqual({ minimo: 2, maximo: 5, porcentajes: [10, 15, 18, 20] });
    expect(leerPacks({ minimo: 2, maximo: 3, porcentajes: [5, 9] })).toEqual({ minimo: 2, maximo: 3, porcentajes: [5, 9] });
    for (const roto of [null, "x", [10, 5], { minimo: 2 }, [99, 100]]) expect(leerPacks(roto)).toEqual(PACKS_POR_DEFECTO);
  });
  it("la dirección del pack: pack-x2 a pack-x20 (la página la acota a lo que se ofrece)", () => {
    expect(rutaPack("remera-oversize", 3)).toBe("/producto/pack-x3-remera-oversize");
    expect(leerRutaPack("pack-x3-remera-oversize")).toEqual({ unidades: 3, slug: "remera-oversize" });
    expect(leerRutaPack("pack-x10-remera")).toEqual({ unidades: 10, slug: "remera" });
    for (const malo of ["pack-x1-remera", "pack-x0-remera", "pack-x21-remera", "pack-x02-remera", "pack-x100-remera", "pack-x3-", "pack-x3--a", "remera-oversize", "pack-x3-Remera"]) {
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
