import { describe, expect, it } from "vitest";
import { aplicarCupon, elegir, type Cupon, type LineaParaCupon } from "../src/lib/cupones.js";

/*
 * Promos de Navidad (0033), sin base: «2da unidad al 50%», el 10% de más de $120.000 y la regla de que NUNCA se suman a la
 * rebaja de la prenda: en cada prenda rige el mejor precio para el cliente. Todo en centavos.
 */
const cupon = (c: Partial<Cupon>): Cupon => ({
  id: 1, codigo: null, nombre: "QA", automatico: true, tipo: "porcentaje", valor: 10, alcance: "todo", categorias: new Set(), productos: new Set(),
  sobreRebajas: true, acumula: false, clienteId: null, minimo: 0, tope: null, escala: [], maxMayorista: 5, desde: null, hasta: null, usosMax: null, usosPorCliente: null, usos: 0, activo: true, ...c,
});
const segunda = (c: Partial<Cupon> = {}) => cupon({ id: 2, nombre: "2da unidad al 50%", tipo: "segunda_unidad", valor: 50, ...c });
const diez = (c: Partial<Cupon> = {}) => cupon({ id: 3, nombre: "10% OFF más de $120.000", tipo: "porcentaje", valor: 10, minimo: 12_000_100, ...c });

/** Una línea del carrito: `lista` es el precio sin rebaja; `precio` el que ya paga (con la rebaja de la prenda, si tiene). */
const linea = (sku: string, lista: number, mayorista: number | null, cantidad = 1, rebajaPct = 0): LineaParaCupon => {
  const precio = Math.floor((lista * (100 - rebajaPct)) / 100 / 100) * 100;
  return { sku, productoId: 1, precio: mayorista !== null && precio < mayorista ? mayorista : precio, lista, mayorista, rebajada: rebajaPct > 0, cantidad };
};
const M = (n = 1, rebaja = 0) => linea("M", 1_000_000, 600_000, n, rebaja);     // $10.000, mayorista $6.000 (margen $4.000)
const L = (n = 1, rebaja = 0) => linea("L", 1_200_000, 700_000, n, rebaja);     // $12.000, mayorista $7.000
const S = (n = 1, rebaja = 0) => linea("S", 800_000, 500_000, n, rebaja);       // $8.000, mayorista $5.000 (margen $3.000)
const SIN = (n = 1) => linea("SIN", 900_000, null, n);                          // sin mayorista cargado
const total = (ls: LineaParaCupon[]) => ls.reduce((t, l) => t + l.precio * l.cantidad, 0);
const aplicar = (c: Cupon, ls: LineaParaCupon[]) => aplicarCupon(c, ls, total(ls), new Map());
const descuento = (c: Cupon, ls: LineaParaCupon[]) => { const r = aplicar(c, ls); return "cupon" in r ? r.descuento : r.error; };

describe("2da unidad al 50%", () => {
  it("entre cualquier prenda: de a pares, de la más cara a la más barata; la más barata de cada par lleva el %", () => {
    // M + S: la S es la más barata; 50% de $8.000 son $4.000 pero el piso deja $3.000.
    expect(descuento(segunda(), [M(), S()])).toBe(300_000);
    // L + M + S: se arma el par (L, M); la S queda sola. 50% de $10.000 son $5.000 y el piso deja $4.000.
    expect(descuento(segunda(), [L(), M(), S()])).toBe(400_000);
    // 2 M + 2 S: pares (M, M) y (S, S): $4.000 + $3.000.
    expect(descuento(segunda(), [M(2), S(2)])).toBe(700_000);
    // La misma prenda dos veces también vale (cualquier prenda, no sólo distintas).
    expect(descuento(segunda(), [M(2)])).toBe(400_000);
  });

  it("una sola prenda, o una impar, no completa el par: la última queda sin descuento", () => {
    expect(descuento(segunda(), [M()])).toBe("Sumá otra prenda y la 2da unidad va al 50% OFF.");
    // 3 M: un par ($4.000) y una suelta. El descuento se reparte por unidad al peso hacia abajo ($1.333 x 3): $1 menos, nunca de más.
    expect(descuento(segunda(), [M(3)])).toBe(399_900);
  });

  it("nunca baja una prenda del mayorista, y sin mayorista cargado no recibe descuento (aunque sea la más barata)", () => {
    // El 50% de $9.000 serían $4.500, pero sin mayorista no se puede verificar el piso.
    expect(descuento(segunda(), [L(), SIN()])).toBe("Este cupón no descuenta nada en este carrito.");
    expect(descuento(segunda(), [SIN(2)])).toBe("Este cupón no aplica a estas prendas.");
    // La que no tiene mayorista puede ser la «cara» del par: la otra sí recibe.
    expect(descuento(segunda(), [SIN(), S()])).toBe(300_000);
  });

  it("el porcentaje es configurable (por ejemplo, 2da unidad al 30%)", () => {
    // 30% de $10.000 = $3.000, bajo el piso de $4.000.
    expect(descuento(segunda({ valor: 30 }), [M(2)])).toBe(300_000);
  });
});

describe("solo el mejor descuento: nunca se suma a la rebaja de la prenda", () => {
  it("2da unidad sobre una prenda con rebaja: se compara contra el precio de lista y sólo cuenta lo que mejora la rebaja", () => {
    // 2 M con 25% de Navidad: $7.500 cada una (piso $6.000). El 50% sobre lista serían $5.000, pero el piso la deja en $6.000:
    // la 2da baja de $7.500 a $6.000, es decir $1.500. NO se aplica 50% sobre $7.500 ($3.750) ni sobre lista más 25%.
    const ls = [M(2, 25)];
    expect(ls[0]!.precio).toBe(750_000);
    expect(descuento(segunda(), ls)).toBe(150_000);
  });

  it("si la rebaja ya es mejor que la promoción en esa prenda, la promoción no descuenta nada", () => {
    // S con 25%: $6.000 (piso $5.000). El 10% sobre lista da $7.200: peor que $6.000, no se suma ni se aplica.
    const ls = [S(25, 25)];
    expect(ls[0]!.precio).toBe(600_000);
    expect(descuento(diez(), ls)).toBe("Tus prendas ya tienen un descuento mejor que esta promoción (no se suman).");
  });

  it("con la regla vieja (acumula) el mismo cupón sí se sumaba: la diferencia es exactamente esa", () => {
    const ls = [S(25, 25)];
    // acumula = true: 10% sobre $6.000 = $600 por prenda; el piso deja $1.000.
    expect(descuento(diez({ acumula: true }), ls)).toBe(25 * 60_000);
  });

  it("carrito mezclado: sólo descuenta la prenda a la que el % le mejora el precio", () => {
    // 10 S sin rebaja ($8.000) + 20 M con 25% ($7.500): el 10% mejora a las S ($7.200) y no a las M ($9.000 > $7.500).
    const ls = [S(10), M(20, 25)];
    const r = aplicar(diez(), ls);
    expect("cupon" in r && r.descuento).toBe(10 * 80_000);
    expect("cupon" in r && r.porUnidad.get("M")).toBe(0);
  });

  it("el piso mayorista sigue valiendo: el % no deja ninguna prenda por debajo", () => {
    // 90% sobre lista dejaría la S en $800, bajo el mayorista de $5.000: sólo descuenta el margen ($3.000).
    expect(descuento(diez({ valor: 90, minimo: 0 }), [S(2)])).toBe(600_000);
  });
});

describe("10% en compras de más de $120.000", () => {
  it("«más de» $120.000: con exactamente $120.000 no aplica, con $120.001 sí", () => {
    const justo = [linea("X", 12_000_000, 6_000_000, 1)];
    expect(descuento(diez(), justo)).toMatch(/compras desde/);
    const pasado = [linea("X", 12_000_100, 6_000_000, 1)];
    const d = descuento(diez(), pasado) as number;
    expect(d).toBeGreaterThan(1_200_000);
    expect(d).toBeLessThan(1_201_000);
  });

  it("el mínimo se mira sobre el total ya rebajado: la rebaja de Navidad puede dejar el carrito debajo", () => {
    // 20 S sin rebaja = $160.000; con 25% de rebaja = $120.000 ($6.000 c/u): ya no «más de $120.000».
    expect(typeof descuento(diez(), [S(20)])).toBe("number");
    const rebajadas = [S(20, 25)];
    expect(total(rebajadas)).toBe(12_000_000);
    expect(descuento(diez(), rebajadas)).toMatch(/compras desde/);
  });
});

describe("elegir: uno solo por compra, el que más le descuenta al cliente", () => {
  it("entre las dos promos de Navidad gana la de mayor descuento (no se suman)", () => {
    // 8 M ($80.000): 2da unidad = 4 pares x $4.000 = $16.000; el 10% no llega al mínimo. Gana la 2da unidad.
    const chico = [M(5), L(1), S(2)];
    const a = elegir(null, [diez(), segunda()], chico, total(chico), new Map(), 0);
    expect(a.aplicado?.cupon.id).toBe(2);
    // Un carrito grande de prendas sin rebaja: 20 S + 20 M = $360.000; 10% = $36.000 contra 20 pares: 10 x $3.000 + 10 x $4.000 = $70.000.
    // Gana la 2da unidad otra vez, y de todos modos nunca se aplican las dos.
    const grande = [S(20), M(20)];
    const b = elegir(null, [diez(), segunda()], grande, total(grande), new Map(), 0);
    expect(b.aplicado?.descuento).toBe(7_000_000);
    expect(b.aplicado?.cupon.id).toBe(2);
    // Una sola prenda cara ($130.000, piso $10.000): no hay par, así que gana el 10%.
    const una = [linea("C", 13_000_000, 1_000_000, 1)];
    const c = elegir(null, [diez(), segunda()], una, total(una), new Map(), 0);
    expect([c.aplicado?.cupon.id, c.aplicado?.descuento]).toEqual([3, 1_300_000]);
  });

  it("un cupón escrito que descuenta menos que la promo automática se reemplaza por ella, avisando", () => {
    const ls = [M(2)];
    const escrito = cupon({ id: 9, codigo: "QA5", automatico: false, valor: 5, acumula: true });
    const r = elegir(escrito, [segunda()], ls, total(ls), new Map(), 0);
    expect(r.aplicado?.cupon.id).toBe(2);
    expect(r.error).toMatch(/te descuenta más que el cupón/);
  });
});
