/*
 * Eventos de e-commerce de GA4. Si GA no está cargado (sin ID, bloqueador),
 * no hace nada: nunca rompe la página.
 *
 * Nombres y campos según la especificación de GA4 (view_item_list,
 * select_item, view_item): así los informes de e-commerce salen solos.
 */
import { eventoMeta } from "@isu/shared";

type Item = { item_id: string; item_name: string; price: number; item_variant?: string; item_list_name?: string; index?: number };
declare global { interface Window { gtag?: (...args: unknown[]) => void; fbq?: (...args: unknown[]) => void } }

export function evento(nombre: string, params: Record<string, unknown>) {
  try { window.gtag?.("event", nombre, params); } catch { /* nada */ }
  // El Pixel de Meta (sólo existe si la persona aceptó las cookies): el mismo hecho con el nombre estándar de Meta.
  try { const m = eventoMeta(nombre, params); if (m) window.fbq?.("track", m[0], m[1]); } catch { /* nada */ }
}

/** Centavos → pesos (GA espera el valor en la moneda, no en centavos). */
export const pesos = (c: number) => Math.round(c) / 100;

export function item(p: { slug: string; nombre: string; precio: number }, extra: Partial<Item> = {}): Item {
  return { item_id: p.slug, item_name: p.nombre, price: pesos(p.precio), ...extra };
}
