import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { crearPool, migrar } from "@isu/db";
import { CLAVE_CURSOR_NOVEDADES } from "@isu/shared";
import { ErrorStocker, type CambioPedido, type ClienteStocker, type CobroStocker, type Resoluciones } from "./cliente.js";
import { crearCobros } from "./cobros.js";
import { crearNovedades } from "./novedades.js";

/*
 * Tanda 2 del contrato v1 de Stocker en el worker: los cobros (con su
 * confirmación y el barrido) y el feed de novedades (despachado, falta
 * mercadería, cancelado) con el cursor guardado en la base.
 */
const DB = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:5433/stocker_test";
const pool = crearPool({ url: DB, max: 4 });
const silencio = { warn: () => {} };

async function pedido(estado: string, extra: { medio?: string } = {}) {
  const { rows } = await pool.query<{ id: number; numero: string }>(
    `INSERT INTO tienda.pedidos (acceso_hash, email, nombre, apellido, telefono, dni, entrega, local_retiro, medio_pago, subtotal, total, estado, vence_en)
     VALUES (repeat('b', 64), 'qa-wped@test.com', 'Ana', 'Pedidos', '1', '2', 'retiro', 'Flores', $1, 3600000, 3600000, $2, now() + interval '2 days')
     RETURNING id, numero`, [extra.medio ?? "transferencia", estado]);
  return rows[0]!;
}
const pago = async (pedidoId: number, externo: string, extra: { estado?: string; hace?: string; monto?: number } = {}) =>
  (await pool.query<{ id: number }>(
    `INSERT INTO tienda.pagos (pedido_id, proveedor, externo, estado, monto, creado_en) VALUES ($1, 'transferencia', $2, $3, $4, now() - $5::interval) RETURNING id`,
    [pedidoId, externo, extra.estado ?? "aprobado", extra.monto ?? 3_600_050, extra.hace ?? "0 seconds"])).rows[0]!.id;
const eventos = async (pedidoId: number) =>
  (await pool.query<{ detalle: string }>("SELECT detalle FROM tienda.pedido_eventos WHERE pedido_id = $1 AND actor = 'stocker' ORDER BY id", [pedidoId])).rows.map((r) => r.detalle);
const cursor = async () => (await pool.query("SELECT valor FROM tienda.ajustes WHERE clave = $1", [CLAVE_CURSOR_NOVEDADES])).rows[0]?.valor ?? null;
const ponerCursor = (c: string | null) => c === null
  ? pool.query("DELETE FROM tienda.ajustes WHERE clave = $1", [CLAVE_CURSOR_NOVEDADES])
  : pool.query("INSERT INTO tienda.ajustes (clave, valor) VALUES ($1, $2) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor", [CLAVE_CURSOR_NOVEDADES, JSON.stringify(c)]);
const limpiar = async () => {
  await pool.query("DELETE FROM tienda.pedidos WHERE email = 'qa-wped@test.com'");
  await ponerCursor(null);
};

/* Un Stocker de mentira: sólo lo que usan cobros y novedades. */
function stockerFalso() {
  const cobros: CobroStocker[] = [];
  const paginas = new Map<string | null, Resoluciones>();
  const preguntas: Array<string | null> = [];
  let respuestaCobro: (c: CobroStocker) => Promise<{ aplicado: boolean; motivo: string | null }> = async () => ({ aplicado: true, motivo: null });
  const cliente = {
    async registrarCobro(c: CobroStocker) {
      const r = await respuestaCobro(c);
      cobros.push(c);
      return { movimientoExterno: `${c.numero}-C${c.cobro}`, pedidoExterno: c.numero, ...r, pagoEstado: "pagado", cobrado: c.importe, repetido: false };
    },
    async resoluciones(desde: string | null) {
      preguntas.push(desde);
      const p = paginas.get(desde);
      if (!p) return { cursor: desde ?? "c:inicio", cambios: [], hayMas: false };
      return p;
    },
  } as unknown as ClienteStocker;
  return { cliente, cobros, paginas, preguntas, alCobrar: (f: typeof respuestaCobro) => { respuestaCobro = f; } };
}
const cambio = (pedidoExterno: string, c: Partial<CambioPedido>): CambioPedido => ({
  pedidoExterno, cambio: "aceptado", estado: "aceptado", estadoEnvio: null, pagoEstado: null, seguimiento: null, envioTipo: null,
  despachadoEn: null, canceladoEn: null, motivo: null, en: new Date().toISOString(), ...c,
});

beforeAll(async () => { await migrar(pool); });
beforeEach(limpiar);
afterAll(async () => { await limpiar(); await pool.end(); });

describe("cobros a Stocker", () => {
  it("cada pago aprobado va una vez, en pesos, con su propio id; queda confirmado", async () => {
    const s = stockerFalso();
    const c = crearCobros({ pool, stocker: s.cliente, log: silencio });
    const p = await pedido("pagado");
    const id = await pago(p.id, "REF-777");
    await pago(p.id, "REF-778", { estado: "insuficiente" }); // no alcanzó: no se manda
    expect(await c.delPedido(p.numero)).toEqual({ cobros: 1, sinAplicar: 0 });
    expect(s.cobros).toEqual([expect.objectContaining({ numero: p.numero, cobro: String(id), importe: 36000.5, medio: "transferencia", operacion: "REF-777" })]);
    const f = (await pool.query("SELECT stocker_en, stocker_aplicado FROM tienda.pagos WHERE id = $1", [id])).rows[0];
    expect([f.stocker_en !== null, f.stocker_aplicado]).toEqual([true, true]);
    // Ya confirmado: no se vuelve a mandar.
    expect((await c.delPedido(p.numero)).cobros).toBe(0);
    expect(s.cobros).toHaveLength(1);
  });
  it("si Stocker lo anota sin aplicarlo, queda escrito en el pedido (una vez)", async () => {
    const s = stockerFalso();
    s.alCobrar(async () => ({ aplicado: false, motivo: "Cobró sobre un pedido cancelado: la mercadería ya se liberó y hay que devolver el dinero." }));
    const c = crearCobros({ pool, stocker: s.cliente, log: silencio });
    const p = await pedido("pagado_tarde");
    const id = await pago(p.id, "REF-900");
    expect(await c.delPedido(p.numero)).toEqual({ cobros: 1, sinAplicar: 1 });
    expect((await pool.query("SELECT stocker_aplicado, stocker_motivo FROM tienda.pagos WHERE id = $1", [id])).rows[0]).toEqual({ stocker_aplicado: false, stocker_motivo: expect.stringMatching(/devolver el dinero/) });
    expect(await eventos(p.id)).toEqual([expect.stringMatching(/^Stocker anotó el cobro de transferencia sin aplicarlo: Cobró sobre un pedido cancelado/)]);
  });
  it("Stocker no tiene el pedido (404): se anota y no se reintenta para siempre", async () => {
    const s = stockerFalso();
    s.alCobrar(async () => { throw new ErrorStocker("Stocker contestó 404: Ese pedido no está en la cola.", 404); });
    const c = crearCobros({ pool, stocker: s.cliente, log: silencio });
    const p = await pedido("pagado_tarde");
    await pago(p.id, "REF-404");
    expect(await c.delPedido(p.numero)).toEqual({ cobros: 1, sinAplicar: 1 });
    expect((await c.delPedido(p.numero)).cobros).toBe(0);
  });
  it("un error de Stocker (caído) se reintenta: no se marca nada", async () => {
    const s = stockerFalso();
    s.alCobrar(async () => { throw new ErrorStocker("Stocker no responde"); });
    const c = crearCobros({ pool, stocker: s.cliente, log: silencio });
    const p = await pedido("pagado");
    const id = await pago(p.id, "REF-503");
    await expect(c.delPedido(p.numero)).rejects.toThrow(/no responde/);
    expect((await pool.query("SELECT stocker_en FROM tienda.pagos WHERE id = $1", [id])).rows[0].stocker_en).toBeNull();
  });
  it("barrido: manda los que quedaron sin confirmar (con unos minutos de gracia) y frena si Stocker no contesta", async () => {
    const s = stockerFalso();
    const c = crearCobros({ pool, stocker: s.cliente, log: silencio });
    const p = await pedido("pagado");
    const viejo = await pago(p.id, "REF-B1", { hace: "10 minutes" });
    await pago(p.id, "REF-B2"); // recién: lo manda el trabajo de la cola
    const r = await c.pendientes(500);
    expect(r.mandados).toBeGreaterThanOrEqual(1);
    expect(s.cobros.map((x) => x.cobro)).toContain(String(viejo));
    expect(s.cobros.map((x) => x.operacion)).not.toContain("REF-B2");
    const q = await pedido("pagado");
    await pago(q.id, "REF-B3", { hace: "10 minutes" });
    await pago(q.id, "REF-B4", { hace: "9 minutes" });
    const caido = stockerFalso();
    caido.alCobrar(async () => { throw new ErrorStocker("Stocker no responde"); });
    expect((await crearCobros({ pool, stocker: caido.cliente, log: silencio }).pendientes(500)).mandados).toBe(0);
  });
});

describe("novedades de Stocker", () => {
  const armar = () => {
    const s = stockerFalso();
    const llamados: Array<[string, string]> = [];
    const n = crearNovedades({ pool, stocker: s.cliente, log: silencio, despachado: async (numero, que) => { llamados.push([numero, que]); return { cambio: true }; } });
    return { s, n, llamados };
  };
  it("la primera vez no trae historia: guarda el cursor de ahora", async () => {
    const { s, n, llamados } = armar();
    s.paginas.set(null, { cursor: "c:0", cambios: [cambio("ISU-0001", { cambio: "despachado", despachadoEn: new Date().toISOString() })], hayMas: false });
    expect(await n.leer()).toEqual({ empezo: true, vistos: 0, aplicados: 0 });
    expect(await cursor()).toBe("c:0");
    expect(llamados).toEqual([]);
  });
  it("despachado y falta mercadería van a envíos; el cursor avanza; un cancelado que ya salió cuenta como despachado", async () => {
    const { s, n, llamados } = armar();
    const a = await pedido("pagado"), b = await pedido("pagado"), c = await pedido("pagado");
    await ponerCursor("c:0");
    s.paginas.set("c:0", { cursor: "c:2", hayMas: true, cambios: [
      cambio(a.numero, { cambio: "despachado", estadoEnvio: "despachado", despachadoEn: new Date().toISOString() }),
      cambio(b.numero, { cambio: "faltante", estadoEnvio: "con_faltante" }),
    ] });
    s.paginas.set("c:2", { cursor: "c:4", hayMas: false, cambios: [
      cambio(c.numero, { cambio: "despachado", estado: "cancelado", despachadoEn: new Date().toISOString(), canceladoEn: new Date().toISOString() }),
      cambio("ML-123", { cambio: "despachado", despachadoEn: new Date().toISOString() }), // no es de la tienda
    ] });
    expect(await n.leer()).toEqual({ empezo: false, vistos: 4, aplicados: 3 });
    expect(llamados).toEqual([[a.numero, "despachado"], [b.numero, "faltante"], [c.numero, "despachado"]]);
    expect(await cursor()).toBe("c:4");
    expect(s.preguntas).toEqual(["c:0", "c:2"]);
  });
  it("cancelado en Stocker: el que espera el pago vence ya; el cobrado queda marcado para revisar (una sola vez)", async () => {
    const { s, n } = armar();
    const espera = await pedido("esperando_transferencia");
    const informado = await pedido("transferencia_informada");
    const cobrado = await pedido("pagado");
    const cerrado = await pedido("vencido");
    await ponerCursor("c:0");
    const cancelado = { cambio: "cancelado", estado: "cancelado", canceladoEn: new Date().toISOString(), motivo: "Venció el plazo de pago: se liberó la mercadería apartada" };
    s.paginas.set("c:0", { cursor: "c:4", hayMas: false, cambios: [cambio(espera.numero, cancelado), cambio(informado.numero, cancelado), cambio(cobrado.numero, cancelado), cambio(cerrado.numero, cancelado)] });
    expect((await n.leer()).aplicados).toBe(3);
    const vence = (await pool.query("SELECT vence_en <= now() AS ya FROM tienda.pedidos WHERE id = $1", [espera.id])).rows[0].ya;
    expect(vence).toBe(true);
    expect(await eventos(espera.id)).toEqual(["Stocker liberó la mercadería apartada: Venció el plazo de pago: se liberó la mercadería apartada"]);
    expect((await eventos(informado.id))[0]).toMatch(/Si se confirma la transferencia, revisá que haya stock/);
    expect((await eventos(cobrado.id))[0]).toMatch(/^Stocker canceló este pedido ya cobrado: .*devolver el dinero/);
    expect(await eventos(cerrado.id)).toEqual([]);
    // Stocker repite el cambio con cada novedad del pedido: no se duplica.
    s.paginas.set("c:4", { cursor: "c:5", hayMas: false, cambios: [cambio(cobrado.numero, cancelado)] });
    await n.leer();
    expect(await eventos(cobrado.id)).toHaveLength(1);
  });
  it("si algo falla a la mitad, el cursor queda en la última tanda aplicada (la próxima vuelta la repite)", async () => {
    const s = stockerFalso();
    const a = await pedido("pagado");
    let veces = 0;
    const n = crearNovedades({ pool, stocker: s.cliente, log: silencio, despachado: async () => { if (++veces > 1) throw new Error("base caída"); return { cambio: true }; } });
    await ponerCursor("c:0");
    s.paginas.set("c:0", { cursor: "c:1", hayMas: true, cambios: [cambio(a.numero, { cambio: "despachado", despachadoEn: new Date().toISOString() })] });
    s.paginas.set("c:1", { cursor: "c:2", hayMas: false, cambios: [cambio(a.numero, { cambio: "despachado", despachadoEn: new Date().toISOString() })] });
    await expect(n.leer()).rejects.toThrow(/base caída/);
    expect(await cursor()).toBe("c:1");
  });
});
