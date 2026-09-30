import type { FastifyInstance } from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { timingSafeEqual } from "node:crypto";
import underPressure from "@fastify/under-pressure";
import type { Redis } from "ioredis";
import type { Entorno } from "../entorno.js";

/*
 * Defensas de borde, aplicadas a TODAS las rutas antes de que entren a la
 * lógica. Van en un solo lugar para que una ruta nueva no pueda olvidarlas.
 */
export async function seguridad(app: FastifyInstance, env: Entorno, redis: Redis) {
  const interno = env.INTERNO_TOKEN ? Buffer.from(env.INTERNO_TOKEN) : null;
  const esInterno = (h: string | string[] | undefined) => {
    if (!interno || typeof h !== "string") return false;
    const b = Buffer.from(h);
    return b.length === interno.length && timingSafeEqual(b, interno);
  };
  // Cabeceras. La API sólo devuelve JSON: no carga nada, no se embebe en nada.
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] },
    },
    crossOriginResourcePolicy: { policy: "same-site" },
    crossOriginOpenerPolicy: { policy: "same-origin" },
    referrerPolicy: { policy: "no-referrer" },
    hsts: env.NODE_ENV === "production" ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
  });

  /*
   * CORS con lista cerrada. Un origen que no está en la lista no recibe la
   * cabecera y el navegador corta la respuesta. `credentials` porque la
   * sesión (etapa 2) va en cookie httpOnly, no en localStorage.
   */
  const permitidos = new Set(env.ORIGENES_PERMITIDOS);
  await app.register(cors, {
    origin: (origen, cb) => cb(null, !origen || permitidos.has(origen)),
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    maxAge: 600,
  });

  /*
   * Límite de pedidos por IP, contado en Redis para que valga entre réplicas.
   * Si Redis se cae, se deja pasar (skipOnError): la tienda sigue vendiendo y
   * Cloudflare sigue filtrando adelante.
   */
  await app.register(rateLimit, {
    global: true,
    max: env.LIMITE_PEDIDOS_POR_MINUTO,
    timeWindow: "1 minute",
    redis,
    nameSpace: "isu:rl:",
    skipOnError: true,
    keyGenerator: (req) => req.ip,
    /*
     * Exentos: los chequeos de salud y el servidor de la tienda. La web arma
     * sus páginas pidiéndole a la API desde UNA sola IP interna: con el
     * límite por IP, en un pico la tienda se quedaría sin datos. Se identifica
     * con una credencial propia (INTERNO_TOKEN); los visitantes siguen limitados.
     */
    // /fotos/* sólo existe en desarrollo (en producción las sirve R2): son archivos estáticos.
    allowList: (req) => req.url === "/healthz" || req.url === "/readyz" || (!!env.FOTOS_DIR && req.url.startsWith("/fotos/")) || esInterno(req.headers["x-isu-interno"]),
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      error: "demasiados_pedidos",
      mensaje: `Demasiados pedidos. Probá de nuevo en ${Math.ceil(ctx.ttl / 1000)} s.`,
    }),
  });

  /*
   * Freno de emergencia: si el proceso está saturado (event loop trabado o
   * memoria al tope) contesta 503 enseguida en vez de encolar pedidos que
   * igual van a vencer. Cloudflare puede servir lo cacheado mientras tanto.
   */
  await app.register(underPressure, {
    maxEventLoopDelay: 1000,
    maxHeapUsedBytes: 0,
    maxRssBytes: 0,
    maxEventLoopUtilization: 0.98,
    retryAfter: 10,
    exposeStatusRoute: false,
    pressureHandler: (_req, reply, tipo, valor) => {
      reply.code(503).header("retry-after", "10").send({ error: "sobrecarga", mensaje: "Estamos con mucho tráfico. Probá en unos segundos." });
      app.log.warn({ tipo, valor }, "bajo presión: pedido rechazado");
    },
  });
}
