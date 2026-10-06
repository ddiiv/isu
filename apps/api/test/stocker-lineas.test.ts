import { describe, expect, it } from "vitest";
import { paraStocker } from "../src/modulos/pedidos/servicio.js";

describe("líneas para Stocker (etapa 10)", () => {
  it("la misma variante suelta y en un pack va en una sola línea, con el precio promedio y el total exacto", () => {
    const lineas = [
      { sku: "A", clave: "A", cantidad: 1, precio: 1_000_000 },
      { sku: "A", clave: "pack:A*2,B*1|A", cantidad: 2, precio: 850_000 },
      { sku: "B", clave: "pack:A*2,B*1|B", cantidad: 1, precio: 935_000 },
    ];
    // El cupón repartido baja lo cobrado de la suelta.
    const cobrado = new Map([["A", 900_000], ["pack:A*2,B*1|A", 850_000], ["pack:A*2,B*1|B", 935_000]]);
    const r = paraStocker({ lineas, cobrado });
    expect(r).toEqual([
      { sku: "A", cantidad: 3, precioUnitario: Math.round((900_000 + 2 * 850_000) / 3) / 100 },
      { sku: "B", cantidad: 1, precioUnitario: 9350 },
    ]);
    // Al centavo: la diferencia con lo cobrado de verdad es menor a un centavo por unidad.
    expect(Math.abs(r[0]!.precioUnitario * 100 * 3 - (900_000 + 2 * 850_000))).toBeLessThan(3);
  });
});
