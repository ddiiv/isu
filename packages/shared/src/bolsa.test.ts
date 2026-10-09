import { describe, expect, it } from "vitest";
import { armarBolsa, BOLSAS_DE_FABRICA, leerPaqueteEnvios, PAQUETE_DE_FABRICA, PaqueteEnvios } from "./envios.js";

const remera = { pesoGramos: 200, altoCm: 2, anchoCm: 25, largoCm: 30 };
const buzo = { pesoGramos: 600, altoCm: 6, anchoCm: 30, largoCm: 35 };

describe("todo el pedido en una bolsa", () => {
  it("una remera va en la bolsa chica, con su peso más el de la bolsa", () => {
    const b = armarBolsa([{ ...remera, cantidad: 1 }], BOLSAS_DE_FABRICA);
    expect(b).toEqual({ pesoGramos: 215, altoCm: 2, anchoCm: 25, largoCm: 30, prendas: 1, bolsa: "Chica", entra: true });
  });

  it("varias prendas se apilan en la misma bolsa: suma el peso y el grosor", () => {
    const b = armarBolsa([{ ...remera, cantidad: 2 }, { ...buzo, cantidad: 1 }], BOLSAS_DE_FABRICA);
    expect(b.prendas).toBe(3);
    expect(b.pesoGramos).toBe(2 * 200 + 600 + 25);
    expect(b.altoCm).toBe(10);
    expect([b.anchoCm, b.largoCm]).toEqual([30, 35]);
    expect(b.bolsa).toBe("Mediana");
    expect(b.entra).toBe(true);
  });

  it("si la pila queda muy alta para la bolsa, la reparte en dos pilas una al lado de la otra", () => {
    expect(armarBolsa([{ ...remera, cantidad: 10 }], BOLSAS_DE_FABRICA)).toMatchObject({ altoCm: 20, anchoCm: 25, largoCm: 30, bolsa: "Grande", entra: true });
    // 20 remeras de 2 cm: dos pilas de 20 cm, una al lado de la otra (30 × 50).
    expect(armarBolsa([{ ...remera, cantidad: 20 }], BOLSAS_DE_FABRICA)).toMatchObject({ altoCm: 20, anchoCm: 30, largoCm: 50, bolsa: "Extra grande", entra: true });
  });

  it("gira la prenda si hace falta (ancho y largo dan lo mismo)", () => {
    const a = armarBolsa([{ pesoGramos: 300, altoCm: 2, anchoCm: 30, largoCm: 22, cantidad: 1 }], BOLSAS_DE_FABRICA);
    expect([a.anchoCm, a.largoCm]).toEqual([22, 30]);
    expect(a.bolsa).toBe("Chica");
  });

  it("si no entra en ninguna, usa la más grande y lo avisa", () => {
    const b = armarBolsa([{ ...buzo, cantidad: 40 }], BOLSAS_DE_FABRICA);
    expect(b.bolsa).toBe("Extra grande");
    expect(b.entra).toBe(false);
    expect(b.pesoGramos).toBe(40 * 600 + 60);
  });

  it("elige la bolsa más chica aunque estén cargadas en otro orden", () => {
    const desordenadas = [...BOLSAS_DE_FABRICA].reverse();
    expect(armarBolsa([{ ...remera, cantidad: 1 }], desordenadas).bolsa).toBe("Chica");
  });

  it("los ajustes viejos (cajas por cantidad de prendas) se leen como bolsas", () => {
    const viejo = { pesoPrendaGramos: 400, pesoCajaGramos: 150, cajas: [{ hastaPrendas: 99, altoCm: 20, anchoCm: 30, largoCm: 40 }] };
    expect(leerPaqueteEnvios(viejo)).toEqual({ prendaPorDefecto: { ...PAQUETE_DE_FABRICA.prendaPorDefecto, pesoGramos: 400 }, bolsas: BOLSAS_DE_FABRICA });
    expect(leerPaqueteEnvios(PAQUETE_DE_FABRICA)).toEqual(PAQUETE_DE_FABRICA);
    expect(leerPaqueteEnvios({ algo: 1 })).toBeNull();
  });

  it("no acepta bolsas o prendas imposibles", () => {
    expect(PaqueteEnvios.safeParse({ ...PAQUETE_DE_FABRICA, bolsas: [] }).success).toBe(false);
    expect(PaqueteEnvios.safeParse({ ...PAQUETE_DE_FABRICA, prendaPorDefecto: { ...remera, pesoGramos: 0 } }).success).toBe(false);
    expect(PaqueteEnvios.safeParse({ ...PAQUETE_DE_FABRICA, bolsas: [{ nombre: "X", anchoCm: 5, largoCm: 30, pesoGramos: 10 }] }).success).toBe(false);
  });
});
