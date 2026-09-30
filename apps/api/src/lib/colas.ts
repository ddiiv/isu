import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import { COLAS, OPCIONES_TRABAJO } from "@isu/shared";

/*
 * Lo que la API deja para el worker: mails, avisos a Stocker que pueden
 * esperar (cliente nuevo) o que no se pueden perder (pedido cobrado).
 * Si Redis no está, el pedido HTTP no falla: se registra y sigue.
 */
export type Plantilla = "bienvenida" | "restablecer" | "pedido_recibido" | "pago_confirmado" | "pedido_vencido" | "arrepentimiento" | "transferencia_informada";

export interface Colas {
  email(plantilla: Plantilla, para: string, datos: Record<string, unknown>): Promise<void>;
  stocker(nombre: "cliente" | "pagado" | "cancelar" | "stock" | "invalidar" | "catalogo", datos: Record<string, unknown>, id?: string): Promise<void>;
  cerrar(): Promise<void>;
}

export function crearColas(redis: Redis, log: { warn: (o: object, m: string) => void }): Colas {
  const conexion = redis.duplicate({ maxRetriesPerRequest: null, enableOfflineQueue: false, lazyConnect: true });
  conexion.on("error", () => {});
  const noti = new Queue(COLAS.notificaciones, { connection: conexion, prefix: "isu", defaultJobOptions: OPCIONES_TRABAJO });
  const stk = new Queue(COLAS.stocker, { connection: conexion, prefix: "isu", defaultJobOptions: { ...OPCIONES_TRABAJO, attempts: 12 } });
  noti.on("error", () => {});
  stk.on("error", () => {});
  const seguro = async (fn: () => Promise<unknown>, que: string) => {
    try { await fn(); } catch (e) { log.warn({ err: (e as Error).message }, `no se pudo encolar ${que}`); }
  };
  return {
    email: (plantilla, para, datos) => seguro(() => noti.add("email", { plantilla, para, datos }), `el mail ${plantilla}`),
    stocker: (nombre, datos, id) => seguro(() => stk.add(nombre, datos, id ? { jobId: id } : undefined), `stocker/${nombre}`),
    async cerrar() { await Promise.allSettled([noti.close(), stk.close()]); conexion.disconnect(); },
  };
}
