import { afterAll, describe, expect, it } from "vitest";
import { Queue, QueueEvents, Worker, UnrecoverableError } from "bullmq";
import { Redis } from "ioredis";
import { procesar } from "./procesadores.js";

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
