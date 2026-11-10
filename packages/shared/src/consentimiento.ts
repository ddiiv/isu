/* Elección de cookies de la tienda (Google Consent Mode v2). Se guarda en localStorage `isu:consent`. */
export type EleccionCookies = "granted" | "denied";

export const CLAVE_CONSENTIMIENTO = "isu:consent";

/** Valida lo guardado: cualquier cosa que no sea una elección conocida cuenta como "sin elegir". */
export function leerEleccion(guardado: unknown): EleccionCookies | null {
  return guardado === "granted" || guardado === "denied" ? guardado : null;
}

/** Los 4 valores que Consent Mode v2 espera en `gtag('consent', ...)`. */
export function valoresConsentimiento(eleccion: EleccionCookies) {
  return { ad_storage: eleccion, ad_user_data: eleccion, ad_personalization: eleccion, analytics_storage: eleccion };
}
