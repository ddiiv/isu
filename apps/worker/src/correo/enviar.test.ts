import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMail = vi.fn(async (_m: Record<string, unknown>) => ({ messageId: "id-1" }));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail }) } }));
const { crearCorreo } = await import("./enviar.js");

const FILA = {
  id: 7, numero: "ISU-1234", creado_en: new Date(), nombre: "Ana", apellido: "Pérez", email: "ana@test.com", telefono: "1155550000", dni: "30111222",
  entrega: "retiro", local_retiro: "Vía Flores · Local 21", direccion: null, transporte: null, sucursal_envio: null,
  medio_pago: "transferencia", subtotal: 2_000_000, descuento_cupon: 0, cupon_codigo: null, cupon_nombre: null, descuento: 0, envio: 0, total: 2_000_000,
};
const ITEM = { nombre: "Remera", color: "Negro", talle: "M", precio: 1_000_000, cantidad: 2 };
const pool = { query: vi.fn(async (sql: string) => ({ rows: sql.includes("pedido_items") ? [ITEM] : [FILA] })) } as never;
const pago = { plantilla: "pago_confirmado", para: "ana@test.com", datos: { numero: "ISU-1234", nombre: "Ana", total: 2_000_000, subtotal: 2_000_000, descuento: 0, envio: 0, entrega: "retiro", local: "Local", items: [ITEM], enlace: "https://x.test" } };

beforeEach(() => sendMail.mockClear());

describe("crearCorreo", () => {
  it("«Pago confirmado» lleva el PDF del pedido adjunto", async () => {
    await crearCorreo({ smtp: "smtp://x", de: "Isu <a@b.com>", pool })(pago);
    const m = sendMail.mock.calls[0]![0] as { to: string; attachments: Array<{ filename: string; content: Buffer }> };
    expect(m.to).toBe("ana@test.com");
    expect(m.attachments[0]!.filename).toBe("pedido-ISU-1234.pdf");
    expect(m.attachments[0]!.content.subarray(0, 4).toString()).toBe("%PDF");
  });
  it("el PDF no sale si el pedido es de otro mail, y los mails sin adjunto no llevan", async () => {
    const enviar = crearCorreo({ smtp: "smtp://x", de: "a@b.com", pool });
    await enviar({ ...pago, para: "otra@test.com" });
    await enviar({ plantilla: "bienvenida", para: "ana@test.com", datos: { nombre: "Ana" } });
    for (const c of sendMail.mock.calls) expect((c[0] as { attachments?: unknown }).attachments).toBeUndefined();
  });
  it("sin CORREO_VENTAS no se manda el interno (y no falla)", async () => {
    const r = await crearCorreo({ smtp: "smtp://x", de: "a@b.com", pool })({ plantilla: "venta_tienda", para: "ana@test.com", datos: { numero: "ISU-1234" } });
    expect(r).toMatchObject({ enviado: false });
    expect(sendMail).not.toHaveBeenCalled();
  });
  it("con CORREO_VENTAS el interno va a esa dirección (no al cliente), con PDF y link al backoffice", async () => {
    await crearCorreo({ smtp: "smtp://x", de: "a@b.com", pool, ventas: "ventas@isuwaya.com", adminUrl: "https://admin.isuwaya.com/" })({ plantilla: "venta_tienda", para: "ana@test.com", datos: { numero: "ISU-1234" } });
    const m = sendMail.mock.calls[0]![0] as { to: string; subject: string; text: string; attachments: unknown[] };
    expect(m.to).toBe("ventas@isuwaya.com");
    expect(m.subject).toContain("ISU-1234");
    expect(m.text).toContain("https://admin.isuwaya.com/pedidos/ISU-1234");
    expect(m.attachments).toHaveLength(1);
  });
});
