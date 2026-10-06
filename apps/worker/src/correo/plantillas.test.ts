import { describe, expect, it } from "vitest";
import { armar } from "./plantillas.js";

const pedido = (extra: Record<string, unknown> = {}) => ({
  numero: "ISU-1001", nombre: "Ana", medioPago: "transferencia", total: 1_600_000, subtotal: 2_000_000, descuento: 400_000, envio: 0,
  entrega: "retiro", local: "Vía Flores · Local 21", venceEn: new Date().toISOString(), enlace: "https://www.isuwaya.com.ar/pedido/ISU-1001#c=x",
  items: [{ nombre: "Remera", color: "Negro", talle: "M", precio: 1_000_000, cantidad: 2 }],
  transferencia: { titular: "ISUWAYA", cuit: "30-1", banco: "Banco", cbu: "000", alias: "ISU.ALIAS" },
  ...extra,
});

describe("mails", () => {
  it("escapa lo que viene del cliente (nombre, ítems, local)", () => {
    const m = armar("pedido_recibido", pedido({ nombre: '<img src=x onerror=alert(1)><a href="https://evil.example">Pagá acá</a>', items: [{ nombre: "<script>x</script>", color: null, talle: null, precio: 1, cantidad: 1 }] }));
    expect(m.html).not.toContain("<img src=x");
    expect(m.html).not.toContain('<a href="https://evil.example"');
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;img src=x");
  });
  it("un enlace que no es http(s) no llega al botón", () => {
    const m = armar("restablecer", { nombre: "Ana", modo: "cambiar", enlace: "javascript:alert(1)" });
    expect(m.html).not.toContain("javascript:");
    expect(m.html).toContain('href="#"');
  });
  it("transferencia: datos bancarios, total y vencimiento", () => {
    const m = armar("pedido_recibido", pedido());
    expect(m.asunto).toBe("Recibimos tu pedido ISU-1001");
    expect(m.html).toContain("ISU.ALIAS");
    expect(m.html).toMatch(/\$\s?16\.000/);
    expect(m.texto).toContain("ISU-1001");
  });
  it("transferencia que se confirma sola: el monto exacto; con Talo el CVU del pedido y sin pedir comprobante", () => {
    const talo = armar("pedido_recibido", pedido({ transferencia: { titular: "", cuit: "", banco: "", cbu: "0000630500000060195375", alias: "isu.qa.1", monto: 1_600_000, via: "talo", automatica: true } }));
    expect(talo.html).toContain("0000630500000060195375");
    expect(talo.html).toContain(">CVU<");
    expect(talo.html).not.toContain("Titular");
    expect(talo.html).not.toContain("subí el comprobante");
    expect(talo.html).toMatch(/se confirma solo/);
    const mp = armar("pedido_recibido", pedido({ transferencia: { titular: "ISUWAYA", cuit: "30-1", banco: "Mercado Pago", cbu: "000", alias: "ISU.MP", monto: 1_600_037, via: "mercadopago", automatica: true } }));
    expect(mp.html).toMatch(/\$\s?16\.000,37/);
    expect(mp.html).toContain("con los centavos");
    // Sin datos nuevos (mails viejos en la cola): como siempre.
    expect(armar("pedido_recibido", pedido()).html).toContain("subí el comprobante");
  });
  it("con cupón: la línea del descuento (escapada) antes de la de transferencia", () => {
    const m = armar("pedido_recibido", pedido({ cupon: "cupón QA10 (<b>10%</b> OFF)", descuentoCupon: 200_000, subtotal: 2_000_000, descuento: 360_000, total: 1_440_000 }));
    expect(m.html).toContain("Cupón QA10 (&lt;b&gt;10%&lt;/b&gt; OFF)");
    expect(m.html.indexOf("Cupón QA10")).toBeLessThan(m.html.indexOf("Descuento por transferencia"));
    expect(m.html).toMatch(/−\$\s?2\.000/);
  });
  it("todas las plantillas tienen versión en texto", () => {
    for (const p of ["bienvenida", "restablecer", "pedido_recibido", "pago_confirmado", "pedido_vencido", "arrepentimiento", "transferencia_informada"] as const) {
      const m = armar(p, { ...pedido(), codigo: "ARR-ABC123", resultado: "cancelado", modo: "crear", enlace: "https://x.test" });
      expect(m.texto.length, p).toBeGreaterThan(10);
      expect(m.asunto.length, p).toBeGreaterThan(5);
    }
  });
});
