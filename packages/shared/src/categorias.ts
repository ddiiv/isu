import { normalizar } from "./texto.js";

/*
 * Categoría y género de Stocker → categorías de la tienda.
 *
 * Stocker tiene categoría ("Remeras", "Buzo canguro") y género ("Hombre",
 * "Unisex") como texto libre. La tienda tiene un árbol de dos niveles
 * (Hombre › Remeras). Esto propone dónde va cada producto; el backoffice
 * puede corregirlo y, una vez corregido, la sincronización no lo toca.
 *
 * Devuelve slugs [padre, hija?]; el que llama los resuelve contra el árbol
 * real (si una subcategoría no existe, el producto queda en la de arriba).
 */

const GENEROS: Array<[RegExp, string[]]> = [
  [/\b(unisex|ambos)\b/, ["hombre", "mujer"]],
  [/\b(nin[oa]s?|kids?|infantil|chicos?|bebes?|junior)\b/, ["ninos"]],
  [/\b(hombres?|masculino|caballeros?|varon|men)\b/, ["hombre"]],
  [/\b(mujer(es)?|femenino|damas?|women)\b/, ["mujer"]],
];

/*
 * Tipo de prenda → subcategoría según el padre. El orden importa: "buzo
 * pantalón" no existe, pero "conjunto buzo y pantalón" sí, y va a buzos.
 */
const TIPOS: Array<[RegExp, Record<string, string>]> = [
  [/\b(buzos?|camperas?|canguros?|hoodies?|chalecos?|camperon|parkas?|sweaters?|sacos?|cardigans?)\b/,
    { hombre: "buzos-y-camperas", mujer: "buzos-y-camperas", ninos: "camperas" }],
  [/\b(shorts?|bermudas?|mallas?)\b/,
    { hombre: "shorts-y-bermudas", mujer: "shorts-y-bermudas", ninos: "shorts" }],
  [/\b(pantalon(es)?|joggers?|calzas?|jeans?|babuchas?|chupines?|leggings?|cargos?|palazzos?)\b/,
    { hombre: "pantalones", mujer: "pantalones-y-calzas", ninos: "pantalones" }],
  [/\b(remeras?|musculosas?|tops?|chombas?|camisas?|camisetas?|blusas?|bodys?|crop)\b/,
    { hombre: "remeras", mujer: "remeras-y-tops", ninos: "remeras" }],
];

export function generosDe(genero: string | null | undefined, titulo = ""): string[] {
  for (const fuente of [genero ?? "", titulo]) {
    const n = normalizar(fuente);
    if (!n) continue;
    for (const [re, destino] of GENEROS) if (re.test(n)) return destino;
  }
  return [];
}

/** [[padre, hija|null], …] — una entrada por género. Vacío si no se pudo deducir el género. */
export function proponerCategorias(
  categoria: string | null | undefined,
  genero: string | null | undefined,
  titulo: string,
): Array<[string, string | null]> {
  const padres = generosDe(genero, titulo);
  let tipo: Record<string, string> | null = null;
  for (const fuente of [categoria ?? "", titulo]) {
    const n = normalizar(fuente);
    const hit = TIPOS.find(([re]) => re.test(n));
    if (hit) { tipo = hit[1]; break; }
  }
  return padres.map((p) => [p, tipo?.[p] ?? null]);
}
