import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { strToU8, zipSync } from "fflate";
import { escribirXlsx, leerXlsx, nombreDeHoja } from "../src/lib/xlsx.js";
import { guiasAHojas, hojasAGuias, leerValor, tipoDeTalles } from "../src/modulos/admin/guias-excel.js";

describe("Excel (etapa 10)", () => {
  it("lee el archivo de guías de la fábrica: 40 guías, sin errores", () => {
    const { guias, errores } = hojasAGuias(leerXlsx(readFileSync(new URL("./fixtures/guias-fabrica.xlsx", import.meta.url))));
    expect(errores).toEqual([]);
    expect(guias).toHaveLength(40);
    const remera = guias.find((g) => g.nombre === "Remera Clasica")!;
    expect(remera).toMatchObject({ tipo: "adulto", medidas: ["Ancho hombro", "Ancho Pecho", "Largo Prenda", "Largo manga"] });
    expect(remera.filas.map((f) => f.talle)).toEqual(["S", "M", "L", "XL", "2XL"]);
    expect(remera.filas[0]!.valores).toEqual([[44.5, 44.5], [54, 54], [71, 71], [26.5, 26.5]]);
    // Talles de pantalón (1 a 6) y "3 (L)": talles propios.
    expect(guias.find((g) => g.nombre === "Pantalon Microfibra")!.filas.map((f) => f.talle)).toEqual(["1", "2", "3 (L)", "4 (XL)", "5 (XXL)", "6 (3XL)"]);
    expect(guias.find((g) => g.nombre === "Pantalon Microfibra")!.tipo).toBe("otro");
    // "-" es que no aplica; "Edad (aprox)" con "4 años" es la edad del sistema.
    expect(guias.find((g) => g.nombre === "Musculosa")!.filas[0]!.valores[3]).toBeNull();
    const nena = guias.find((g) => g.nombre === "Pantalon Chupin Nena")!;
    expect(nena.tipo).toBe("nino");
    expect(nena.medidas.at(-1)).toBe("edad");
    expect(nena.filas[0]!.valores.at(-1)).toEqual([4, 4]);
  });

  it("exportar e importar devuelve lo mismo", () => {
    const original = hojasAGuias(leerXlsx(readFileSync(new URL("./fixtures/guias-fabrica.xlsx", import.meta.url)))).guias;
    const vuelta = hojasAGuias(leerXlsx(escribirXlsx(guiasAHojas(original)))).guias;
    expect(vuelta.map((g) => [g.nombre, g.tipo, g.medidas, g.filas.map((f) => f.valores)])).toEqual(
      original.map((g) => [g.nombre, g.tipo, g.medidas, g.filas.map((f) => f.valores)]));
  });

  it("valores: número, coma, rango, «-» y lo que no se entiende", () => {
    expect([leerValor(44), leerValor("44,5"), leerValor("44-46"), leerValor("44 a 46 cm"), leerValor("4 años"), leerValor("-"), leerValor("")]).toEqual(
      [[44, 44], [44.5, 44.5], [44, 46], [44, 46], [4, 4], null, null]);
    expect([leerValor("abc"), leerValor("46-44"), leerValor(999), leerValor("=A1")]).toEqual([undefined, undefined, undefined, undefined]);
    expect([tipoDeTalles(["s", "M", "2xl"]), tipoDeTalles(["4", "6", "16"]), tipoDeTalles(["1", "2"]), tipoDeTalles(["2", "XL"])]).toEqual(["adulto", "nino", "otro", "otro"]);
  });

  it("una hoja mal armada se informa y no se importa; las demás sí", () => {
    const { guias, errores } = hojasAGuias([
      { nombre: "Buena", filas: [["Medida", "S", "M"], ["Pecho", 50, 52]] },
      { nombre: "Sin talles", filas: [["Medida"], ["Pecho", 50]] },
      { nombre: "Valor raro", filas: [["Medida", "S"], ["Pecho", "cincuenta"]] },
      { nombre: "Talle repetido", filas: [["Medida", "S", "s"], ["Pecho", 50, 52]] },
      { nombre: "Vacía", filas: [] },
      { nombre: "Sin nombre de medida", filas: [["Medida", "S"], [null, 50]] },
      { nombre: "<script>", filas: [["Medida", "S"], ["<img src=x onerror=alert(1)>", 50]] },
    ]);
    expect(guias.map((g) => g.nombre)).toEqual(["Buena"]);
    expect(errores.map((e) => e.hoja)).toEqual(["Sin talles", "Valor raro", "Talle repetido", "Sin nombre de medida", "<script>"]);
  });

  it("archivos que no son Excel, gigantes o que se inflan: error claro, sin colgarse", () => {
    expect(() => leerXlsx(strToU8("no soy un zip"))).toThrow(/no es un archivo de excel/i);
    expect(() => leerXlsx(new Uint8Array(6 * 1024 * 1024))).toThrow(/5 MB/);
    // Una hoja que descomprimida pesa 30 MB (comprimida, unos KB).
    const bomba = zipSync({ "xl/workbook.xml": strToU8("<workbook/>"), "xl/worksheets/sheet1.xml": new Uint8Array(30 * 1024 * 1024) }, { level: 9 });
    expect(bomba.length).toBeLessThan(1024 * 1024);
    expect(() => leerXlsx(bomba)).toThrow(/demasiado grande/);
  });

  it("nombres de hoja válidos para Excel", () => {
    const usados = new Set<string>();
    expect(nombreDeHoja("Remera: clásica/2024 [nueva]", usados)).toBe("Remera clásica 2024 nueva");
    expect(nombreDeHoja("x".repeat(40), usados)).toHaveLength(31);
    expect(nombreDeHoja("Remera clásica 2024 nueva", usados)).toBe("Remera clásica 2024 nueva 2");
  });
});
