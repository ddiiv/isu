import { z } from "zod";

/*
 * Variables de entorno, validadas al arrancar. Si falta algo, la API no
 * levanta y dice qué: es preferible a descubrirlo con el primer cliente.
 */
const lista = (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean);

const Entorno = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  // Railway enruta la red privada por IPv6: en producción tiene que ser "::".
  HOST: z.string().default("::"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  // La MISMA base de Stocker. La tienda sólo usa el esquema `tienda`.
  DATABASE_URL: z.string().url(),
  DB_SSL: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  REDIS_URL: z.string().url(),

  // Orígenes que pueden llamar a la API desde un navegador (tienda y backoffice).
  ORIGENES_PERMITIDOS: z.string().default("http://localhost:3000,http://localhost:3001").transform(lista),
  /*
   * Cuántos proxies hay adelante (Cloudflare + borde de Railway = 2). Con esto
   * `req.ip` es la IP real del cliente y no la de Cloudflare. Nunca `true`:
   * confiar en cualquier X-Forwarded-For deja que un atacante elija su IP y
   * se saltee el límite de pedidos.
   */
  PROXIES_DE_CONFIANZA: z.coerce.number().int().min(0).max(5).default(0),

  LIMITE_PEDIDOS_POR_MINUTO: z.coerce.number().int().min(1).default(300),
  CACHE_SEGUNDOS: z.coerce.number().int().min(0).max(3600).default(30),

  // Stocker (etapa 1): URL interna de Railway y credencial de integración.
  STOCKER_API_URL: z.string().url().optional(),
  STOCKER_TOKEN: z.string().min(20).optional(),
});

export type Entorno = z.infer<typeof Entorno>;

export function leerEntorno(fuente: NodeJS.ProcessEnv = process.env): Entorno {
  const r = Entorno.safeParse(fuente);
  if (!r.success) {
    const faltan = r.error.issues.map((i) => `  · ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Configuración inválida:\n${faltan}`);
  }
  return r.data;
}
