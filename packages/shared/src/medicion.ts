/*
 * Pixel de Meta y Microsoft Clarity: los IDs válidos y cómo se traducen los eventos de GA4 a los de Meta.
 * Sin ID no se carga nada; con ID, recién cuando la persona acepta las cookies.
 */
export const idMeta = (v: string | undefined) => (v && /^\d{8,20}$/.test(v) ? v : null);
export const idClarity = (v: string | undefined) => (v && /^[a-z0-9]{8,12}$/.test(v) ? v : null);

type ItemGa = { item_id?: unknown; quantity?: unknown };

/** El mismo identificador en el navegador y en la API de conversiones: así Meta cuenta la compra una sola vez. */
export const idEventoCompra = (numero: string) => `purchase-${numero}`;

/** El evento de GA4 → [evento estándar de Meta, parámetros, id del evento]; null si Meta no lo necesita. */
export function eventoMeta(nombre: string, p: Record<string, unknown>): [string, Record<string, unknown>, string?] | null {
  const items = (Array.isArray(p.items) ? p.items : []) as ItemGa[];
  const ids = items.map((i) => String(i.item_id ?? "")).filter(Boolean);
  const comun = { content_type: "product", content_ids: ids, currency: "ARS", ...(typeof p.value === "number" ? { value: p.value } : {}) };
  switch (nombre) {
    case "view_item": return ["ViewContent", comun];
    case "add_to_cart": return ["AddToCart", comun];
    case "begin_checkout": return ["InitiateCheckout", { ...comun, num_items: items.reduce((a, i) => a + (Number(i.quantity) || 1), 0) }];
    case "purchase": return ["Purchase", { ...comun, num_items: items.reduce((a, i) => a + (Number(i.quantity) || 1), 0) }, typeof p.transaction_id === "string" ? idEventoCompra(p.transaction_id) : undefined];
    case "search": return typeof p.search_term === "string" ? ["Search", { search_string: p.search_term.slice(0, 100) }] : null;
    default: return null;
  }
}
