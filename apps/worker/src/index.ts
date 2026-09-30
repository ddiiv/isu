import { Queue, Worker, UnrecoverableError } from "bullmq";
import { Redis } from "ioredis";
import { z } from "zod";
import { crearPool } from "@isu/db";
import { COLAS, OPCIONES_TRABAJO } from "@isu/shared";
import { crearProcesar, CLAVE_NEGOCIO, type Dependencias } from "./procesadores.js";
import { crearClienteStocker, MAX_SKUS_POR_PEDIDO } from "./stocker/cliente.js";
import { escucharStocker } from "./stocker/escucha.js";
import { crearCorreo } from "./correo/enviar.js";
import { crearInvalidador } from "./stocker/invalidar.js";
import { crearTransportes } from "@isu/envios";
import { crearEnvios } from "./envios/envios.js";

/*
 * Worker: procesa las colas en segundo plano. Es un servicio aparte en
 * Railway para que un trabajo pesado nunca le robe CPU a la API.
 */
const env = z.object({
  REDIS_URL: z.string().url(),
  DATABASE_URL: z.string().url(),
  DB_SSL: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  CONCURRENCIA: z.coerce.number().int().min(1).max(50).default(5),
  STOCKER_API_URL: z.string().url().optional(),
  STOCKER_TOKEN: z.string().min(20).optional(),
  CATALOGO_CADA_MINUTOS: z.coerce.number().int().min(1).max(1440).default(10),
  // Para regenerar las páginas de la tienda al cambiar el stock (red privada de Railway).
  WEB_INTERNAL_URL: z.string().url().optional(),
  REVALIDAR_TOKEN: z.string().min(32).optional(),
  // Etapa 2: la API (red privada) para vencimientos y conciliación de pagos.
  API_URL: z.string().url().optional(),
  INTERNO_TOKEN: z.string().min(32).optional(),
  // Correo: smtp://usuario:clave@host:puerto (en local, Mailpit: smtp://localhost:1025)
  SMTP_URL: z.string().min(8).optional(),
  CORREO_DE: z.string().min(3).default("Isuwaya <isu.isuwaya@gmail.com>"),
  CORREO_RESPONDER: z.string().email().optional(),
  // Etapa 4: el enlace de seguimiento de los avisos (los transportes se configuran con sus propias variables).
  SITIO_URL: z.string().url().optional(),
  // "CLAVE=" en el .env es lo mismo que no ponerla.
}).parse(Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v !== "")));

// BullMQ exige maxRetriesPerRequest: null en la conexión de los workers.
const conexion = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, family: 0 });
const pool = crearPool({ url: env.DATABASE_URL, ssl: env.DB_SSL, max: 4, nombreApp: "isu-tienda-worker" });
const colaStocker = new Queue(COLAS.stocker, { connection: conexion, prefix: "isu", defaultJobOptions: OPCIONES_TRABAJO });

let deps: Dependencias | undefined;
if (env.STOCKER_API_URL && env.STOCKER_TOKEN) {
  deps = {
    pool,
    redis: conexion,
    stocker: crearClienteStocker({ url: env.STOCKER_API_URL, token: env.STOCKER_TOKEN }),
    invalidar: crearInvalidador({ redis: conexion, webUrl: env.WEB_INTERNAL_URL, token: env.REVALIDAR_TOKEN }),
    cola: colaStocker,
  };
} else {
  console.warn("Stocker sin configurar (STOCKER_API_URL / STOCKER_TOKEN): no se sincroniza el catálogo.");
}
const api = env.API_URL && env.INTERNO_TOKEN
  ? async (ruta: string) => {
    const r = await fetch(`${env.API_URL!.replace(/\/+$/, "")}${ruta}`, {
      method: "POST", headers: { "x-isu-interno": env.INTERNO_TOKEN! }, signal: AbortSignal.timeout(120_000), redirect: "error",
    });
    if (!r.ok) throw new Error(`API ${ruta}: ${r.status}`);
    return r.json();
  }
  : undefined;
// ── Etapa 4: envíos ──
const transportes = crearTransportes(process.env);
const colaNotificaciones = new Queue(COLAS.notificaciones, { connection: conexion, prefix: "isu", defaultJobOptions: OPCIONES_TRABAJO });
const colaEnvios = new Queue(COLAS.envios, { connection: conexion, prefix: "isu", defaultJobOptions: { ...OPCIONES_TRABAJO, attempts: 8 } });
const envios = crearEnvios({
  pool,
  transportes,
  encolar: (nombre, datos, id) => colaNotificaciones.add(nombre, datos, { jobId: id }),
  encolarStocker: (nombre, datos, id) => colaStocker.add(nombre, datos, { jobId: id, attempts: 12 }),
  sitio: env.SITIO_URL,
  secreto: env.INTERNO_TOKEN,
  estadoEnStocker: deps ? (n) => deps!.stocker.estadoPedido(n) : undefined,
});
if (!env.SITIO_URL || !env.INTERNO_TOKEN) console.warn("Sin SITIO_URL / INTERNO_TOKEN: los avisos de envío van sin enlace de seguimiento.");

const procesar = crearProcesar(deps, {
  correo: crearCorreo({ smtp: env.SMTP_URL, de: env.CORREO_DE, responder: env.CORREO_RESPONDER }),
  api,
  envios,
  whatsapp: transportes.whatsapp,
});

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
    // El catálogo y el stock escriben las mismas filas: de a uno en la cola de Stocker.
    { connection: conexion, concurrency: cola === COLAS.stocker ? 1 : env.CONCURRENCIA, prefix: "isu" },
  ).on("failed", (t, err) => console.error(`[${cola}] ${t?.name} falló (intento ${t?.attemptsMade}):`, err.message)),
);
console.warn(`worker escuchando: ${Object.values(COLAS).join(", ")}`);

// Vencimientos de pedidos sin pagar y repaso de Mercado Pago.
const colaPagos = new Queue(COLAS.pagos, { connection: conexion, prefix: "isu", defaultJobOptions: { removeOnComplete: { count: 100 }, removeOnFail: { count: 500 } } });
if (api) {
  await colaPagos.upsertJobScheduler("vencer", { every: 60_000 }, { name: "vencer" });
  await colaPagos.upsertJobScheduler("conciliar-mp", { every: 10 * 60_000 }, { name: "conciliar-mp" });
} else {
  console.warn("Sin API_URL / INTERNO_TOKEN: los pedidos sin pagar no vencen solos.");
}

// Seguimiento de los envíos y repaso de despachos (una sola programación aunque haya varias réplicas).
await colaEnvios.upsertJobScheduler("seguimiento", { every: 10 * 60_000 }, { name: "seguimiento" });
if (deps) await colaEnvios.upsertJobScheduler("revisar-despachos", { every: 15 * 60_000 }, { name: "revisar-despachos" });

let escucha: ReturnType<typeof escucharStocker> | null = null;
if (deps) {
  // Una sola programación aunque haya varias réplicas (el id la hace única). La primera corre ya.
  await colaStocker.upsertJobScheduler("catalogo-periodico", { every: env.CATALOGO_CADA_MINUTOS * 60_000 }, { name: "catalogo" });

  const pedirCatalogo = () => colaStocker.add("catalogo", {}, { jobId: `catalogo-reconexion-${Math.floor(Date.now() / 60_000)}` }).then(() => {});
  escucha = escucharStocker({
    url: env.DATABASE_URL,
    ssl: env.DB_SSL,
    negocio: async () => {
      const v = await conexion.get(CLAVE_NEGOCIO);
      return v ? Number(v) : null;
    },
    alCambiar: async (skus) => {
      for (let i = 0; i < skus.length; i += MAX_SKUS_POR_PEDIDO) {
        await colaStocker.add("stock", { skus: skus.slice(i, i + MAX_SKUS_POR_PEDIDO) });
      }
    },
    alReconectar: async () => {
      await pedirCatalogo();
      await colaEnvios.add("revisar-despachos", {}, { jobId: `despachos-reconexion-${Math.floor(Date.now() / 60_000)}` });
    },
    // El despacho del depósito: el pedido sale y se avisa al cliente.
    alEnvio: async (numero, evento) => {
      await colaEnvios.add("despachado", { numero, evento }, { jobId: `despachado-${numero}-${evento}` });
    },
  });
}

async function apagar() {
  // Termina los trabajos en curso antes de salir: ninguno queda a medias.
  await escucha?.parar();
  await Promise.allSettled(workers.map((w) => w.close()));
  await colaStocker.close();
  await colaPagos.close();
  await colaNotificaciones.close();
  await colaEnvios.close();
  await pool.end();
  await conexion.quit();
  process.exit(0);
}
process.on("SIGTERM", () => void apagar());
process.on("SIGINT", () => void apagar());
