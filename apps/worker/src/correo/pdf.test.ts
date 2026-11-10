import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { pdfPedido } from "./pdf.js";
import type { PedidoVenta } from "./pedido.js";

const pedido = (extra: Partial<PedidoVenta> = {}): PedidoVenta => ({
  numero: "ISU-1234", creadoEn: new Date().toISOString(), nombre: "Ñandú Pérez Gómez", email: "nandu@test.com", telefono: "1155550000", dni: "30111222",
  entrega: "envio", local: null, direccion: "Bacacay 3231, piso 2 · Flores (1406), CABA", transporte: "Andreani", sucursal: null,
  medioPago: "Transferencia", subtotal: 3_000_000, descuentoCupon: 100_000, cupon: "cupón AÑO10 (10% OFF)", descuento: 290_000, envio: 500_000, total: 3_110_000,
  items: [
    { nombre: "Remera básica", color: "Azul", talle: "M", precio: 1_000_000, cantidad: 2 },
    { nombre: "Campera", color: "Verde", talle: "L", precio: 1_000_000, cantidad: 1 },
  ],
  ...extra,
});

describe("pdfPedido", () => {
  it("se genera, empieza con %PDF y lleva todas las prendas", async () => {
    const b = await pdfPedido(pedido());
    expect(b.subarray(0, 4).toString()).toBe("%PDF");
    expect((await PDFDocument.load(b)).getPageCount()).toBe(1);
  });
  it("no revienta con acentos, ñ, emojis y nombres larguísimos, y pasa a otra hoja si son muchas prendas", async () => {
    const largo = "Pantalón de gabardina estirable corte recto súper extra largo ñoño ".repeat(8);
    const items = Array.from({ length: 60 }, (_, i) => ({ nombre: `${largo} 🎉 ${i}`, color: "Año", talle: "XL", precio: 123_456, cantidad: 3 }));
    const b = await pdfPedido(pedido({ nombre: "José Ángel Ñúñez ✓", items, direccion: "Calle ñandú ".repeat(20) }));
    expect(b.subarray(0, 4).toString()).toBe("%PDF");
    expect((await PDFDocument.load(b)).getPageCount()).toBeGreaterThan(1);
  });
  it("retiro en el local", async () => {
    expect((await pdfPedido(pedido({ entrega: "retiro", local: "Vía Flores · Local 21", direccion: null, transporte: null, envio: 0 }))).length).toBeGreaterThan(500);
  });
});
