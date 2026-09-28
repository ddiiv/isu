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
import { rutasSalud } from "./modulos/salud/rutas.js";
import { rutasConfig } from "./modulos/config/rutas.js";
import { rutasCategorias } from "./modulos/categorias/rutas.js";

export interface Dependencias {
  env: Entorno;
  pool: pg.Pool;
  redis: Redis;
}

/*
 * Arma la aplicación sin escuchar en ningún puerto: la usan el servidor y
 * los tests (app.inject), así que lo que se prueba es exactamente lo que corre.
 */
export async function construirApp({ env, pool, redis }: Dependencias) {
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
  await rutasConfig(app, { db, cache });
  await rutasCategorias(app, { db, cache });

  return app;
}
