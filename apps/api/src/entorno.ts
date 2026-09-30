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
  // Credencial del servidor de la tienda (web → API): no cuenta para el límite por IP.
  INTERNO_TOKEN: z.string().min(32).optional(),
  CACHE_SEGUNDOS: z.coerce.number().int().min(0).max(3600).default(30),

  // Sólo desarrollo/pruebas: sirve /fotos/* desde esta carpeta (en producción, R2).
  FOTOS_DIR: z.string().min(1).optional(),

  // Stocker: URL interna de Railway (sin /api) y credencial de integración con origen «tienda».
  STOCKER_API_URL: z.string().url().optional(),
  STOCKER_TOKEN: z.string().min(20).optional(),

  // Etapa 2 ─────────────────────────────────────────────────────────
  // Direcciones públicas: la de la tienda (vuelta de Mercado Pago, enlaces de los mails)
  // y la de esta API (aviso de pago de Mercado Pago).
  SITIO_URL: z.string().url().default("http://localhost:3000"),
  API_PUBLICA_URL: z.string().url().default("http://localhost:4000"),
  MP_ACCESS_TOKEN: z.string().min(20).optional(),
  // Clave secreta de las notificaciones (Tus integraciones → Webhooks → Clave secreta).
  MP_WEBHOOK_SECRET: z.string().min(16).optional(),
  MP_API_URL: z.string().url().default("https://api.mercadopago.com"),
  // Credencial para registrar pagos por API (transferencias, cobros en el local).
  PAGOS_TOKEN: z.string().min(32).optional(),
  // Comprobantes de transferencia (privados). En producción: R2_BUCKET_PRIVADO.
  COMPROBANTES_DIR: z.string().min(1).optional(),
  // Duración de la sesión de un cliente, en días (se renueva sola con el uso).
  SESION_DIAS: z.coerce.number().int().min(1).max(90).default(30),

  // Etapa 3 ─────────────────────────────────────────────────────────
  // Cifra el secreto del doble factor del backoffice. openssl rand -base64 32
  ADMIN_CLAVE_CIFRADO: z.string().refine((k) => Buffer.from(k, "base64").length === 32, "Tienen que ser 32 bytes en base64: openssl rand -base64 32").optional(),
});

export type Entorno = z.infer<typeof Entorno>;

export function leerEntorno(fuente: NodeJS.ProcessEnv = process.env): Entorno {
  // "CLAVE=" en el .env es lo mismo que no ponerla.
  const limpio = Object.fromEntries(Object.entries(fuente).filter(([, v]) => v !== undefined && v !== ""));
  const r = Entorno.safeParse(limpio);
  if (!r.success) {
    const faltan = r.error.issues.map((i) => `  · ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Configuración inválida:\n${faltan}`);
  }
  return r.data;
}
