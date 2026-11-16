import http from "node:http";
import type { AddressInfo } from "node:net";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearPool, migrar } from "@isu/db";
import { crearConversiones } from "./conversiones.js";

const DB = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:5433/stocker_test";
const pool = crearPool({ url: DB, max: 2 });
const recibidos: Array<{ url: string; auth: string | undefined; cuerpo: any }> = [];
let estado = 200;
let srv: http.Server;
let url = "";
const sha = (t: string) => createHash("sha256").update(t).digest("hex");

async function pedido(n: string, extra: { pagado?: boolean; medicion?: object | null } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO tienda.pedidos (acceso_hash, email, nombre, apellido, telefono, dni, entrega, direccion, transporte, servicio_envio, medio_pago, subtotal, total, estado, ip, medicion, pagado_en)
     VALUES (repeat('a', 64), $1, 'Ana María', 'Pérez', '11 5555-1234', '30111222', 'envio', $2, 'andreani', 'domicilio', 'transferencia', 1234500, 1234500, 'pagado', '181.1.2.3', $3, $4)
     RETURNING id, numero`,
    [`qa-capi-${n}@test.com`, JSON.stringify({ calle: "Bacacay", numero: "1", cp: "C1406ABC", localidad: "San Justo", provincia: "Buenos Aires" }),
      extra.medicion === undefined ? JSON.stringify({ fbp: "fb.1.1700000000000.123456", ua: "Mozilla/5.0 test" }) : extra.medicion && JSON.stringify(extra.medicion),
      extra.pagado === false ? null : new Date("2026-11-13T15:00:00Z")]);
  await pool.query("INSERT INTO tienda.pedido_items (pedido_id, sku, nombre, precio, cantidad) VALUES ($1, 'SKU1', 'Remera', 1000, 2), ($1, 'SKU2', 'Jogger', 1000, 1)", [rows[0].id]);
  return rows[0].numero as string;
}

beforeAll(async () => {
  await migrar(pool);
  await pool.query("DELETE FROM tienda.pedidos WHERE email LIKE 'qa-capi%'");
  srv = http.createServer(async (req, res) => {
    let b = ""; for await (const c of req) b += c;
    recibidos.push({ url: req.url!, auth: req.headers.authorization, cuerpo: JSON.parse(b) });
    res.writeHead(estado, { "content-type": "application/json" }); res.end("{}");
  }).listen(0);
  url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
});
afterAll(async () => { await pool.query("DELETE FROM tienda.pedidos WHERE email LIKE 'qa-capi%'"); srv.close(); await pool.end(); });

describe("API de conversiones de Meta", () => {
  const c = () => crearConversiones({ pool, sitio: "https://www.isuwaya.test/", meta: { pixelId: "123456789012", token: "t".repeat(30), version: "v22.0", url, codigoDePrueba: "TEST1234" } });
  it("la compra pagada va con datos con hash, el mismo id que el Pixel y el valor en pesos", async () => {
    const n = await pedido("ok");
    expect(await c().compra(n)).toEqual({ enviado: true });
    const r = recibidos.at(-1)!;
    expect(r.url).toBe("/v22.0/123456789012/events");
    expect(r.auth).toBe(`Bearer ${"t".repeat(30)}`);
    expect(r.cuerpo.test_event_code).toBe("TEST1234");
    const e = r.cuerpo.data[0];
    expect(e).toMatchObject({ event_name: "Purchase", event_id: `purchase-${n}`, event_time: 1794582000, action_source: "website", event_source_url: `https://www.isuwaya.test/pedido/${n}` });
    expect(e.custom_data).toEqual({ currency: "ARS", value: 12345, content_type: "product", content_ids: ["SKU1", "SKU2"], num_items: 3, order_id: n });
    expect(e.user_data).toMatchObject({
      em: [sha("qa-capi-ok@test.com")], ph: [sha("5491155551234")], fn: [sha("ana")], ln: [sha("perez")],
      ct: [sha("sanjusto")], zp: [sha("1406")], country: [sha("ar")], client_ip_address: "181.1.2.3", client_user_agent: "Mozilla/5.0 test", fbp: "fb.1.1700000000000.123456",
    });
    expect(JSON.stringify(e)).not.toContain("qa-capi-ok@test.com");
  });
  it("sin consentimiento o sin pagar, no se manda nada", async () => {
    const antes = recibidos.length;
    expect(await c().compra(await pedido("sin", { medicion: null }))).toEqual({ motivo: "sin_consentimiento" });
    expect(await c().compra(await pedido("impago", { pagado: false }))).toEqual({ motivo: "sin_pagar" });
    expect(await c().compra("ISU-999999")).toEqual({ motivo: "no_existe" });
    expect(recibidos).toHaveLength(antes);
  });
  it("si Meta falla: 5xx se reintenta; un rechazo (4xx) no", async () => {
    const n = await pedido("falla");
    estado = 503;
    await expect(c().compra(n)).rejects.toMatchObject({ sinReintento: false });
    estado = 400;
    await expect(c().compra(n)).rejects.toMatchObject({ sinReintento: true });
    estado = 200;
  });
});
