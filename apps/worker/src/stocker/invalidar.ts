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

/** Cada pedido a /api/revalidar admite hasta 501 etiquetas («catalogo» y 500 productos). */
const POR_PEDIDO = 500;

export function crearInvalidador(o: { redis: Redis; webUrl?: string; token?: string; log?: Pick<Console, "warn">; repasoMs?: number }): Invalidador {
  const log = o.log ?? console;
  const repasoMs = o.repasoMs ?? 2_500;
  const avisarWeb = async (etiquetas: string[]) => {
    try {
      const r = await fetch(`${o.webUrl!.replace(/\/+$/, "")}/api/revalidar`, {
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

  /*
   * Repaso (etapa 12): una página que se estaba regenerando con los datos de
   * antes del cambio puede terminar DESPUÉS del aviso, y Next la guarda como
   * nueva: quedaría vieja hasta que venza (5 minutos). Un segundo aviso, unos
   * segundos después, la vuelve a vencer. No frena la cola (va aparte) y los
   * cambios seguidos se juntan en un solo repaso.
   */
  let pendientes: Set<string> | null = null;
  const repasar = (etiquetas: string[]) => {
    if (repasoMs <= 0) return;
    if (pendientes) { for (const e of etiquetas) pendientes.add(e); return; }
    pendientes = new Set(etiquetas);
    setTimeout(() => {
      const productos = [...pendientes!].filter((e) => e !== "catalogo");
      pendientes = null;
      void (async () => {
        if (!productos.length) return avisarWeb(["catalogo"]);
        for (let i = 0; i < productos.length; i += POR_PEDIDO) await avisarWeb(["catalogo", ...productos.slice(i, i + POR_PEDIDO)]);
      })();
    }, repasoMs).unref();
  };

  return async (slugs) => {
    const etiquetas = ["catalogo", ...slugs.slice(0, POR_PEDIDO).map((s) => `producto:${s}`)];
    await o.redis.publish(CANAL_INVALIDAR, JSON.stringify({ etiquetas })).catch(() => 0);
    if (!o.webUrl || !o.token) return;
    // La API tiene que haber tirado su caché antes de que la web le vuelva a pedir.
    await new Promise((r) => setTimeout(r, 250));
    await avisarWeb(etiquetas);
    repasar(etiquetas);
  };
}
