import {
  CLAVES_MEDIDA, GuiaTalles, infoMedida, MEDIDA_LIBRE, normalizarTalle, ordenarGuia, TALLES_ADULTO, TALLES_NINO,
  type ClaveMedida, type TipoGuia,
} from "@isu/shared";
import type { Celda, Hoja } from "../../lib/xlsx.js";

/*
 * Guías de talles ↔ Excel (etapa 10). Una hoja por guía, como las arma la
 * fábrica:
 *
 *   Medida        | S    | M    | L
 *   Ancho hombro  | 44,5 | 46,5 | 48
 *   Largo prenda  | 71   | 74   | 74,5
 *
 * El nombre de la hoja es el nombre de la guía. La primera fila, los talles;
 * cada fila siguiente, una medida con su valor por talle (un número, "44-46"
 * para un rango, "-" o vacío si no aplica). El tipo sale de los talles: XS a
 * 5XL es adulto, 4 a 16 es niños y cualquier otra cosa (1 a 8 de pantalón,
 * "3 (L)") queda como talles propios.
 *
 * Una medida que se llama como las del sistema ("Contorno de pecho", "Edad")
 * se reconoce y sirve para recomendar talle; cualquier otra ("Ancho muslo")
 * es de la prenda y sólo se muestra.
 */
export interface GuiaExcel { nombre: string; tipo: TipoGuia; medidas: string[]; filas: Array<{ talle: string; valores: Array<[number, number] | null> }>; nota: string | null }

const NOTA_PRENDA = "Medidas de la prenda, en centímetros.";
const sinTildes = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
// Nombres que se reconocen como medidas del sistema (además del nombre exacto de cada una).
const ALIAS_MEDIDA: Record<string, ClaveMedida> = { edad: "edad", "edad (aprox)": "edad", "edad (anos)": "edad", "edad aprox": "edad", altura: "altura", "altura (cm)": "altura" };
const POR_NOMBRE = new Map<string, ClaveMedida>([
  ...CLAVES_MEDIDA.map((c) => [sinTildes(infoMedida(c).nombre), c] as const),
  ...Object.entries(ALIAS_MEDIDA),
]);

/** "44,5" → 44.5 · "44-46" → [44, 46] · "4 años" → 4 · "-" → null. undefined = no se entiende. */
export function leerValor(c: Celda): [number, number] | null | undefined {
  if (c === null) return null;
  if (typeof c === "number") return Number.isFinite(c) && c >= 0 && c <= 300 ? [c, c] : undefined;
  const t = c.trim().replace(/\s+/g, " ");
  if (t === "" || /^[-–—]$/.test(t) || /^n\/?a$/i.test(t)) return null;
  const num = (s: string) => Number(s.replace(",", "."));
  const m = /^(\d{1,3}(?:[.,]\d{1,2})?)(?:\s*(?:-|–|—|a)\s*(\d{1,3}(?:[.,]\d{1,2})?))?(?:\s*(?:cm|años?|anos?))?$/i.exec(t);
  if (!m) return undefined;
  const a = num(m[1]!);
  const b = m[2] ? num(m[2]) : a;
  return a <= b && b <= 300 ? [a, b] : undefined;
}
const escribirValor = (v: [number, number] | null): Celda => {
  if (!v) return "-";
  const f = (n: number) => String(n).replace(".", ",");
  return v[0] === v[1] ? (Number.isInteger(v[0]) ? v[0] : f(v[0])) : `${f(v[0])}-${f(v[1])}`;
};

/** El tipo que corresponde a esos talles. */
export function tipoDeTalles(talles: string[]): TipoGuia {
  const n = talles.map(normalizarTalle);
  if (n.every((t) => (TALLES_ADULTO as readonly string[]).includes(t))) return "adulto";
  if (n.every((t) => (TALLES_NINO as readonly string[]).includes(t))) return "nino";
  return "otro";
}

export function guiasAHojas(guias: GuiaExcel[]): Hoja[] {
  return guias.map((g0) => {
    const g = ordenarGuia(g0);
    return {
      nombre: g.nombre,
      filas: [
        ["Medida", ...g.filas.map((f) => f.talle)],
        ...g.medidas.map((m, i) => [infoMedida(m).nombre, ...g.filas.map((f) => escribirValor(f.valores[i] ?? null))]),
      ],
    };
  });
}

/** Cada hoja a una guía; lo que no se entiende se dice por hoja y esa hoja no se importa. */
export function hojasAGuias(hojas: Hoja[]): { guias: GuiaExcel[]; errores: Array<{ hoja: string; mensaje: string }> } {
  const guias: GuiaExcel[] = [];
  const errores: Array<{ hoja: string; mensaje: string }> = [];
  const vistas = new Set<string>();
  for (const h of hojas) {
    const nombre = h.nombre.trim();
    const mal = (mensaje: string) => errores.push({ hoja: nombre, mensaje });
    const filas = h.filas.filter((f) => f.some((c) => c !== null && String(c).trim() !== ""));
    if (!filas.length) continue; // hoja vacía: se ignora
    if (vistas.has(nombre.toLowerCase())) { mal("Hay dos hojas con el mismo nombre."); continue; }
    vistas.add(nombre.toLowerCase());
    const [cabecera, ...resto] = filas;
    // Los talles: la primera fila desde la columna B, hasta la primera vacía.
    const talles: string[] = [];
    for (const c of cabecera!.slice(1)) {
      const t = c === null ? "" : String(c).trim();
      if (!t) break;
      talles.push(t);
    }
    if (!talles.length) { mal("La primera fila tiene que tener los talles desde la columna B (Medida | S | M | L…)."); continue; }
    const tipo = tipoDeTalles(talles);
    const medidas: string[] = [];
    const columnas: Array<Array<[number, number] | null>> = [];
    let problema: string | null = null;
    for (const f of resto) {
      const etiqueta = f[0] === null ? "" : String(f[0]).replace(/\s+/g, " ").trim();
      if (!etiqueta) { problema = "Hay una fila con valores y sin el nombre de la medida en la columna A."; break; }
      const clave = POR_NOMBRE.get(sinTildes(etiqueta)) ?? etiqueta.slice(0, 40);
      if (!CLAVES_MEDIDA.includes(clave as ClaveMedida) && !MEDIDA_LIBRE.test(clave)) { problema = `"${etiqueta}" no sirve como nombre de medida.`; break; }
      const valores = talles.map((_, i) => leerValor(f[i + 1] ?? null));
      const raro = valores.findIndex((v) => v === undefined);
      if (raro >= 0) { problema = `${etiqueta}, talle ${talles[raro]}: "${f[raro + 1]}" no es una medida (va un número, "44-46" o "-").`; break; }
      medidas.push(clave);
      columnas.push(valores as Array<[number, number] | null>);
    }
    if (problema) { mal(problema); continue; }
    const guia: GuiaExcel = {
      nombre, tipo, medidas,
      filas: talles.map((talle, t) => ({ talle, valores: columnas.map((c) => c[t]!) })),
      nota: medidas.some((m) => infoMedida(m).tipo === "cuerpo" && m !== "edad" && m !== "altura") ? null : NOTA_PRENDA,
    };
    // Las mismas reglas que el editor (talles repetidos, de 1 a 8 medidas, hasta 20 talles…).
    const v = GuiaTalles.safeParse(guia);
    if (!v.success) { mal(v.error.issues[0]?.message ?? "La guía no es válida."); continue; }
    if (guia.filas.every((x) => x.valores.every((y) => y === null))) { mal("No tiene ninguna medida cargada."); continue; }
    guias.push(guia);
  }
  return { guias, errores };
}
