import type { Job } from "bullmq";

/*
 * Qué hace cada cola. En la etapa 0 sólo existe el latido: prueba punta a
 * punta que Redis, la cola y el worker funcionan en Railway. Las etapas
 * siguientes agregan sus trabajos acá (sincronizar stock, notificar, etc.).
 */
export type Procesador = (trabajo: Job) => Promise<unknown>;

export const PROCESADORES: Record<string, Record<string, Procesador>> = {
  stocker: {
    latido: async (t) => ({ ok: true, recibido: t.data, en: new Date().toISOString() }),
  },
  notificaciones: {},
  envios: {},
  pagos: {},
};

export async function procesar(cola: string, trabajo: Job) {
  const p = PROCESADORES[cola]?.[trabajo.name];
  // Un trabajo desconocido falla sin reintentos: reintentarlo no lo va a arreglar.
  if (!p) throw Object.assign(new Error(`Trabajo desconocido: ${cola}/${trabajo.name}`), { sinReintento: true });
  return p(trabajo);
}
