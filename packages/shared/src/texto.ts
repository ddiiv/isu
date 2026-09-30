/*
 * Texto → formas normalizadas (para comparar, buscar y armar URLs).
 */

/** Minúsculas, sin tildes ni diéresis, espacios colapsados. "  Remera  Básica " → "remera basica". */
export function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** "Remera Oversize Ñandú 100%" → "remera-oversize-nandu-100". Vacío → "". */
export function aSlug(s: string, max = 80): string {
  const base = normalizar(s)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base.slice(0, max).replace(/-+$/g, "");
}
