import type { Redis } from "ioredis";

/*
 * Después de un cambio de catálogo o stock:
 *
 *   1. Se avisa a las réplicas de la API (Redis pub/sub) para que tiren su
 *      caché de memoria.
 *   2. Se le pide a la web que regenere las páginas afectadas (ISR por
 *      etiquetas). Sin esto, una prenda agotada seguiría apareciendo con
 *      stock hasta que venciera la página.
 *
 * Si la web no contesta, no es grave: las páginas vencen solas a los pocos
 * minutos. Nunca hace fallar la sincronización.
 */
export const CANAL_INVALIDAR = "isu:invalidar";

export interface Invalidador {
  (slugs: string[]): Promise<void>;
}

export function crearInvalidador(o: { redis: Redis; webUrl?: string; token?: string; log?: Pick<Console, "warn"> }): Invalidador {
  const log = o.log ?? console;
  return async (slugs) => {
    const etiquetas = ["catalogo", ...slugs.slice(0, 500).map((s) => `producto:${s}`)];
    await o.redis.publish(CANAL_INVALIDAR, JSON.stringify({ etiquetas })).catch(() => 0);
    if (!o.webUrl || !o.token) return;
    // La API tiene que haber tirado su caché antes de que la web le vuelva a pedir.
    await new Promise((r) => setTimeout(r, 250));
    try {
      const r = await fetch(`${o.webUrl.replace(/\/+$/, "")}/api/revalidar`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${o.token}` },
        body: JSON.stringify({ etiquetas }),
        signal: AbortSignal.timeout(5_000),
        redirect: "error",
      });
      if (!r.ok) log.warn(`[invalidar] la web contestó ${r.status}`);
    } catch (e) {
      log.warn(`[invalidar] la web no responde: ${(e as Error).message}`);
    }
  };
}
