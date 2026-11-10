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

/**
 * Lo que se le manda a Google Analytics como `search_term`: recortado a 100
 * caracteres y `null` si parece un email o un número largo (6+ dígitos: DNI,
 * teléfono, tarjeta). Así la analítica no se lleva datos personales.
 */
export function terminoBusqueda(q: string): string | null {
  const t = q.trim().slice(0, 100);
  if (!t || /\S+@\S+/.test(t) || /\d[\d\s.-]*\d/.test(t) && t.replace(/\D/g, "").length >= 6) return null;
  return t;
}
