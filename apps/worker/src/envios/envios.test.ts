import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { crearPool, migrar } from "@isu/db";
import { crearTransportes, firmaOpinarValida, firmaSeguimientoValida } from "@isu/envios";
import { levantarSimulador, type Simulador } from "@isu/envios/simulador";
import { crearEnvios, type Envios } from "./envios.js";

/*
 * Etapa 4 en el worker: el despacho que avisa Stocker, el seguimiento de
 * los transportes (simulador de @isu/envios) y los avisos al cliente sin
 * duplicados.
 */
const DB = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:5433/stocker_test";
const SECRETO = "s".repeat(40);
const pool = crearPool({ url: DB, max: 4 });
let sim: Simulador;
let envios: Envios;
const cola: Array<{ cola: string; nombre: string; datos: Record<string, unknown>; id: string }> = [];
const ids = new Set<string>();
// Como BullMQ: el mismo jobId no se encola dos veces.
const encolar = (c: string) => async (nombre: string, datos: Record<string, unknown>, id: string) => { if (!ids.has(id)) { ids.add(id); cola.push({ cola: c, nombre, datos, id }); } };
const enStocker = new Map<string, string | null>();

async function pedido(n: string, extra: Record<string, unknown> = {}) {
  const c = {
    entrega: "envio", transporte: "andreani", servicio_envio: "domicilio", estado: "pagado", avisos_whatsapp: true, telefono: "11 5555-1234",
    medio_pago: "transferencia", sucursal_envio: null, ...extra,
  } as Record<string, unknown>;
  const { rows } = await pool.query(
    `INSERT INTO tienda.pedidos (acceso_hash, email, nombre, apellido, telefono, dni, entrega, direccion, local_retiro, medio_pago, subtotal, total, estado,
                                 transporte, servicio_envio, sucursal_envio, avisos_whatsapp, pagado_en)
     VALUES (repeat('a', 64), $1, 'Ana María', 'Envío', $2, '30111222', $3, $4, $5, $6, 1000000, 1000000, $7, $8, $9, $10, $11, now() - interval '1 hour')
     RETURNING id, numero`,
    [`qa-wenv-${n}@test.com`, c.telefono, c.entrega, c.entrega === "envio" ? JSON.stringify({ calle: "Bacacay", numero: "3231", cp: "1406", localidad: "Flores", provincia: "CABA" }) : null,
      c.entrega === "retiro" ? "Local Flores" : null, c.medio_pago, c.estado, c.entrega === "envio" ? c.transporte : null, c.entrega === "envio" ? c.servicio_envio : null,
      c.sucursal_envio ? JSON.stringify(c.sucursal_envio) : null, c.avisos_whatsapp]);
  return rows[0] as { id: number; numero: string };
}
/** Un pedido con su envío creado en el simulador (como lo deja "Preparar" del backoffice). */
async function conEnvio(n: string, extra: Record<string, unknown> = {}) {
  const p = await pedido(n, extra);
  const t = crearTransportes({ NODE_ENV: "test", TRANSPORTES_SIMULADOR: sim.url });
  const creado = await t.adaptadores.andreani!.crearEnvio({
    pedido: p.numero, servicio: (extra.servicio_envio as "sucursal") ?? "domicilio",
    destinatario: { nombre: "Ana", apellido: "Envío", email: "a@b.c", telefono: "1155551234", dni: "30111222" },
    direccion: { calle: "Bacacay", numero: "3231", cp: "1406", localidad: "Flores", provincia: "CABA" }, sucursal: extra.servicio_envio === "sucursal" ? "an14061" : null,
    paquete: { pesoGramos: 1000, altoCm: 8, anchoCm: 25, largoCm: 30, valorDeclarado: 1000000 },
    origen: { nombre: "Isuwaya", calle: "Bacacay", numero: "3231", cp: "1406", localidad: "Flores", provincia: "CABA", email: "i@i.com", telefono: "1168515444", cuit: "" },
  });
  // El simulador numera desde el mismo valor en cada corrida: un envío que dejó otra prueba en la misma base (las de navegador) choca.
  await pool.query("DELETE FROM tienda.envios WHERE seguimiento = $1", [creado.seguimiento]);
  const e = await pool.query("INSERT INTO tienda.envios (pedido_id, transporte, servicio, seguimiento) VALUES ($1, 'andreani', $2, $3) RETURNING id",
    [p.id, extra.servicio_envio ?? "domicilio", creado.seguimiento]);
  return { ...p, envioId: e.rows[0].id as number, seguimiento: creado.seguimiento! };
}
const avisos = async (pedidoId: number) => (await pool.query("SELECT tipo, canal FROM tienda.avisos WHERE pedido_id = $1 ORDER BY id", [pedidoId])).rows.map((r) => `${r.tipo}:${r.canal}`);
const estado = async (pedidoId: number) => (await pool.query("SELECT estado FROM tienda.pedidos WHERE id = $1", [pedidoId])).rows[0].estado;
const limpiar = () => pool.query("DELETE FROM tienda.pedidos WHERE email LIKE 'qa-wenv%'");

beforeAll(async () => {
  await migrar(pool);
  await limpiar();
  sim = await levantarSimulador();
  envios = crearEnvios({
    pool,
    transportes: crearTransportes({ NODE_ENV: "test", TRANSPORTES_SIMULADOR: sim.url, MP_API_URL: `${sim.url}/mp` }),
    encolar: encolar("notificaciones"),
    encolarStocker: encolar("stocker"),
    sitio: "https://www.isuwaya.test",
    secreto: SECRETO,
    estadoEnStocker: async (n) => (enStocker.has(n) ? { estado: "aceptado", despachadoEn: enStocker.get(n) ?? null } : null),
    log: { warn: () => {} },
  });
});
afterAll(async () => {
  await limpiar();
  await pool.query("UPDATE tienda.ajustes SET valor = 'true' WHERE clave = 'avisosWhatsapp'");
  await sim.cerrar();
  await pool.end();
});
beforeEach(() => { cola.length = 0; });

describe("despacho desde Stocker", () => {
  it("el pedido pasa a enviado, el envío queda en camino y se avisa por mail y WhatsApp con el enlace firmado", async () => {
    const p = await conEnvio("d1");
    expect((await envios.despachado(p.numero, "despachado")).cambio).toBe(true);
    expect(await estado(p.id)).toBe("enviado");
    const e = (await pool.query("SELECT estado, despachado_en FROM tienda.envios WHERE id = $1", [p.envioId])).rows[0];
    expect(e.estado).toBe("en_camino");
    expect(e.despachado_en).not.toBeNull();
    expect(await avisos(p.id)).toEqual(["en_camino:email", "en_camino:whatsapp"]);
    const mail = cola.find((c) => c.nombre === "email")!;
    expect(mail.datos.plantilla).toBe("envio_en_camino");
    const d = mail.datos.datos as { nombre: string; seguimiento: string; enlace: string; transporte: string };
    expect(d.nombre).toBe("Ana");
    expect(d.seguimiento).toBe(p.seguimiento);
    expect(d.transporte).toBe("Andreani");
    const t = new URL(d.enlace).searchParams.get("t")!;
    expect(firmaSeguimientoValida(p.numero, t, SECRETO)).toBe(true);
    const wa = cola.find((c) => c.nombre === "whatsapp")!;
    expect(wa.datos).toMatchObject({ telefono: "5491155551234", plantilla: "pedido_en_camino" });
    expect((wa.datos.parametros as string[]).slice(0, 3)).toEqual(["Ana", p.numero, "Andreani"]);
  });
  it("el mismo aviso dos veces (NOTIFY + repaso) no cambia nada ni avisa de nuevo", async () => {
    const p = await conEnvio("d2");
    await envios.despachado(p.numero, "despachado");
    cola.length = 0;
    expect((await envios.despachado(p.numero, "despachado")).cambio).toBe(false);
    expect(cola).toHaveLength(0);
    expect(await avisos(p.id)).toHaveLength(2);
  });
  it("sin el tilde de WhatsApp, o con WhatsApp apagado en Ajustes, sólo mail", async () => {
    const a = await conEnvio("d3", { avisos_whatsapp: false });
    await envios.despachado(a.numero, "despachado");
    expect(await avisos(a.id)).toEqual(["en_camino:email"]);
    await pool.query("UPDATE tienda.ajustes SET valor = 'false' WHERE clave = 'avisosWhatsapp'");
    const b = await conEnvio("d4");
    await envios.despachado(b.numero, "despachado");
    expect(await avisos(b.id)).toEqual(["en_camino:email"]);
    await pool.query("UPDATE tienda.ajustes SET valor = 'true' WHERE clave = 'avisosWhatsapp'");
  });
  it("un teléfono que no es celular argentino no manda WhatsApp", async () => {
    const p = await conEnvio("d5", { telefono: "0800 333 4444" });
    await envios.despachado(p.numero, "despachado");
    expect(await avisos(p.id)).toEqual(["en_camino:email"]);
  });
  it("en el día: el aviso es 'llega hoy'", async () => {
    const p = await pedido("d6", { transporte: "cabify", servicio_envio: "en_el_dia" });
    await envios.despachado(p.numero, "despachado");
    expect(await avisos(p.id)).toEqual(["llega_hoy:email", "llega_hoy:whatsapp"]);
  });
  it("retiro en el local: queda retirado", async () => {
    const p = await pedido("d7", { entrega: "retiro" });
    await envios.despachado(p.numero, "despachado");
    expect(await estado(p.id)).toBe("retirado");
  });
  it("faltante: queda anotado para que lo vea una persona, sin cambiar el estado", async () => {
    const p = await conEnvio("d8");
    await envios.despachado(p.numero, "faltante");
    expect(await estado(p.id)).toBe("pagado");
    const ev = await pool.query("SELECT detalle FROM tienda.pedido_eventos WHERE pedido_id = $1", [p.id]);
    expect(ev.rows.at(-1).detalle).toMatch(/falta mercadería/);
  });
  it("un pedido cancelado no se marca enviado", async () => {
    const p = await conEnvio("d9", { estado: "cancelado" });
    expect((await envios.despachado(p.numero, "despachado")).cambio).toBe(false);
    expect(await estado(p.id)).toBe("cancelado");
  });
  it("repaso: si se perdió el aviso, lo encuentra preguntándole a Stocker", async () => {
    const p = await conEnvio("d10");
    enStocker.set(p.numero, new Date().toISOString());
    const r = await envios.revisarDespachos(500);
    expect(r.despachados).toBeGreaterThanOrEqual(1);
    expect(await estado(p.id)).toBe("enviado");
  });
});

describe("seguimiento", () => {
  it("guarda los eventos nuevos una sola vez y avanza hasta entregado (avisa y cierra el pedido)", async () => {
    const p = await conEnvio("s1");
    await envios.despachado(p.numero, "despachado");
    for (let i = 0; i < 10; i++) sim.avanzar(p.seguimiento);
    await envios.seguir(p.envioId);
    const again = await envios.seguir(p.envioId);
    expect(again).toEqual({ eventos: 0 }); // entregado: ya no pregunta
    const e = (await pool.query("SELECT estado, entregado_en FROM tienda.envios WHERE id = $1", [p.envioId])).rows[0];
    expect(e.estado).toBe("entregado");
    expect(e.entregado_en).not.toBeNull();
    expect(await estado(p.id)).toBe("entregado");
    expect(await avisos(p.id)).toContain("entregado:email");
    const n = (await pool.query("SELECT count(*)::int AS n, count(DISTINCT (fecha, descripcion))::int AS d FROM tienda.envio_eventos WHERE envio_id = $1", [p.envioId])).rows[0];
    expect(n.n).toBe(n.d);
    expect(n.n).toBeGreaterThan(1);
  });
  it("a sucursal: avisa que ya se puede retirar", async () => {
    const p = await conEnvio("s2", { servicio_envio: "sucursal", sucursal_envio: { id: "an14061", nombre: "Sucursal Flores", direccion: "Rivadavia 1150" } });
    await envios.despachado(p.numero, "despachado");
    sim.avanzar(p.seguimiento, "en_sucursal");
    await envios.seguir(p.envioId);
    expect(await avisos(p.id)).toContain("en_sucursal:whatsapp");
    const wa = cola.filter((c) => c.nombre === "whatsapp").at(-1)!;
    expect((wa.datos.parametros as string[])[2]).toContain("Sucursal Flores");
  });
  it("visita fallida: avisa 'no entregado'", async () => {
    const p = await conEnvio("s3");
    await envios.despachado(p.numero, "despachado");
    sim.avanzar(p.seguimiento);
    sim.avanzar(p.seguimiento, "no_entregado");
    await envios.seguir(p.envioId);
    expect(await avisos(p.id)).toContain("no_entregado:email");
  });
  it("antes del despacho no se avisa nada aunque el transporte ya lo tenga", async () => {
    const p = await conEnvio("s4");
    sim.avanzar(p.seguimiento);
    sim.avanzar(p.seguimiento);
    await envios.seguir(p.envioId);
    expect(await avisos(p.id)).toEqual([]);
    expect((await pool.query("SELECT estado FROM tienda.envios WHERE id = $1", [p.envioId])).rows[0].estado).toBe("creado");
  });
  it("si el transporte falla: cuenta el error y espera más para volver a preguntar", async () => {
    const p = await pedido("s5");
    const e = await pool.query("INSERT INTO tienda.envios (pedido_id, transporte, servicio, seguimiento, despachado_en) VALUES ($1, 'andreani', 'domicilio', '360009999999', now()) RETURNING id", [p.id]);
    await expect(envios.seguir(e.rows[0].id)).rejects.toThrow();
    const f = (await pool.query("SELECT errores_seguidos, ultimo_error, proximo_chequeo > now() + interval '10 minutes' AS espera FROM tienda.envios WHERE id = $1", [e.rows[0].id])).rows[0];
    expect(f.errores_seguidos).toBe(1);
    expect(f.ultimo_error).toBeTruthy();
    expect(f.espera).toBe(true);
  });
  it("Correo Argentino sin el número del rótulo (MiCorreo): no se pregunta; con el número, sí", async () => {
    const p = await pedido("s7", { transporte: "correo_argentino" });
    const e = await pool.query(
      "INSERT INTO tienda.envios (pedido_id, transporte, servicio, seguimiento, externo_id, despachado_en, proximo_chequeo) VALUES ($1, 'correo_argentino', 'domicilio', NULL, 'x', now(), now() - interval '1 minute') RETURNING id", [p.id]);
    const id = e.rows[0].id as number;
    expect(await envios.seguir(id)).toEqual({ eventos: 0, motivo: "sin_numero" });
    await envios.seguirPendientes(500);
    // No lo tomó la vuelta periódica (no movió su próximo chequeo) ni le sumó errores.
    const f = (await pool.query("SELECT proximo_chequeo < now() AS pendiente, errores_seguidos FROM tienda.envios WHERE id = $1", [id])).rows[0];
    expect(f).toEqual({ pendiente: true, errores_seguidos: 0 });
    await pool.query("UPDATE tienda.envios SET activo = false WHERE id = $1", [id]);
  });
  it("la vuelta periódica toma los que tocan (y los reserva para que otra réplica no los repita)", async () => {
    const p = await conEnvio("s6");
    await envios.despachado(p.numero, "despachado");
    await pool.query("UPDATE tienda.envios SET proximo_chequeo = now() - interval '1 minute' WHERE id = $1", [p.envioId]);
    const [a, b] = await Promise.all([envios.seguirPendientes(500), envios.seguirPendientes(500)]);
    expect(a.revisados + b.revisados).toBeGreaterThanOrEqual(1);
    const tomados = (await pool.query("SELECT proximo_chequeo > now() AS futuro FROM tienda.envios WHERE id = $1", [p.envioId])).rows[0];
    expect(tomados.futuro).toBe(true);
  });
});

describe("Mercado Envíos", () => {
  it("trae el envío que creó Mercado Pago y le pasa el número a Stocker", async () => {
    const p = await pedido("m1", { transporte: "mercado_envios", medio_pago: "mercadopago" });
    const r = await envios.mercadoEnvios(p.numero, "123456");
    expect(r.seguimiento).toBeTruthy();
    const e = (await pool.query("SELECT transporte, seguimiento FROM tienda.envios WHERE pedido_id = $1 AND activo", [p.id])).rows[0];
    expect(e.transporte).toBe("mercado_envios");
    expect((await pool.query("SELECT envio_mercado_pago FROM tienda.pedidos WHERE id = $1", [p.id])).rows[0].envio_mercado_pago).toBe(450000);
    expect(cola.find((c) => c.cola === "stocker")!.datos).toEqual({ numero: p.numero, tipo: "mercado_envios", seguimiento: e.seguimiento });
    // Dos veces: no duplica.
    await envios.mercadoEnvios(p.numero, "123456");
    expect((await pool.query("SELECT count(*)::int AS n FROM tienda.envios WHERE pedido_id = $1", [p.id])).rows[0].n).toBe(1);
  });
  it("a un pedido que no es de Mercado Envíos no le hace nada", async () => {
    const p = await pedido("m2");
    expect(await envios.mercadoEnvios(p.numero, "1")).toEqual({ motivo: "no_corresponde" });
  });
});

describe("pedir la opinión (etapa 8)", () => {
  it("unos días después de entregado, un mail por pedido con el enlace firmado; lo viejo o lo no entregado no", async () => {
    const hace = async (estado: string, dias: number | null) => {
      const p = await pedido(`res-${estado}-${dias}`, { entrega: "retiro", estado });
      if (dias !== null) await pool.query("UPDATE tienda.pedidos SET cerrado_en = now() - make_interval(days => $2) WHERE id = $1", [p.id, dias]);
      return p;
    };
    const listo = await hace("retirado", 5);
    const reciente = await hace("retirado", 1);
    const viejo = await hace("retirado", 60);
    const sinCerrar = await hace("pagado", null);
    await pool.query("INSERT INTO tienda.pedido_items (pedido_id, sku, nombre, precio, cantidad) VALUES ($1, 'X', 'Remera Oversize', 1000000, 1)", [listo.id]);
    const r = await envios.pedirResenas();
    const mails = cola.filter((c) => c.datos.plantilla === "pedir_resena");
    const mio = mails.filter((m) => m.datos.para === `qa-wenv-res-retirado-5@test.com`);
    expect(mio.length).toBe(1);
    expect(r.pedidos).toBeGreaterThanOrEqual(1);
    const d = mio[0]!.datos.datos as { enlace: string; estrellas: Array<{ estrellas: number; enlace: string }>; nombre: string };
    expect(d.nombre).toBe("Ana");
    const u = new URL(d.enlace);
    expect(u.origin + u.pathname).toBe(`https://www.isuwaya.test/opinar/${listo.numero}`);
    expect(firmaOpinarValida(listo.numero, u.searchParams.get("t")!, SECRETO)).toBe(true);
    // La firma del seguimiento no sirve para opinar (otro propósito, otra clave).
    expect(firmaSeguimientoValida(listo.numero, u.searchParams.get("t")!, SECRETO)).toBe(false);
    expect(d.estrellas.map((e) => new URL(e.enlace).searchParams.get("e"))).toEqual(["5", "4", "3", "2", "1"]);
    const marcados = await pool.query("SELECT id FROM tienda.pedidos WHERE id = ANY($1::int[]) AND resena_pedida_en IS NOT NULL", [[listo.id, reciente.id, viejo.id, sinCerrar.id]]);
    expect(marcados.rows.map((x) => x.id)).toEqual([listo.id]);
    // Otra pasada no lo manda de nuevo.
    cola.length = 0;
    await envios.pedirResenas();
    expect(cola.filter((c) => c.datos.para === `qa-wenv-res-retirado-5@test.com`)).toEqual([]);
  });
});
