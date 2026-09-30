/*
 * Destino del botón "Mayorista": la variable MAYORISTA_URL (se cambia desde
 * Railway). Sólo http(s): una variable mal cargada ("javascript:…") no se sigue.
 */
const RESPALDO = "https://www.isuwaya.com";

export function destinoMayorista(valor = process.env.MAYORISTA_URL): string {
  try {
    const u = new URL((valor ?? "").trim());
    if (u.protocol === "https:" || u.protocol === "http:") return u.toString();
  } catch { /* vacía o inválida */ }
  return RESPALDO;
}
