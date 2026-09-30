import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import type pg from "pg";
import type { Redis } from "ioredis";
import { randomUUID } from "node:crypto";
import { crearDb } from "@isu/db";
import type { Entorno } from "./entorno.js";
import { seguridad } from "./plugins/seguridad.js";
import { errores } from "./plugins/errores.js";
import { CacheCorta } from "./lib/cache.js";
import { crearDescuentos } from "./lib/descuentos.js";

/* El mismo canal que usa el worker (apps/worker/src/stocker/invalidar.ts). */
export const CANAL_INVALIDAR = "isu:invalidar";
import { rutasSalud } from "./modulos/salud/rutas.js";
import { rutasConfig } from "./modulos/config/rutas.js";
import { rutasCategorias } from "./modulos/categorias/rutas.js";
import { rutasProductos } from "./modulos/productos/rutas.js";
import { rutasFotos } from "./modulos/fotos/rutas.js";
import { rutasCuentas } from "./modulos/cuentas/rutas.js";
import { rutasPedidos } from "./modulos/pedidos/rutas.js";
import { rutasOutfits } from "./modulos/outfits/rutas.js";
import { crearServicioPedidos } from "./modulos/pedidos/servicio.js";
import { crearColas, type Colas } from "./lib/colas.js";
import { crearMercadoPago } from "./lib/mercadopago.js";
import { crearClienteStocker } from "@isu/stocker";
import { almacenDeComprobantes, almacenDeFotos, type Almacen } from "@isu/almacen";
import { rutasIngresoAdmin } from "./modulos/admin/ingreso.js";
import { rutasAdmin } from "./modulos/admin/rutas.js";

export interface Dependencias {
  env: Entorno;
  pool: pg.Pool;
  redis: Redis;
  /** Para las pruebas: colas de mentira (sin Redis/BullMQ). */
  colas?: Colas;
}

/*
 * Arma la aplicación sin escuchar en ningún puerto: la usan el servidor y
 * los tests (app.inject), así que lo que se prueba es exactamente lo que corre.
 */
export async function construirApp({ env, pool, redis, colas: colasDadas }: Dependencias) {
  const app = Fastify({
    logger: env.LOG_LEVEL === "silent" ? false : {
      level: env.LOG_LEVEL,
      // Nunca al log: credenciales, cookies, tokens ni datos de pago.
      redact: {
        paths: ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]', "*.password", "*.token", "*.cardNumber", "*.cvv"],
        censor: "[oculto]",
      },
    },
    // Se confía en los N saltos más cercanos (Cloudflare + borde de Railway), no en cualquiera.
    trustProxy: (_direccion: string, salto: number) => salto < env.PROXIES_DE_CONFIANZA,
    bodyLimit: 64 * 1024,
    requestTimeout: 15_000,
    connectionTimeout: 20_000,
    // Mayor que el timeout de inactividad de Cloudflare/Railway: si no, el
    // balanceador reutiliza una conexión que Node ya cerró y aparecen 502.
    keepAliveTimeout: 75_000,
    onProtoPoisoning: "error",
    onConstructorPoisoning: "error",
    genReqId: (req) => {
      const del = req.headers["x-request-id"];
      return typeof del === "string" && /^[\w-]{8,64}$/.test(del) ? del : randomUUID();
    },
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  errores(app);
  await seguridad(app, env, redis);

  // Sólo JSON. Cualquier otro content-type con cuerpo → 415.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("application/json", { parseAs: "string" }, app.getDefaultJsonParser("error", "error"));

  app.addHook("onSend", async (req, reply) => {
    reply.header("x-request-id", req.id);
  });

  const db = crearDb(pool);
  const cache = new CacheCorta(env.CACHE_SEGUNDOS);

  await rutasSalud(app, { pool, redis });
  await rutasConfig(app, { db, cache, pagoOnline: !!env.MP_ACCESS_TOKEN });
  await rutasCategorias(app, { db, cache });
  const descuentos = crearDescuentos(pool, cache);
  await rutasProductos(app, { pool, cache, descuentos });
  await rutasOutfits(app, { pool, cache, descuentos });
  if (env.FOTOS_DIR) await rutasFotos(app, { dir: env.FOTOS_DIR });

  /*
   * Cuando el worker cambia catálogo o stock, avisa por Redis y cada réplica
   * tira su caché de memoria: el cliente ve el cambio al instante y no a los
   * 30 segundos. Si Redis no está, la caché vence sola.
   */
  const oyente = redis.duplicate({ lazyConnect: true, enableOfflineQueue: true, maxRetriesPerRequest: null });
  oyente.on("error", () => {});
  oyente.on("message", (canal) => { if (canal === CANAL_INVALIDAR) cache.limpiar(); });
  oyente.connect().then(() => oyente.subscribe(CANAL_INVALIDAR)).catch(() => {});
  app.addHook("onClose", async () => { oyente.disconnect(); });

  // ── Etapa 2: cuentas, carrito, pedidos y pagos ──
  const colas = colasDadas ?? crearColas(redis, app.log);
  if (!colasDadas) app.addHook("onClose", async () => { await colas.cerrar(); });
  const stocker = env.STOCKER_API_URL && env.STOCKER_TOKEN ? crearClienteStocker({ url: env.STOCKER_API_URL, token: env.STOCKER_TOKEN }) : null;
  const mp = env.MP_ACCESS_TOKEN ? crearMercadoPago({ url: env.MP_API_URL, token: env.MP_ACCESS_TOKEN }) : null;
  const servicio = crearServicioPedidos({ pool, stocker, mp, colas, sitio: env.SITIO_URL, apiPublica: env.API_PUBLICA_URL, log: app.log, descuentos });
  await rutasCuentas(app, { pool, redis, env, colas });
  const comprobantes = almacenDeComprobantes({ ...process.env, COMPROBANTES_DIR: env.COMPROBANTES_DIR });
  await rutasPedidos(app, { pool, redis, env, servicio, mp, colas, comprobantes, descuentos });

  // ── Etapa 3: backoffice ──
  // Sin FOTOS_DIR ni R2 el backoffice funciona igual, pero no deja subir fotos.
  const fotos: Almacen | null = (() => { try { return almacenDeFotos({ ...process.env, FOTOS_DIR: env.FOTOS_DIR }); } catch { return null; } })();
  await rutasIngresoAdmin(app, { pool, redis, env });
  await rutasAdmin(app, { pool, redis, env, colas, cache, servicio, fotos, comprobantes, canalInvalidar: CANAL_INVALIDAR });

  return app;
}
