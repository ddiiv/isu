/*
 * Dónde va cada producto del mayorista en la tienda, tal como lo confirmó
 * ISUWAYA (septiembre 2026). Clave: SKU padre en mayúsculas. Valor: rutas
 * "padre/subcategoría" del árbol de la tienda; un unisex va en las dos.
 *
 * Un SKU que no esté acá (un producto nuevo del mayorista) se ubica solo
 * con proponerCategorias(), igual que lo que llega de Stocker; si no se
 * puede deducir, queda como está y el informe lo avisa.
 */
const H = "hombre", M = "mujer", N = "ninos";

export const CATEGORIAS: Readonly<Record<string, readonly string[]>> = {
  // Hombre › Remeras
  ISUMORREM: [`${H}/remeras`], ISUHENREM: [`${H}/remeras`], ISUCAIREM: [`${H}/remeras`],
  ISUCHAREM: [`${H}/remeras`], ISUSANREM: [`${H}/remeras`], ISUBERREM: [`${H}/remeras`],
  ISUCHEREM: [`${H}/remeras`], ISURAYREM: [`${H}/remeras`], ISUBRIREM: [`${H}/remeras`],
  // Hombre › Pantalones (Bengalina y Morgan, la calza térmica, confirmados de hombre)
  ISULOAPAN: [`${H}/pantalones`], ISUARGPAN: [`${H}/pantalones`], ISURELPAN: [`${H}/pantalones`],
  ISUMICPAN: [`${H}/pantalones`], ISUABEPAN: [`${H}/pantalones`], ISULEGPAN: [`${H}/pantalones`],
  ISUTERPAN: [`${H}/pantalones`], ISUPINPAN: [`${H}/pantalones`], ISUMNTPAN: [`${H}/pantalones`],
  ISUBENPAN: [`${H}/pantalones`], ISUMORPAN: [`${H}/pantalones`],
  // Hombre › Buzos y camperas (Wolf es chaleco: va acá; Comfort buzo, Luxi campera)
  ISUPOLBUZ: [`${H}/buzos-y-camperas`], ISUABYCAM: [`${H}/buzos-y-camperas`], ISUWOLCAM: [`${H}/buzos-y-camperas`],
  ISUCOMBUZ: [`${H}/buzos-y-camperas`], ISULUXBUZ: [`${H}/buzos-y-camperas`],
  // Hombre › Shorts y bermudas
  ISUFLUSHO: [`${H}/shorts-y-bermudas`], ISUMORSHO: [`${H}/shorts-y-bermudas`], ISUAKISHO: [`${H}/shorts-y-bermudas`],
  ISUSTRSHO: [`${H}/shorts-y-bermudas`], ISURUMSHO: [`${H}/shorts-y-bermudas`], ISUIBISHO: [`${H}/shorts-y-bermudas`],
  // Mujer › Remeras y tops
  ISUBABREM: [`${M}/remeras-y-tops`], ISUBRAREM: [`${M}/remeras-y-tops`], ISUMIRREM: [`${M}/remeras-y-tops`],
  ISUNIRREM: [`${M}/remeras-y-tops`], ISUBREREM: [`${M}/remeras-y-tops`], ISUSOFREM: [`${M}/remeras-y-tops`],
  ISUCRUREM: [`${M}/remeras-y-tops`], ISUCLOREM: [`${M}/remeras-y-tops`], ISUSASREM: [`${M}/remeras-y-tops`],
  ISUVISREM: [`${M}/remeras-y-tops`], ISUZARREM: [`${M}/remeras-y-tops`],
  // Mujer › Pantalones y calzas
  ISUOXFPAN: [`${M}/pantalones-y-calzas`], ISUORIPAN: [`${M}/pantalones-y-calzas`], ISUNIZPAN: [`${M}/pantalones-y-calzas`],
  ISUFRIPAN: [`${M}/pantalones-y-calzas`], ISUROMPAN: [`${M}/pantalones-y-calzas`], ISUSIDPAN: [`${M}/pantalones-y-calzas`],
  // Mujer › Buzos y camperas (Verona tiene SKU de pantalón pero es un buzo)
  ISULOICAM: [`${M}/buzos-y-camperas`], ISUKYRCAM: [`${M}/buzos-y-camperas`], ISUVERPAN: [`${M}/buzos-y-camperas`],
  ISUMAECAM: [`${M}/buzos-y-camperas`],
  // Mujer › Shorts y bermudas
  ISUBIKSHO: [`${M}/shorts-y-bermudas`], ISUCITSHO: [`${M}/shorts-y-bermudas`], ISUSOHSHO: [`${M}/shorts-y-bermudas`],
  ISUGUEBER: [`${M}/shorts-y-bermudas`],
  // Unisex: en Hombre y en Mujer
  ISUFLUPAN: [`${H}/pantalones`, `${M}/pantalones-y-calzas`],
  ISUMONBUZ: [`${H}/buzos-y-camperas`, `${M}/buzos-y-camperas`],
  ISUMONCAM: [`${H}/buzos-y-camperas`, `${M}/buzos-y-camperas`],
  ISUDETSHO: [`${H}/shorts-y-bermudas`, `${M}/shorts-y-bermudas`],
  ISUFLEBER: [`${H}/shorts-y-bermudas`, `${M}/shorts-y-bermudas`],
  // Niños
  ISUJUNREM: [`${N}/remeras`], ISUKIDREM: [`${N}/remeras`],
  ISUBOXPAN: [`${N}/pantalones`], ISUMALPAN: [`${N}/pantalones`], ISUMATPAN: [`${N}/pantalones`], ISUMONPAN: [`${N}/pantalones`],
  ISUMISCAM: [`${N}/camperas`],
  ISUGARSHO: [`${N}/shorts`], ISULETSHO: [`${N}/shorts`], ISUMARSHO: [`${N}/shorts`],
};

export interface Ajuste {
  /** Color del mayorista → cómo se llama (y se ve) en la tienda. El nombre queda fijo. */
  colores?: Readonly<Record<string, { nombre: string; hex: string }>>;
  /** Sólo estos talles se venden en la tienda; el resto queda oculto (existe en Stocker). */
  soloTalles?: readonly string[];
}

export const AJUSTES: Readonly<Record<string, Ajuste>> = {
  // En Stocker y en el mayorista el color es "Único": la campera es negra.
  ISUABYCAM: { colores: { "Único": { nombre: "Negro", hex: "#111111" } } },
  // Se vende en talle único (las medidas van en la guía de talles).
  ISUCLOREM: { soloTalles: ["Único"] },
};
