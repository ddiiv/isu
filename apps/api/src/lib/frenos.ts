import type { Redis } from "ioredis";
import { ErrorHttp } from "./errores.js";

/*
 * Frenos puntuales para lo que se puede abusar aunque venga de la propia
 * tienda (que no cuenta para el límite general): ingresar, registrarse,
 * pedir otra contraseña, crear pedidos, subir comprobantes.
 *
 * Cuenta en Redis (vale entre réplicas). Si Redis no responde, deja pasar:
 * el bloqueo por cuenta en la base sigue protegiendo el ingreso.
 */
export async function frenar(redis: Redis, nombre: string, clave: string, max: number, ventanaSeg: number) {
  const k = `isu:freno:${nombre}:${clave}`;
  let n: number;
  try {
    n = await redis.incr(k);
    if (n === 1) await redis.expire(k, ventanaSeg);
  } catch {
    return;
  }
  if (n > max) {
    const ttl = await redis.ttl(k).catch(() => ventanaSeg);
    const minutos = Math.max(1, Math.ceil(Math.max(ttl, 1) / 60));
    throw Object.assign(new ErrorHttp(429, "demasiados_intentos", `Demasiados intentos. Probá de nuevo en ${minutos} minuto${minutos === 1 ? "" : "s"}.`), { reintentarEn: Math.max(ttl, 1) });
  }
}
