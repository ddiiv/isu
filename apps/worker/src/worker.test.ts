import { afterAll, describe, expect, it } from "vitest";
import { Queue, QueueEvents, Worker, UnrecoverableError } from "bullmq";
import { Redis } from "ioredis";
import { crearProcesadores, procesar } from "./procesadores.js";

const URL = process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6380/6";
const conexion = new Redis(URL, { maxRetriesPerRequest: null });
const cola = new Queue("stocker", { connection: conexion, prefix: "isu-test" });
const eventos = new QueueEvents("stocker", { connection: conexion.duplicate(), prefix: "isu-test" });
const worker = new Worker("stocker", async (t) => {
  try { return await procesar("stocker", t); } catch (e) {
    if ((e as { sinReintento?: boolean }).sinReintento) throw new UnrecoverableError((e as Error).message);
    throw e;
  }
}, { connection: conexion.duplicate(), prefix: "isu-test" });

afterAll(async () => {
  await worker.close(); await eventos.close(); await cola.obliterate({ force: true }); await cola.close(); await conexion.quit();
});

describe("worker", () => {
  it("procesa un latido de punta a punta", async () => {
    await eventos.waitUntilReady();
    const t = await cola.add("latido", { desde: "test" });
    const r = await t.waitUntilFinished(eventos, 10_000);
    expect(r).toMatchObject({ ok: true, recibido: { desde: "test" } });
  });
  it("un trabajo desconocido falla sin reintentos", async () => {
    const t = await cola.add("no-existe", {}, { attempts: 5, backoff: { type: "fixed", delay: 10 } });
    await expect(t.waitUntilFinished(eventos, 10_000)).rejects.toThrow(/desconocido/);
    const final = await cola.getJob(t.id!);
    expect(final?.attemptsMade).toBe(1);
  });
});

describe("notificaciones/whatsapp", () => {
  const job = (data: Record<string, unknown>) => ({ name: "whatsapp", data }) as never;
  it("con botón; si Meta rechaza la plantilla nueva (en revisión), manda la de respaldo", async () => {
    const llamadas: unknown[][] = [];
    const whatsapp = {
      async plantilla(...a: unknown[]) {
        llamadas.push(a);
        if (a[1] === "aviso_en_camino") throw Object.assign(new Error("template not approved"), { reintentable: false });
        return { id: "wamid.1" };
      },
    };
    const p = crearProcesadores(undefined, { whatsapp }).notificaciones!.whatsapp!;
    const r = await p(job({ telefono: "5491155551234", plantilla: "aviso_en_camino", parametros: ["Ana"], boton: "ISU-1001?t=x", respaldo: { plantilla: "pedido_en_camino", parametros: ["Ana", "enlace"] } }));
    expect(r).toEqual({ id: "wamid.1", respaldo: true });
    expect(llamadas).toEqual([
      ["5491155551234", "aviso_en_camino", ["Ana"], "ISU-1001?t=x", undefined],
      ["5491155551234", "pedido_en_camino", ["Ana", "enlace"], undefined],
    ]);
    // Con el PDF del pedido: lo arma el worker y va en la cabecera; si no se puede armar, sale el respaldo (con su botón).
    llamadas.length = 0;
    const conPdf = crearProcesadores(undefined, { whatsapp, pdfPedido: async (n) => (n === "ISU-1001" ? Buffer.from("%PDF-1") : null) }).notificaciones!.whatsapp!;
    await conPdf(job({ telefono: "5491155551234", plantilla: "aviso_pedido_pagado", parametros: ["Ana"], boton: "b", documento: "ISU-1001" }));
    expect(llamadas[0]!.slice(1)).toEqual(["aviso_pedido_pagado", ["Ana"], "b", { contenido: Buffer.from("%PDF-1"), archivo: "pedido-ISU-1001.pdf" }]);
    llamadas.length = 0;
    await conPdf(job({ telefono: "5491155551234", plantilla: "aviso_pedido_pagado", parametros: ["Ana"], boton: "b", documento: "ISU-9999", respaldo: { plantilla: "aviso_pago_recibido", parametros: ["Ana"], boton: "b" } }));
    expect(llamadas).toEqual([["5491155551234", "aviso_pago_recibido", ["Ana"], "b"]]);
    // Sin respaldo, el rechazo no se reintenta.
    await expect(p(job({ telefono: "5491155551234", plantilla: "aviso_en_camino", parametros: [] }))).rejects.toMatchObject({ sinReintento: true });
  });
});
