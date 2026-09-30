import { normalizar } from "./texto.js";

/*
 * Nombre de color (como lo cargan en Stocker) → hex para la muestrita.
 *
 * Stocker guarda el color como texto libre ("Negro", "Verde Militar",
 * "Blanco/Negro"). La tienda necesita un círculo de color: se deduce de acá
 * y el backoffice puede corregirlo. Lo que no se reconoce queda sin hex y se
 * muestra con su nombre.
 */
const COLORES: Record<string, string> = {
  negro: "#111111", blanco: "#ffffff", "blanco roto": "#f4f1ea", crudo: "#efe8d8", natural: "#efe8d8",
  hueso: "#e9e2d0", marfil: "#f6f1e1", beige: "#d8c3a5", arena: "#d6c4a3", camel: "#b98a55", nude: "#e3bc9a",
  gris: "#8a8a8a", "gris claro": "#c9c9c9", "gris topo": "#6f6259", "gris melange": "#a7a7a7", melange: "#a7a7a7",
  topo: "#6f6259", plomo: "#5d6166", "gris oscuro": "#4a4a4a", grafito: "#3b3b3b", antracita: "#2f3337",
  azul: "#1f3f8f", "azul marino": "#1b2440", marino: "#1b2440", "azul francia": "#2a4fb8", francia: "#2a4fb8",
  celeste: "#8ec5ea", "celeste bebe": "#bfe0f5", petroleo: "#1e5563", turquesa: "#2bb3b1", aqua: "#6fd3cf",
  jean: "#4a6a94", denim: "#4a6a94", indigo: "#34406b",
  verde: "#2e7d4f", "verde militar": "#4b5320", militar: "#4b5320", oliva: "#6b6b32", "verde oliva": "#6b6b32",
  "verde agua": "#9fd8c6", "verde manzana": "#8cc63f", menta: "#a8e6cf", "verde botella": "#1f4d36", esmeralda: "#1f8a5b",
  rojo: "#c62828", bordo: "#6d1a2a", borravino: "#6d1a2a", vino: "#6d1a2a", cereza: "#9b1b30", coral: "#f27a6b",
  rosa: "#f2a7bd", "rosa viejo": "#c98b95", "rosa chicle": "#ff6fae", fucsia: "#d6247a", salmon: "#f4a38c",
  lila: "#c7a4d8", lavanda: "#c9b8e8", violeta: "#6a3fa0", uva: "#5b2a6e", morado: "#5b2a6e",
  amarillo: "#f5d33a", mostaza: "#d4a52a", "amarillo pastel": "#f7e6a0", naranja: "#f28c28", terracota: "#b8573e",
  ladrillo: "#a14a33", oxido: "#a4532b", marron: "#6b4226", chocolate: "#4e2e1e", cafe: "#5a3a26", suela: "#9a6a3a",
  habano: "#8a5a36", tostado: "#a0703f", visón: "#8c7b6b", vison: "#8c7b6b", caqui: "#b3a47a", kaki: "#b3a47a",
  dorado: "#c9a33b", plateado: "#c0c0c0",
};

/* "Negro/Blanco", "Negro - Blanco", "Negro y blanco": se toma el primero. */
const SEPARADOR = /\s*(?:\/|-|\+|,|\sy\s|\scon\s)\s*/;

export function hexDeColor(nombre: string | null | undefined): string | null {
  if (!nombre) return null;
  const n = normalizar(nombre);
  if (Object.hasOwn(COLORES, n)) return COLORES[n] ?? null;
  const primero = n.split(SEPARADOR)[0] ?? "";
  if (Object.hasOwn(COLORES, primero)) return COLORES[primero] ?? null;
  // "Remera negro" / "Negro liso": la primera palabra que sea un color.
  for (const palabra of n.split(" ")) if (Object.hasOwn(COLORES, palabra)) return COLORES[palabra] ?? null;
  return null;
}

/** ¿Es un color claro? Para elegir el borde de la muestrita (un blanco sobre blanco no se ve). */
export function esClaro(hex: string): boolean {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return false;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x ?? "0", 16));
  return 0.299 * (r ?? 0) + 0.587 * (g ?? 0) + 0.114 * (b ?? 0) > 200;
}
