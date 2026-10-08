import { describe, expect, it } from "vitest";
import { aSlug, normalizar, hexDeColor, esClaro, proponerCategorias, generosDe, compararTalles, urlFoto, CLAVE_FOTO } from "./index.js";

describe("texto", () => {
  it("normaliza tildes, eñes y espacios", () => {
    expect(normalizar("  Remera   BÁSICA Ñandú ")).toBe("remera basica nandu");
  });
  it("arma slugs seguros", () => {
    expect(aSlug("Remera Oversize 100% algodón!!")).toBe("remera-oversize-100-algodon");
    expect(aSlug("<script>alert(1)</script>")).toBe("script-alert-1-script");
    expect(aSlug("---")).toBe("");
    expect(aSlug("a".repeat(100)).length).toBe(80);
    expect(aSlug("abc def ghi", 5)).toBe("abc-d");
    expect(aSlug("abcd efgh", 5)).toBe("abcd");
  });
});

describe("colores", () => {
  it("reconoce los nombres comunes, con o sin tilde", () => {
    expect(hexDeColor("Negro")).toBe("#111111");
    expect(hexDeColor("VERDE MILITAR")).toBe("#4b5320");
    expect(hexDeColor("Marrón")).toBe(hexDeColor("marron"));
  });
  it("en combinados toma el primero", () => {
    expect(hexDeColor("Blanco/Negro")).toBe("#ffffff");
    expect(hexDeColor("Gris y rosa")).toBe("#8a8a8a");
  });
  it("lo desconocido queda sin hex", () => {
    expect(hexDeColor("Estampado galaxia")).toBeNull();
    expect(hexDeColor(null)).toBeNull();
    expect(hexDeColor("constructor")).toBeNull();
    expect(hexDeColor("__proto__")).toBeNull();
  });
  it("sabe si un color es claro", () => {
    expect(esClaro("#ffffff")).toBe(true);
    expect(esClaro("#111111")).toBe(false);
    expect(esClaro("rojo")).toBe(false);
  });
});

describe("categorías", () => {
  it("género explícito", () => {
    expect(proponerCategorias("Remeras", "Mujer", "Remera básica")).toEqual([["mujer", "remeras-y-tops"]]);
    expect(proponerCategorias("Pantalones", "Hombre", "Jogger")).toEqual([["hombre", "pantalones"]]);
  });
  it("unisex va a hombre y a mujer", () => {
    expect(proponerCategorias("Buzos", "Unisex", "Buzo canguro")).toEqual([
      ["hombre", "buzos-y-camperas"], ["mujer", "buzos-y-camperas"],
    ]);
  });
  it("sin género en Stocker, lo busca en el título", () => {
    expect(generosDe(null, "Calza deportiva mujer")).toEqual(["mujer"]);
    expect(proponerCategorias(null, null, "Short de baño niño")).toEqual([["ninos", "shorts"]]);
    // Como vienen del mayorista: "Nena" / "Nene" también son de niños.
    expect(proponerCategorias("Shorts", "Nena", "Mara Short Nena")).toEqual([["ninos", "shorts"]]);
    expect(proponerCategorias(null, null, "Letra Short nene con letra")).toEqual([["ninos", "shorts"]]);
  });
  it("sin tipo reconocible queda en la categoría de arriba", () => {
    expect(proponerCategorias("Accesorios", "Hombre", "Gorra")).toEqual([["hombre", null]]);
  });
  it("sin género, nada", () => {
    expect(proponerCategorias("Remeras", null, "Remera lisa")).toEqual([]);
  });
});

describe("talles y fotos", () => {
  it("ordena talles de letra, número y únicos", () => {
    expect(["XL", "S", "10", "M", "Único", "2", "XS"].sort(compararTalles)).toEqual(["2", "10", "XS", "S", "M", "XL", "Único"]);
  });
  it("arma la URL de una foto", () => {
    expect(urlFoto("https://f.isuwaya.com/", "p/12/abcd1234", 800)).toBe("https://f.isuwaya.com/p/12/abcd1234-800.webp");
  });
  it("valida las claves", () => {
    expect(CLAVE_FOTO.test("p/12/abcd1234")).toBe(true);
    expect(CLAVE_FOTO.test("p/12/../../etc/passwd")).toBe(false);
    expect(CLAVE_FOTO.test("p/12/ABCD1234")).toBe(false);
    // Etapa 12: sin el id del producto (una carpeta al azar).
    expect(CLAVE_FOTO.test("p/3f9a0c1b2d4e/abcd1234ef567890")).toBe(true);
    expect(CLAVE_FOTO.test("p/3f9a0c1b2d4X/abcd1234")).toBe(false);
    expect(CLAVE_FOTO.test("p/3f9a0c1b2d/abcd1234")).toBe(false);
  });
});
