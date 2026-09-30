import { describe, expect, it } from "vitest";
import { GuiaTalles, familiaDeColor, combinan, guiaPublica, normalizarTalle, parteDe, recomendarTalle } from "./index.js";

const remera = GuiaTalles.parse({
  nombre: "Remera regular", tipo: "adulto", medidas: ["pecho", "largo"],
  filas: [
    { talle: "M", valores: [[92, 97], [72, 72]] },
    { talle: "s", valores: [[87, 92], [70, 70]] },
    { talle: "L", valores: [[97, 102], [74, 74]] },
  ],
});

describe("guías de talles", () => {
  it("normaliza nombres de talle", () => {
    expect(normalizarTalle("Talle 2xl")).toBe("XXL");
    expect(normalizarTalle(" t. xl ")).toBe("XL");
    expect(normalizarTalle("06")).toBe("6");
    expect(normalizarTalle("xxxl")).toBe("3XL");
  });
  it("ordena las filas por la escala", () => {
    expect(guiaPublica(remera).filas.map((f) => f.talle)).toEqual(["S", "M", "L"]);
  });
  it("rechaza talles que no son del tipo, repetidos o filas incompletas", () => {
    const base = { nombre: "x x", tipo: "nino", medidas: ["altura"], filas: [{ talle: "M", valores: [[1, 2]] }] };
    expect(GuiaTalles.safeParse(base).success).toBe(false);
    expect(GuiaTalles.safeParse({ ...base, filas: [{ talle: "4", valores: [[100, 110]] }, { talle: "04", valores: [[100, 110]] }] }).success).toBe(false);
    expect(GuiaTalles.safeParse({ ...base, filas: [{ talle: "4", valores: [] }] }).success).toBe(false);
    expect(GuiaTalles.safeParse({ ...base, filas: [{ talle: "4", valores: [[110, 100]] }] }).success).toBe(false);
    expect(GuiaTalles.safeParse({ ...base, filas: [{ talle: "16", valores: [[160, 170]] }] }).success).toBe(true);
  });
  it("recomienda por medidas del cuerpo (en el límite, el más grande)", () => {
    const g = guiaPublica(remera);
    expect(recomendarTalle(g, { pecho: 94 })).toEqual({ talle: "M", exacto: true, motivo: "ok" });
    expect(recomendarTalle(g, { pecho: 92 }).talle).toBe("M");
    expect(recomendarTalle(g, { pecho: 103 }).talle).toBe("L");
    expect(recomendarTalle(g, { pecho: 120 }).motivo).toBe("grande");
    expect(recomendarTalle(g, { pecho: 70 }).motivo).toBe("chico");
    expect(recomendarTalle(g, { cintura: 80 }).motivo).toBe("sin_medidas");
  });
});

describe("outfits", () => {
  it("deduce la parte del outfit", () => {
    expect(parteDe("Remeras", "Remera Oversize")).toBe("arriba");
    expect(parteDe("Buzo canguro", "x")).toBe("abrigo");
    expect(parteDe(null, "Jogger Frisa")).toBe("abajo");
    expect(parteDe("Accesorios", "Gorra")).toBe(null);
  });
  it("agrupa colores en familias", () => {
    expect(familiaDeColor("#111111")).toBe("neutros");
    expect(familiaDeColor("#ffffff")).toBe("neutros");
    expect(familiaDeColor("#1b2440")).toBe("neutros"); // azul marino
    expect(familiaDeColor("#d8c3a5")).toBe("neutros"); // beige
    expect(familiaDeColor("#c62828")).toBe("rojos");
    expect(familiaDeColor("#2e7d4f")).toBe("verdes");
    expect(familiaDeColor("#2a4fb8")).toBe("azules");
    expect(familiaDeColor("#f2a7bd")).toBe("rosas");
    expect(familiaDeColor("#6b4226")).toBe("tierra");
    expect(familiaDeColor(null)).toBe("neutros");
  });
  it("combina a lo sumo una familia de color", () => {
    expect(combinan(["neutros", "rojos"])).toBe(true);
    expect(combinan(["rojos", "rojos", "neutros"])).toBe(true);
    expect(combinan(["rojos", "verdes"])).toBe(false);
  });
});
