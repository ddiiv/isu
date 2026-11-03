import type { GuiaPublica } from "./guias.js";

/*
 * Guías de talles, como las de Mercado Libre.
 *
 * Cada prenda mide distinto (una remera oversize y una ajustada no tienen el
 * mismo "M"), así que no hay una tabla única: hay guías, y cada producto se
 * asocia a la suya. Una guía es de niños (4 a 16) o de adultos (XS a 5XL),
 * elige qué medidas muestra y tiene una fila por talle con un rango en cm.
 *
 * Medidas "del cuerpo" (pecho, cintura, cadera, altura…) sirven para
 * recomendar el talle a partir de las medidas del cliente. Medidas "de la
 * prenda" (largo, manga…) sólo se muestran.
 *
 * Etapa 10: para traer las guías tal como las tiene la fábrica (Excel):
 *   · tipo "otro": talles libres (1 a 8 de pantalón, "3 (L)", 2 y XL…), en el
 *     orden en que se cargan;
 *   · medidas con nombre propio ("Ancho muslo", "Bota"): son de la prenda,
 *     sólo se muestran y no se usan para recomendar.
 */
export const TALLES_NINO = ["4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16"] as const;
export const TALLES_NINO_HABITUALES = ["4", "6", "8", "10", "12", "14", "16"] as const;
export const TALLES_ADULTO = ["XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL", "5XL"] as const;
export const TIPOS_GUIA = ["nino", "adulto", "otro"] as const;
export type TipoGuia = (typeof TIPOS_GUIA)[number];
export const NOMBRE_TIPO_GUIA: Record<TipoGuia, string> = { adulto: "Adulto XS–5XL", nino: "Niños 4–16", otro: "Talles propios" };

/** La escala del tipo; "otro" no tiene escala fija (vacío = cualquier talle). */
export const tallesDeTipo = (t: TipoGuia): readonly string[] => (t === "nino" ? TALLES_NINO : t === "adulto" ? TALLES_ADULTO : []);

export const MEDIDAS = {
  altura: { nombre: "Altura", tipo: "cuerpo", ayuda: "Descalzo, de la cabeza al piso." },
  edad: { nombre: "Edad (años)", tipo: "cuerpo", ayuda: "Orientativa: mejor guiarse por la altura." },
  pecho: { nombre: "Contorno de pecho", tipo: "cuerpo", ayuda: "Rodeá la parte más ancha del pecho, por debajo de las axilas." },
  cintura: { nombre: "Contorno de cintura", tipo: "cuerpo", ayuda: "Rodeá la cintura a la altura del ombligo, sin apretar." },
  cadera: { nombre: "Contorno de cadera", tipo: "cuerpo", ayuda: "Rodeá la parte más ancha de la cola, con los pies juntos." },
  ancho: { nombre: "Ancho de la prenda", tipo: "prenda", ayuda: "Con la prenda estirada, de axila a axila." },
  largo: { nombre: "Largo total", tipo: "prenda", ayuda: "Desde el punto más alto del hombro hasta el ruedo." },
  hombros: { nombre: "Ancho de hombros", tipo: "prenda", ayuda: "De costura a costura del hombro." },
  manga: { nombre: "Largo de manga", tipo: "prenda", ayuda: "Desde la costura del hombro hasta el puño." },
  tiro: { nombre: "Tiro", tipo: "prenda", ayuda: "Desde la entrepierna hasta la cintura, por delante." },
  entrepierna: { nombre: "Largo de entrepierna", tipo: "prenda", ayuda: "Desde la entrepierna hasta el ruedo." },
} as const;
export type ClaveMedida = keyof typeof MEDIDAS;
export const CLAVES_MEDIDA = Object.keys(MEDIDAS) as [ClaveMedida, ...ClaveMedida[]];
/** Las que el cliente puede cargar para que le recomendemos un talle. */
export const MEDIDAS_CUERPO = CLAVES_MEDIDA.filter((c) => MEDIDAS[c].tipo === "cuerpo");

/** Una medida con nombre propio ("Ancho muslo"): letras, números y signos comunes. */
export const MEDIDA_LIBRE = /^[\p{L}\p{N}][\p{L}\p{N} .,()/'°-]{1,39}$/u;
export const esClaveMedida = (m: string): m is ClaveMedida => Object.hasOwn(MEDIDAS, m);
/** Nombre, tipo y ayuda de una medida (las de nombre propio son de la prenda). */
export function infoMedida(m: string): { nombre: string; tipo: "cuerpo" | "prenda"; ayuda: string } {
  return esClaveMedida(m) ? MEDIDAS[m] : { nombre: m, tipo: "prenda", ayuda: "" };
}

/* "t. xl", "Talle 2XL", "xxxl" → la forma de la guía ("XL", "XXL", "3XL"). */
const ALIAS: Record<string, string> = { "2XL": "XXL", XXXL: "3XL", XXXXL: "4XL", XXXXXL: "5XL", EXTRASMALL: "XS", SMALL: "S", MEDIUM: "M", LARGE: "L" };
export function normalizarTalle(t: string | null | undefined): string {
  let n = (t ?? "").trim().toUpperCase().replace(/^(TALLE|TALLA|T\.?)\s*/, "").replace(/\s+/g, "");
  if (/^\d+$/.test(n)) n = String(Number(n));
  return ALIAS[n] ?? n;
}

/** Ordena las filas por la escala del tipo y normaliza los nombres de talle ("otro": como se cargaron). */
export function ordenarGuia<T extends { tipo: TipoGuia; filas: Array<{ talle: string }> }>(g: T): T {
  if (g.tipo === "otro") return { ...g, filas: g.filas.map((f) => ({ ...f, talle: f.talle.trim() })) };
  const escala = tallesDeTipo(g.tipo);
  const filas = g.filas.map((f) => ({ ...f, talle: normalizarTalle(f.talle) }))
    .sort((a, b) => escala.indexOf(a.talle) - escala.indexOf(b.talle));
  return { ...g, filas };
}

/** Orden de talles para mostrar: numéricos por valor, letras por la escala de siempre, el resto al final. */
const ESCALA = ["xxs", "xs", "s", "m", "l", "xl", "xxl", "2xl", "xxxl", "3xl", "4xl", "5xl", "6xl"];
export function ordenTalle(t: string): number {
  const n = t.trim().toLowerCase();
  const i = ESCALA.indexOf(n);
  if (i >= 0) return 1000 + i;
  const num = Number(n.replace(",", "."));
  if (Number.isFinite(num)) return num;
  if (n === "unico" || n === "único" || n === "u") return 2000;
  return 3000;
}
export const compararTalles = (a: string, b: string) => ordenTalle(a) - ordenTalle(b) || a.localeCompare(b, "es");

export type MedidasCliente = Partial<Record<ClaveMedida, number>>;

/*
 * ¿Qué talle le va? Para cada fila se suma cuánto se sale cada medida del
 * cliente del rango de ese talle (0 si cae adentro), relativo a la medida.
 * Gana la fila que menos se sale. Si está justo entre dos, el más grande
 * (se prefiere que quede cómodo). Si ni el talle más grande o el más chico
 * le quedan cerca (> 6 %), se avisa en vez de recomendar cualquier cosa.
 */
export interface Recomendacion { talle: string | null; exacto: boolean; motivo: "ok" | "sin_medidas" | "chico" | "grande" }
export function recomendarTalle(g: Pick<GuiaPublica, "medidas" | "filas">, cliente: MedidasCliente): Recomendacion {
  const usadas = g.medidas.map((m, i) => ({ i, clave: m.clave as ClaveMedida, tipo: m.tipo }))
    .filter((m) => m.tipo === "cuerpo" && esClaveMedida(m.clave) && typeof cliente[m.clave] === "number" && (cliente[m.clave] ?? 0) > 0);
  if (!usadas.length || !g.filas.length) return { talle: null, exacto: false, motivo: "sin_medidas" };
  let mejor: { talle: string; error: number; idx: number } | null = null;
  let menor = 0, mayor = 0;
  g.filas.forEach((f, idx) => {
    let error = 0;
    let comparadas = 0;
    for (const u of usadas) {
      const r = f.valores[u.i];
      if (!r) continue;
      const v = cliente[u.clave]!;
      comparadas++;
      if (v < r[0]) { error += (r[0] - v) / v; if (idx === 0) menor = Math.max(menor, (r[0] - v) / v); }
      else if (v > r[1]) { error += (v - r[1]) / v; if (idx === g.filas.length - 1) mayor = Math.max(mayor, (v - r[1]) / v); }
    }
    if (!comparadas) return;
    // `<=`: en un empate gana el más grande (las filas vienen de chico a grande).
    if (!mejor || error <= mejor.error + 1e-9) mejor = { talle: f.talle, error, idx };
  });
  if (!mejor) return { talle: null, exacto: false, motivo: "sin_medidas" };
  const m = mejor as { talle: string; error: number; idx: number };
  if (m.idx === g.filas.length - 1 && mayor > 0.06) return { talle: null, exacto: false, motivo: "grande" };
  if (m.idx === 0 && menor > 0.06) return { talle: null, exacto: false, motivo: "chico" };
  return { talle: m.talle, exacto: m.error === 0, motivo: "ok" };
}
