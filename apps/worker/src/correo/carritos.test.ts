import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { crearPool, migrar } from "@isu/db";
import { crearCarritos, TOPE_DIARIO_CARRITOS } from "./carritos.js";

/*
 * Recordatorio de carritos abandonados: a las 2 horas, un solo mail, con lo que sigue a la venta y al
 * precio de hoy; nada si compró, se dio de baja, no hay stock, la tienda está apagada o falta SMTP;
 * y la purga (7 días; 90 para los de baja).
 */
const DB = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:5433/stocker_test";
const BASE = 7_650_000;
const pool = crearPool({ url: DB, max: 4 });
const cola: Array<{ nombre: string; datos: Record<string, unknown>; id: string }> = [];
const ids = new Set<string>();
// Como BullMQ: el mismo jobId no se encola dos veces.
const encolar = async (nombre: "email", datos: Record<string, unknown>, id: string) => { if (!ids.has(id)) { ids.add(id); cola.push({ nombre, datos, id }); } };
const nuevo = (o: { smtp?: boolean; sitio?: string | undefined; topeDiario?: number } = {}) =>
  crearCarritos({ pool, encolar, sitio: "sitio" in o ? o.sitio : "https://www.isuwaya.test", smtp: o.smtp ?? true, fotos: "https://f.isuwaya.test", topeDiario: o.topeDiario });

const mail = (n: string) => `qa-wcar-${n}@test.com`;
const mios = () => cola.filter((c) => String(c.datos.para).startsWith("qa-wcar-"));
const de = (n: string) => mios().filter((c) => c.datos.para === mail(n));
/** Un carrito anotado hace `horas` horas. */
async function carrito(n: string, horas: number, items: Array<{ sku: string; cantidad: number }> = [{ sku: "QA-WC-M", cantidad: 2 }], extra = "") {
  await pool.query(
    `INSERT INTO tienda.carritos_abandonados (email, items, baja_token, creado_en, actualizado_en) VALUES ($1, $2::jsonb, $3, now() - make_interval(hours => $4), now() - make_interval(hours => $4))
     ON CONFLICT (email) DO UPDATE SET items = EXCLUDED.items, actualizado_en = EXCLUDED.actualizado_en, recordado_en = NULL, convertido_en = NULL, baja_en = NULL`,
    [mail(n), JSON.stringify(items), `tok-${n}-`.padEnd(43, "x"), horas]);
  if (extra) await pool.query(`UPDATE tienda.carritos_abandonados SET ${extra} WHERE email = $1`, [mail(n)]);
}
const limpiarCarritos = () => pool.query("DELETE FROM tienda.carritos_abandonados WHERE email LIKE 'qa-wcar-%'");
const ajusteTienda = (v: unknown) => v === null
  ? pool.query("DELETE FROM tienda.ajustes WHERE clave = 'tiendaCerrada'")
  : pool.query("INSERT INTO tienda.ajustes (clave, valor) VALUES ('tiendaCerrada', $1) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor", [JSON.stringify(v)]);

async function catalogo() {
  await pool.query("DELETE FROM tienda.productos WHERE stocker_id >= $1 AND stocker_id < $2", [BASE, BASE + 100]);
  const p = await pool.query("INSERT INTO tienda.productos (stocker_id, stocker_padre, nombre, slug, visible) VALUES ($1,'QA-WC','Remera <b>carrito</b>','qa-remera-carrito',true) RETURNING id", [BASE + 1]);
  const c = await pool.query("INSERT INTO tienda.producto_colores (producto_id, clave, nombre) VALUES ($1,'negro','Negro') RETURNING id", [p.rows[0].id]);
  await pool.query("INSERT INTO tienda.fotos (producto_id, tipo, color_id, clave) VALUES ($1,'color',$2,'p/aabbccddeeff/qawcfoto01')", [p.rows[0].id, c.rows[0].id]);
  const v = (sku: string, talle: string, precio: number, stock: number, sid: number) =>
    pool.query("INSERT INTO tienda.variantes (producto_id, color_id, stocker_id, sku, talle, precio, stock) VALUES ($1,$2,$3,$4,$5,$6,$7)", [p.rows[0].id, c.rows[0].id, sid, sku, talle, precio, stock]);
  await v("QA-WC-M", "M", 1_000_000, 5, BASE * 10 + 1);
  await v("QA-WC-L", "L", 1_200_000, 3, BASE * 10 + 2);
  await v("QA-WC-XL", "XL", 1_200_000, 0, BASE * 10 + 3);
}

beforeAll(async () => { await migrar(pool); await catalogo(); });
afterAll(async () => {
  await limpiarCarritos();
  await ajusteTienda(null);
  await pool.query("DELETE FROM tienda.productos WHERE stocker_id >= $1 AND stocker_id < $2", [BASE, BASE + 100]);
  await pool.end();
});
beforeEach(async () => { await limpiarCarritos(); await ajusteTienda(null); cola.length = 0; ids.clear(); });

describe("carritos abandonados (worker)", () => {
  it("a las 2 horas manda UN mail con nombre, color, talle, cantidad, foto y precio de hoy; después no repite", async () => {
    await carrito("a", 3, [{ sku: "QA-WC-M", cantidad: 2 }, { sku: "QA-WC-L", cantidad: 1 }]);
    // El precio cambió desde que lo anotó: manda el de hoy (con el descuento masivo vigente).
    await pool.query("UPDATE tienda.variantes SET precio = 1100000 WHERE sku = 'QA-WC-M'");
    const d = await pool.query("INSERT INTO tienda.descuentos (nombre, porcentaje, alcance, creado_por) VALUES ('QA wcar', 10, 'todo', 'prueba') RETURNING id");
    try {
      const r = await nuevo().recordar();
      expect(r.recordados).toBeGreaterThanOrEqual(1);
      expect(de("a")).toHaveLength(1);
      const m = de("a")[0]!;
      expect(m.datos.plantilla).toBe("carrito_abandonado");
      const datos = m.datos.datos as { items: Array<Record<string, unknown>>; enlace: string; baja: string };
      expect([...datos.items].sort((x, y) => String(x.talle).localeCompare(String(y.talle)))).toEqual([
        { nombre: "Remera <b>carrito</b>", color: "Negro", talle: "L", cantidad: 1, precio: 1_080_000, foto: "https://f.isuwaya.test/p/aabbccddeeff/qawcfoto01-400.webp" },
        { nombre: "Remera <b>carrito</b>", color: "Negro", talle: "M", cantidad: 2, precio: 990_000, foto: "https://f.isuwaya.test/p/aabbccddeeff/qawcfoto01-400.webp" },
      ]);
      expect(datos.enlace).toBe("https://www.isuwaya.test/carrito");
      // El token va en el fragmento (no viaja al servidor, a Analytics ni a los logs), nunca en la query.
      expect(datos.baja).toBe(`https://www.isuwaya.test/baja-recordatorios#t=${"tok-a-".padEnd(43, "x")}`);
      expect(datos.baja).not.toContain("?");
      expect(m.id).toMatch(/^carrito-\d+$/);
      // Al marcarlo recordado se vacían los items (queda sólo la marca de que ese mail ya recibió uno).
      expect((await pool.query("SELECT items FROM tienda.carritos_abandonados WHERE email = $1", [mail("a")])).rows[0].items).toEqual([]);
      expect((await pool.query("SELECT recordado_en FROM tienda.carritos_abandonados WHERE email = $1", [mail("a")])).rows[0].recordado_en).not.toBeNull();
      // Otra pasada (o la otra réplica) no lo manda de nuevo.
      await nuevo().recordar();
      await nuevo().recordar();
      expect(de("a")).toHaveLength(1);
    } finally { await pool.query("DELETE FROM tienda.descuentos WHERE id = $1", [d.rows[0].id]); }
  });

  it("dos réplicas a la vez: sale un solo mail", async () => {
    await carrito("b", 5);
    await Promise.all([nuevo().recordar(), nuevo().recordar(), nuevo().recordar()]);
    expect(de("b")).toHaveLength(1);
  });

  it("antes de las 2 horas no manda; después de comprar, de la baja o sin items, tampoco", async () => {
    await carrito("c1", 1);
    await carrito("c2", 5, undefined, "convertido_en = now()");
    await carrito("c3", 5, undefined, "baja_en = now(), items = '[]'");
    await carrito("c4", 5, []);
    await nuevo().recordar();
    expect(mios()).toEqual([]);
  });

  it("sin stock, de una prenda que ya no se vende o inexistente: no manda y no deja nada pendiente; con una que sí, manda sólo esa", async () => {
    await carrito("d1", 5, [{ sku: "QA-WC-XL", cantidad: 1 }, { sku: "NO-EXISTE", cantidad: 1 }]);
    await carrito("d2", 5, [{ sku: "QA-WC-XL", cantidad: 1 }, { sku: "QA-WC-L", cantidad: 1 }]);
    await nuevo().recordar();
    expect(de("d1")).toEqual([]);
    expect((await pool.query("SELECT recordado_en FROM tienda.carritos_abandonados WHERE email = $1", [mail("d1")])).rows[0].recordado_en).not.toBeNull();
    expect((de("d2")[0]!.datos.datos as { items: unknown[] }).items).toHaveLength(1);
  });

  it("con la tienda apagada, sin SMTP o sin SITIO_URL no manda ni marca (queda para cuando vuelva)", async () => {
    await carrito("e", 5);
    await ajusteTienda({ activa: true, titulo: "Cerrado", mensaje: "Volvemos." , vuelve: "" });
    expect(await nuevo().recordar()).toMatchObject({ recordados: 0, motivo: "Tienda apagada" });
    await ajusteTienda(null);
    expect(await nuevo({ smtp: false }).recordar()).toMatchObject({ recordados: 0, motivo: "Sin SMTP_URL" });
    expect(await nuevo({ sitio: undefined }).recordar()).toMatchObject({ recordados: 0 });
    expect(mios()).toEqual([]);
    expect((await pool.query("SELECT recordado_en FROM tienda.carritos_abandonados WHERE email = $1", [mail("e")])).rows[0].recordado_en).toBeNull();
    await nuevo().recordar();
    expect(de("e")).toHaveLength(1);
  });

  it("purga: 7 días los sin recordar, 90 los recordados (desde el mail) y los de baja (desde la baja); se purga aunque la tienda esté apagada", async () => {
    await carrito("p1", 24 * 8);
    await carrito("p2", 24 * 6);
    await carrito("p3", 24 * 20, [], "baja_en = now() - interval '20 days'");
    await carrito("p4", 24 * 100, [], "baja_en = now() - interval '91 days'");
    await carrito("p5", 24 * 100, [], "recordado_en = now() - interval '91 days'");
    await carrito("p6", 24 * 10, [], "recordado_en = now() - interval '10 days'");
    await ajusteTienda({ activa: true, titulo: "Cerrado", mensaje: "Volvemos.", vuelve: "" });
    await nuevo().recordar();
    const quedan = (await pool.query("SELECT email FROM tienda.carritos_abandonados WHERE email LIKE 'qa-wcar-p%' ORDER BY email")).rows.map((r) => r.email);
    expect(quedan).toEqual([mail("p2"), mail("p3"), mail("p6")]);
  });

  it("tope global diario: lo que excede queda pendiente (sin marcar) y sale al día siguiente", async () => {
    expect(TOPE_DIARIO_CARRITOS).toBe(300);
    const hoy = async () => (await pool.query("SELECT count(*)::int AS n FROM tienda.carritos_abandonados WHERE recordado_en >= date_trunc('day', now() AT TIME ZONE 'America/Argentina/Buenos_Aires') AT TIME ZONE 'America/Argentina/Buenos_Aires'")).rows[0].n as number;
    for (const n of ["t1", "t2", "t3"]) await carrito(n, 5);
    const tope = (await hoy()) + 2;
    const r = await nuevo({ topeDiario: tope }).recordar();
    expect(r.recordados).toBe(2);
    expect(mios()).toHaveLength(2);
    expect(await nuevo({ topeDiario: tope }).recordar()).toMatchObject({ recordados: 0, motivo: "Tope diario" });
    expect(mios()).toHaveLength(2);
    // «Al día siguiente»: lo marcado hoy pasa a ser de ayer y entra el que faltaba.
    await pool.query("UPDATE tienda.carritos_abandonados SET recordado_en = recordado_en - interval '1 day' WHERE email LIKE 'qa-wcar-t%' AND recordado_en IS NOT NULL");
    await nuevo({ topeDiario: tope }).recordar();
    expect(mios()).toHaveLength(3);
  });

  it("si el encolado de una fila falla, esa vuelve a quedar pendiente con sus items y las demás salen igual", async () => {
    await carrito("f1", 5);
    await carrito("f2", 5);
    let falla = true;
    const rota = async (nombre: "email", datos: Record<string, unknown>, id: string) => { if (falla && datos.para === mail("f1")) throw new Error("Redis caído"); return encolar(nombre, datos, id); };
    const c = crearCarritos({ pool, encolar: rota, sitio: "https://www.isuwaya.test", smtp: true });
    const w = console.warn; console.warn = () => {};
    try { await c.recordar(); } finally { console.warn = w; }
    expect(de("f2")).toHaveLength(1);
    expect(de("f1")).toEqual([]);
    const f1 = (await pool.query("SELECT recordado_en, items FROM tienda.carritos_abandonados WHERE email = $1", [mail("f1")])).rows[0];
    expect([f1.recordado_en, f1.items]).toEqual([null, [{ sku: "QA-WC-M", cantidad: 2 }]]);
    falla = false;
    await c.recordar();
    expect(de("f1")).toHaveLength(1);
    expect(de("f2")).toHaveLength(1);
  });
});
