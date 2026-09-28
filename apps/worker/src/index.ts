import { Worker, UnrecoverableError } from "bullmq";
import { Redis } from "ioredis";
import { z } from "zod";
import { COLAS } from "@isu/shared";
import { procesar } from "./procesadores.js";

/*
 * Worker: procesa las colas en segundo plano. Es un servicio aparte en
 * Railway para que un trabajo pesado nunca le robe CPU a la API.
 */
const env = z.object({
  REDIS_URL: z.string().url(),
  CONCURRENCIA: z.coerce.number().int().min(1).max(50).default(5),
}).parse(process.env);

// BullMQ exige maxRetriesPerRequest: null en la conexión de los workers.
const conexion = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, family: 0 });

const workers = Object.values(COLAS).map((cola) =>
  new Worker(
    cola,
    async (trabajo) => {
      try {
        return await procesar(cola, trabajo);
      } catch (err) {
        if ((err as { sinReintento?: boolean }).sinReintento) throw new UnrecoverableError((err as Error).message);
        throw err;
      }
    },
    { connection: conexion, concurrency: env.CONCURRENCIA, prefix: "isu" },
  ).on("failed", (t, err) => console.error(`[${cola}] ${t?.name} falló (intento ${t?.attemptsMade}):`, err.message)),
);
console.warn(`worker escuchando: ${Object.values(COLAS).join(", ")}`);

async function apagar() {
  // Termina los trabajos en curso antes de salir: ninguno queda a medias.
  await Promise.allSettled(workers.map((w) => w.close()));
  await conexion.quit();
  process.exit(0);
}
process.on("SIGTERM", () => void apagar());
process.on("SIGINT", () => void apagar());
