import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { avanza, codigoProvincia, crearTransportes, estadoCabify, estadoDeTexto, estadoMercadoEnvios, ErrorTransporte, pdfSimple, telefonoWhatsapp, type Origen, type Paquete } from "./index.js";
import { leerXml } from "./http.js";
import { levantarSimulador, type Simulador } from "./simulador.js";

let sim: Simulador;
let t: ReturnType<typeof crearTransportes>;
const origen: Origen = { nombre: "Isuwaya", email: "isu.isuwaya@gmail.com", telefono: "1168515444", cuit: "30-00000000-0", calle: "Bacacay", numero: "3231", cp: "1406", localidad: "CABA", provincia: "CABA" };
const paquete: Paquete = { pesoGramos: 800, altoCm: 10, anchoCm: 30, largoCm: 40, valorDeclarado: 2_500_000 };
const destinatario = { nombre: "Ana", apellido: "Pérez", email: "ana@test.com", telefono: "11 5555-1234", dni: "30111222" };
const direccion = { calle: "Av. Siempreviva", numero: "742", cp: "1406", localidad: "CABA", provincia: "CABA", indicaciones: "Timbre 2" };

beforeAll(async () => {
  sim = await levantarSimulador();
  t = crearTransportes({ TRANSPORTES_SIMULADOR: sim.url, NODE_ENV: "test" });
});
afterAll(() => sim.cerrar());

describe("estados", () => {
  it.each([
    ["Entregado", "entregado"], ["ENTREGADO", "entregado"], ["No entregado - Ausente", "no_entregado"], ["Visita - Domicilio cerrado", "no_entregado"],
    ["En distribución", "en_reparto"], ["EN DISTRIBUCION", "en_reparto"], ["En sucursal de destino - Disponible para retirar", "en_sucursal"],
    ["Ingreso al circuito operativo", "en_camino"], ["EN TRANSITO", "en_camino"], ["Devuelto al remitente", "devuelto"], ["Pendiente de ingreso", "creado"],
    ["Envío anulado", "cancelado"],
  ])("%s → %s", (texto, estado) => expect(estadoDeTexto(texto)).toBe(estado));
  it("Mercado Envíos y Cabify", () => {
    expect(estadoMercadoEnvios("shipped", "out_for_delivery")).toBe("en_reparto");
    expect(estadoMercadoEnvios("shipped", "waiting_for_withdrawal")).toBe("en_sucursal");
    expect(estadoMercadoEnvios("not_delivered", "receiver_absent")).toBe("no_entregado");
    expect(estadoMercadoEnvios("delivered")).toBe("entregado");
    expect(estadoCabify("picked_up")).toBe("en_reparto");
    expect(estadoCabify("failed")).toBe("no_entregado");
  });
  it("no retrocede, pero después de una visita fallida puede volver a salir", () => {
    expect(avanza("en_reparto", "en_camino")).toBe(false);
    expect(avanza("entregado", "en_reparto")).toBe(false);
    expect(avanza("no_entregado", "en_reparto")).toBe(true);
    expect(avanza("creado", "en_camino")).toBe(true);
    expect(avanza("en_camino", "en_camino")).toBe(false);
  });
});

describe("datos argentinos", () => {
  it.each([
    ["11 5555-1234", "5491155551234"], ["011 15 5555-1234", "5491155551234"], ["+54 9 11 5555 1234", "5491155551234"],
    ["0351 15 555-1234", "5493515551234"], ["54 11 5555 1234", "5491155551234"], ["2215551234", "5492215551234"],
    ["1234", null], ["", null], ["0800 222 1234", null],
  ])("teléfono %s → %s", (tel, esperado) => expect(telefonoWhatsapp(tel)).toBe(esperado));
  it("provincias", () => {
    expect(codigoProvincia("Córdoba")).toBe("X");
    expect(codigoProvincia("CABA")).toBe("C");
    expect(codigoProvincia("Provincia de Buenos Aires")).toBe("B");
    expect(codigoProvincia("Tierra del Fuego")).toBe("V");
    expect(codigoProvincia("Narnia")).toBe("");
  });
  it("PDF simple válido", () => {
    const pdf = pdfSimple(["Hola", "Pedido ISU-1001 · ñandú"]).toString("latin1");
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
  });
  it("XML con DTD o entidades: rechazado (XXE)", () => {
    expect(() => leerXml('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>')).toThrow(ErrorTransporte);
  });
});

describe("configuración", () => {
  it("sin credenciales no hay ningún transporte", () => {
    const vacio = crearTransportes({});
    expect(Object.keys(vacio.adaptadores)).toEqual([]);
    expect(vacio.whatsapp).toBeNull();
  });
  it("el simulador nunca se usa en producción", () => {
    expect(Object.keys(crearTransportes({ TRANSPORTES_SIMULADOR: "http://x", NODE_ENV: "production" }).adaptadores)).toEqual([]);
  });
  it("con el simulador, los cinco y WhatsApp", () => {
    expect(Object.keys(t.adaptadores).sort()).toEqual(["andreani", "cabify", "correo_argentino", "mercado_envios", "oca"]);
    expect(t.whatsapp).not.toBeNull();
  });
});

describe.each(["andreani", "correo_argentino", "oca"] as const)("%s de punta a punta", (nombre) => {
  const a = () => t.adaptadores[nombre]!;
  it("cotiza domicilio y sucursal (el interior sale más caro)", async () => {
    const dom = await a().cotizar({ cp: "1406", provincia: "CABA" }, paquete, "domicilio", origen);
    const suc = await a().cotizar({ cp: "1406", provincia: "CABA" }, paquete, "sucursal", origen);
    const interior = await a().cotizar({ cp: "5000", provincia: "Córdoba" }, paquete, "domicilio", origen);
    expect(dom?.precio).toBeGreaterThan(0);
    expect(suc!.precio).toBeLessThan(dom!.precio);
    expect(interior!.precio).toBeGreaterThan(dom!.precio);
    expect(dom).toMatchObject({ transporte: nombre, servicio: "domicilio" });
  });
  it("sin cobertura → null", async () => {
    const r = await a().cotizar({ cp: "9999", provincia: "CABA" }, paquete, "domicilio", origen).catch((e) => e);
    expect(r === null || r instanceof ErrorTransporte).toBe(true);
  });
  it("lista sucursales", async () => {
    const s = await a().sucursales!("1406", "CABA");
    expect(s.length).toBeGreaterThan(0);
    expect(s[0]).toMatchObject({ id: expect.any(String), nombre: expect.any(String), direccion: expect.stringMatching(/\d/) });
  });
  it("crea el envío, da etiqueta (si el transporte la da) y sigue los estados", async () => {
    const e = await a().crearEnvio({ pedido: `ISU-${nombre}`, servicio: "domicilio", destinatario, direccion, paquete, origen });
    expect(e.seguimiento).toMatch(/^[A-Za-z0-9]{6,}$/);
    const etq = await a().etiqueta(e);
    if (nombre === "correo_argentino") expect(etq).toBeNull();
    else expect(etq!.subarray(0, 4).toString()).toBe("%PDF");
    expect((await a().seguimiento(e)).at(-1)?.estado).toBe("creado");
    sim.avanzar(e.seguimiento);
    expect((await a().seguimiento(e)).at(-1)?.estado).toBe("en_camino");
    sim.avanzar(e.seguimiento, "no_entregado");
    expect((await a().seguimiento(e)).at(-1)?.estado).toBe("no_entregado");
    sim.avanzar(e.seguimiento); sim.avanzar(e.seguimiento);
    expect((await a().seguimiento(e)).at(-1)?.estado).toBe("entregado");
    expect(a().urlSeguimiento(e.seguimiento)).toMatch(/^https:\/\//);
  });
  it("a sucursal pasa por \"disponible para retirar\"", async () => {
    const s = (await a().sucursales!("1406", "CABA"))[0]!;
    const e = await a().crearEnvio({ pedido: `ISU-S-${nombre}`, servicio: "sucursal", sucursal: s.id, destinatario, paquete, origen });
    sim.avanzar(e.seguimiento); sim.avanzar(e.seguimiento);
    expect((await a().seguimiento(e)).at(-1)?.estado).toBe("en_sucursal");
  });
});

describe("Andreani caído", () => {
  it("un 500 es un error reintentable; un 4xx no", async () => {
    const e = await t.adaptadores.andreani!.cotizar({ cp: "8888" }, paquete, "domicilio", origen).catch((x) => x);
    expect(e).toBeInstanceOf(ErrorTransporte);
    expect(e.reintentable).toBe(true);
    const n = await t.adaptadores.andreani!.cotizar({ cp: "9999" }, paquete, "domicilio", origen).catch((x) => x);
    expect(n.reintentable).toBe(false);
  });
});

describe("Mercado Envíos", () => {
  it("cotiza y arma la preferencia; el envío sale del pago", async () => {
    const me = t.mercadoEnvios!;
    expect((await me.cotizar({ cp: "1406" }, paquete, "domicilio", origen))?.precio).toBeGreaterThan(0);
    expect(await me.cotizar({ cp: "1406" }, paquete, "sucursal", origen)).toBeNull();
    expect(me.preferencia(paquete, "1406")).toEqual({ mode: "me2", dimensions: "10x30x40,800", local_pickup: false });
    const envio = await me.envioDePago("555");
    expect(envio).toEqual({ id: String(40_000_556), costo: 450_000 });
    const seg = { seguimiento: envio!.id, externoId: envio!.id };
    expect((await me.seguimiento(seg)).at(-1)?.estado).toBe("creado");
    sim.avanzar(envio!.id); sim.avanzar(envio!.id);
    expect((await me.seguimiento(seg)).at(-1)?.estado).toBe("en_reparto");
    expect((await me.etiqueta(seg))!.subarray(0, 4).toString()).toBe("%PDF");
    await expect(me.crearEnvio({} as never)).rejects.toThrow(/Mercado Pago/);
  });
});

describe("Cabify (en el día)", () => {
  it("cotiza sólo en el día, pide el cadete y sigue el viaje", async () => {
    const c = t.adaptadores.cabify!;
    expect(await c.cotizar({ cp: "1406" }, paquete, "domicilio", origen)).toBeNull();
    expect((await c.cotizar({ cp: "1406", provincia: "CABA", localidad: "CABA" }, paquete, "en_el_dia", origen))?.precio).toBe(350_000);
    const e = await c.crearEnvio({ pedido: "ISU-CAB", servicio: "en_el_dia", destinatario, direccion, paquete, origen });
    expect(await c.etiqueta(e)).toBeNull();
    sim.avanzar(e.seguimiento);
    expect((await c.seguimiento(e)).at(-1)?.estado).toBe("en_reparto");
    sim.avanzar(e.seguimiento); sim.avanzar(e.seguimiento);
    expect((await c.seguimiento(e)).at(-1)?.estado).toBe("entregado");
  });
});

describe("WhatsApp", () => {
  it("manda la plantilla al celular normalizado", async () => {
    const r = await t.whatsapp!.plantilla("011 15 5555-1234", "pedido_en_camino", ["Ana", "ISU-1001", "Andreani", "https://x"]);
    expect(r.id).toMatch(/^wamid\./);
    expect(sim.mensajes.at(-1)).toMatchObject({ para: "5491155551234", plantilla: "pedido_en_camino", parametros: ["Ana", "ISU-1001", "Andreani", "https://x"] });
  });
  it("un teléfono que no es celular argentino no se manda", async () => {
    await expect(t.whatsapp!.plantilla("1234", "pedido_en_camino", [])).rejects.toThrow(/celular/);
    await expect(t.whatsapp!.plantilla("1155551234", "Plantilla Rara!", [])).rejects.toThrow(/plantilla/);
  });
});
