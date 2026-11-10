import { describe, expect, it } from "vitest";
import { conDescuento, desdePesos, formatearPesos, formatearPesosExactos, fotosMaximasDelProducto, puedeAgregarFoto, centavos, porcentajePack, Packs, PACKS_POR_DEFECTO, leerPacks, cantidadesPack, maxPorcentajePack, rutaPack, leerRutaPack, nombreParaResena, Opiniones, EnlaceLocal, normalizarEnlace, enlaceDeLocal, Local, EnvioMoto, ENVIO_MOTO_DE_FABRICA, ID_OPCION, cpEnRangos, provinciasDelCP, NOMBRES_PROVINCIAS } from "./index.js";

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

describe("link de los locales", () => {
  it("sólo https: Google Maps sí; javascript:, data:, http y cosas que no son links, no", () => {
    for (const ok of ["https://maps.app.goo.gl/AbC123xyz", "https://www.google.com/maps/place/Bacacay+3231", "https://instagram.com/isuwaya", "  https://goo.gl/maps/xyz  "]) {
      expect(EnlaceLocal.safeParse(ok).success, ok).toBe(true);
    }
    for (const malo of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "http://maps.google.com", "ftp://x.com/a", "https://", "https://localhost", "maps.app.goo.gl/x", "no es un link", `https://x.com/${"a".repeat(600)}`]) {
      expect(EnlaceLocal.safeParse(malo).success, malo).toBe(false);
    }
  });
  it("lo que se pega en Ajustes queda como link con https://", () => {
    expect(normalizarEnlace("maps.app.goo.gl/AbC")).toBe("https://maps.app.goo.gl/AbC");
    expect(normalizarEnlace("http://maps.google.com/x")).toBe("https://maps.google.com/x");
    expect(normalizarEnlace("  https://x.com  ")).toBe("https://x.com");
    expect(normalizarEnlace("")).toBe("");
    // Un esquema raro no se "arregla": queda para que la validación lo rechace.
    expect(normalizarEnlace("javascript:alert(1)")).toBe("javascript:alert(1)");
  });
  it("el link de un local por su nombre (el pedido guarda el nombre)", () => {
    const locales = [{ nombre: "Flores", mapa: "https://maps.app.goo.gl/Flores1" }, { nombre: "Salada", mapa: null }, { nombre: "Viejo", mapa: "javascript:alert(1)" }];
    expect(enlaceDeLocal(locales, "Flores")).toBe("https://maps.app.goo.gl/Flores1");
    expect(enlaceDeLocal(locales, "Salada")).toBeNull();
    expect(enlaceDeLocal(locales, "Viejo")).toBeNull();
    expect(enlaceDeLocal(locales, "Otro")).toBeNull();
    expect(enlaceDeLocal(locales, null)).toBeNull();
    expect(Local.safeParse({ nombre: "A", direccion: "B", localidad: "C", horario: "D", mapa: "javascript:alert(1)", retiro: true }).success).toBe(false);
  });
});

describe("envío en moto", () => {
  const ok = ENVIO_MOTO_DE_FABRICA;
  it("los valores de fábrica son válidos y ninguna zona pisa a otra", () => {
    expect(EnvioMoto.safeParse(ok).success).toBe(true);
    for (let cp = 1000; cp <= 6712; cp++) expect(ok.zonas.filter((z) => cpEnRangos(String(cp), z.cps)).length, String(cp)).toBeLessThanOrEqual(1);
    expect(ok.zonas.map((z) => z.nombre)).toEqual(["CABA", "Primer cordón", "Segundo cordón", "Tercer cordón", "Pilar, Luján y La Plata"]);
  });
  it("rechaza lo que no cierra: hora, días, precio, rangos, tope de zonas y campos de más", () => {
    const malo = (x: object) => EnvioMoto.safeParse({ ...ok, ...x }).success;
    expect(malo({ horaCorte: "25:00" })).toBe(false);
    expect(malo({ dias: [7] })).toBe(false);
    expect(malo({ zonas: [{ nombre: "A", precio: -1, cps: "1000" }] })).toBe(false);
    expect(malo({ zonas: [{ nombre: "A", precio: 1.5, cps: "1000" }] })).toBe(false);
    expect(malo({ zonas: [{ nombre: "A", precio: 0, cps: "mil" }] })).toBe(false);
    expect(malo({ zonas: [{ nombre: "A".repeat(61), precio: 0, cps: "1000" }] })).toBe(false);
    expect(malo({ zonas: [{ nombre: "A", precio: 0, cps: "1000", extra: 1 }] })).toBe(false);
    expect(malo({ zonas: Array.from({ length: 11 }, () => ({ nombre: "A", precio: 0, cps: "1000" })) })).toBe(false);
    expect(malo({ zonas: Array.from({ length: 10 }, () => ({ nombre: "A", precio: 0, cps: "" })) })).toBe(true);
    expect(malo({ otro: 1 })).toBe(false);
  });
  it("moto es una opción de envío válida, sin adaptador", () => {
    expect(ID_OPCION.test("moto:en_el_dia")).toBe(true);
    expect(ID_OPCION.test("moto:domicilio")).toBe(true);
    expect(ID_OPCION.test("drone:domicilio")).toBe(false);
  });
});

describe("código postal → provincia", () => {
  it("una provincia, en los bordes de sus rangos", () => {
    expect(provinciasDelCP("1000")).toEqual(["CABA"]);
    expect(provinciasDelCP("1499")).toEqual(["CABA"]);
    expect(provinciasDelCP("1704")).toEqual(["Buenos Aires"]);
    expect(provinciasDelCP("1600")).toEqual(["Buenos Aires"]);
    expect(provinciasDelCP("1999")).toEqual(["Buenos Aires"]);
    expect(provinciasDelCP("5000")).toEqual(["Córdoba"]);
    expect(provinciasDelCP("4000")).toEqual(["Tucumán"]);
    expect(provinciasDelCP("9410")).toEqual(["Tierra del Fuego"]);
    expect(provinciasDelCP("8000")).toEqual(["Buenos Aires"]);
  });
  it("el CPA completo vale como los 4 números; con espacios, también", () => {
    expect(provinciasDelCP("B1704ABC")).toEqual(["Buenos Aires"]);
    expect(provinciasDelCP("c1043aaz")).toEqual(["CABA"]);
    expect(provinciasDelCP(" 1704 ")).toEqual(["Buenos Aires"]);
  });
  it("donde dos provincias comparten rango, devuelve las dos", () => {
    expect(provinciasDelCP("2000")).toEqual(["Santa Fe"]);
    expect(provinciasDelCP("2800")).toEqual(["Buenos Aires", "Santa Fe"]);
    expect(provinciasDelCP("2850")).toEqual(["Buenos Aires", "Entre Ríos", "Santa Fe"]);
    expect(provinciasDelCP("8300")).toEqual(["Neuquén", "Río Negro"]);
    expect(provinciasDelCP("6300")).toEqual(["Buenos Aires", "La Pampa"]);
    expect(provinciasDelCP("3200")).toEqual(["Corrientes", "Entre Ríos"]);
  });
  it("un código que no existe, o mal escrito, no es de ninguna", () => {
    expect(provinciasDelCP("1500")).toEqual([]);
    expect(provinciasDelCP("0999")).toEqual([]);
    expect(provinciasDelCP("9999")).toEqual([]);
    expect(provinciasDelCP("170")).toEqual([]);
    expect(provinciasDelCP("17044")).toEqual([]);
    expect(provinciasDelCP("")).toEqual([]);
  });
  it("las provincias de la tabla son las del select del checkout, y todas tienen rango", () => {
    const usadas = new Set<string>();
    for (let n = 1000; n <= 9499; n++) provinciasDelCP(String(n)).forEach((p) => usadas.add(p));
    expect([...usadas].sort()).toEqual([...NOMBRES_PROVINCIAS].sort());
  });
});
