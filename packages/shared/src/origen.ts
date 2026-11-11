/*
 * De dónde llegó cada compra: UTM, click id o sitio de referencia. Sin zod
 * (lo usa el navegador). Se guarda sólo texto corto y limpio; de los click id
 * (gclid, fbclid) sólo que existieron, NUNCA el valor.
 */
export interface Origen { fuente?: string; medio?: string; campana?: string; contenido?: string; referido?: string; gclid?: boolean }
export type OrigenGuardado = Origen & { fecha: number };

/** Lo que se usa de URLSearchParams (el paquete no trae los tipos del navegador). */
type Params = { get(k: string): string | null; has(k: string): boolean };

export const VENCE_ORIGEN_MS = 30 * 24 * 3600 * 1000;

/** Minúsculas, sólo [a-z0-9._-] (lo demás se descarta), hasta 60. Vacío: undefined. */
export function limpiarOrigen(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  return v.toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 60) || undefined;
}

const sinVacios = (o: Origen): Origen => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Origen;

/** Lo que trae la URL: UTM o click id. null si no hay campaña. */
export function origenDeUrl(p: Params): Origen | null {
  const o = sinVacios({
    fuente: limpiarOrigen(p.get("utm_source")), medio: limpiarOrigen(p.get("utm_medium")),
    campana: limpiarOrigen(p.get("utm_campaign")), contenido: limpiarOrigen(p.get("utm_content")),
    gclid: p.has("gclid") || p.has("fbclid") ? true : undefined,
  });
  return Object.keys(o).length ? o : null;
}

/** Hostname del referrer si es de otro sitio (sin ruta ni query, sin «www.»). */
export function referidoDe(referrer: string, hostPropio: string): string | undefined {
  const h = /^https?:\/\/([^/?#:@]+)/i.exec(referrer)?.[1]?.toLowerCase().replace(/^www\./, "");
  return h && h !== hostPropio.toLowerCase().replace(/^www\./, "") ? limpiarOrigen(h) : undefined;
}

/** Revalida lo guardado (viene del navegador: puede estar roto o viejo). null si no sirve o venció. */
export function origenVigente(g: unknown, ahora: number): Origen | null {
  if (!g || typeof g !== "object") return null;
  const r = g as Record<string, unknown>;
  if (typeof r.fecha !== "number" || ahora - r.fecha > VENCE_ORIGEN_MS || r.fecha > ahora + 60_000) return null;
  const o = sinVacios({
    fuente: limpiarOrigen(r.fuente), medio: limpiarOrigen(r.medio), campana: limpiarOrigen(r.campana),
    contenido: limpiarOrigen(r.contenido), referido: limpiarOrigen(r.referido), gclid: r.gclid === true ? true : undefined,
  });
  return Object.keys(o).length ? o : null;
}

/**
 * Qué guardar en esta carga, o null si no hay que tocar nada: una campaña en la
 * URL gana siempre (último origen con campaña); sin campaña, sólo la primera
 * visita anota el sitio de referencia.
 */
export function origenAGuardar(guardado: unknown, p: Params, referrer: string, hostPropio: string, ahora: number): OrigenGuardado | null {
  const campana = origenDeUrl(p);
  if (campana) return { ...campana, fecha: ahora };
  if (origenVigente(guardado, ahora)) return null;
  const referido = referidoDe(referrer, hostPropio);
  return referido ? { referido, fecha: ahora } : null;
}
