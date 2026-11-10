import { z } from "zod";
import { cpEnRangos } from "./envios.js";

/*
 * Direcciones en el checkout (etapa 11).
 *
 *   · Sugerencias mientras se escribe la calle (Google Places): se elige una
 *     y se completan calle, número, código postal, localidad y provincia.
 *   · Revisión con Georef (servicio público y gratis del Gobierno): con la
 *     dirección completa, dice si la calle y la altura existen y, si hay un
 *     error de tipeo, propone la oficial ("¿Quisiste decir…?").
 *
 * Las dos son ayudas: si no responden, el checkout sigue igual y la
 * dirección se carga a mano.
 */

/** Las provincias del checkout con su código oficial (INDEC), el que entiende Georef. */
export const PROVINCIAS: ReadonlyArray<{ nombre: string; codigo: string }> = [
  { nombre: "CABA", codigo: "02" }, { nombre: "Buenos Aires", codigo: "06" }, { nombre: "Catamarca", codigo: "10" },
  { nombre: "Chaco", codigo: "22" }, { nombre: "Chubut", codigo: "26" }, { nombre: "Córdoba", codigo: "14" },
  { nombre: "Corrientes", codigo: "18" }, { nombre: "Entre Ríos", codigo: "30" }, { nombre: "Formosa", codigo: "34" },
  { nombre: "Jujuy", codigo: "38" }, { nombre: "La Pampa", codigo: "42" }, { nombre: "La Rioja", codigo: "46" },
  { nombre: "Mendoza", codigo: "50" }, { nombre: "Misiones", codigo: "54" }, { nombre: "Neuquén", codigo: "58" },
  { nombre: "Río Negro", codigo: "62" }, { nombre: "Salta", codigo: "66" }, { nombre: "San Juan", codigo: "70" },
  { nombre: "San Luis", codigo: "74" }, { nombre: "Santa Cruz", codigo: "78" }, { nombre: "Santa Fe", codigo: "82" },
  { nombre: "Santiago del Estero", codigo: "86" }, { nombre: "Tierra del Fuego", codigo: "94" }, { nombre: "Tucumán", codigo: "90" },
];
export const NOMBRES_PROVINCIAS = PROVINCIAS.map((p) => p.nombre);

/** Sin tildes, en minúscula y sin espacios de más: para comparar nombres. */
export const sinTildes = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

/** "Ciudad Autónoma de Buenos Aires", "Provincia de Buenos Aires", "Tierra del Fuego, Antártida…" → el nombre del checkout. */
export function provinciaDelCheckout(nombre: string | null | undefined): string | null {
  const n = sinTildes(nombre ?? "").replace(/^provincia de /, "");
  if (!n) return null;
  if (/ciudad (autonoma )?de buenos aires|capital federal|^caba$/.test(n)) return "CABA";
  if (n.startsWith("tierra del fuego")) return "Tierra del Fuego";
  return PROVINCIAS.find((p) => sinTildes(p.nombre) === n)?.nombre ?? null;
}

/*
 * Rangos del código postal argentino (los 4 números) por provincia. Donde dos
 * provincias comparten rango (la frontera de la Pampa húmeda, el Litoral, el
 * Norte) el código es de las dos: se devuelven las dos y no se le marca nada
 * a quien eligió cualquiera. Es una ayuda: ante la duda, rangos anchos.
 */
const RANGOS_CP: Readonly<Record<string, string>> = {
  CABA: "1000-1499",
  "Buenos Aires": "1600-1999,2700-2999,6000-6799,7000-8199,8500-8519",
  Catamarca: "4139,4700-4799,5260-5269,5340-5359",
  Chaco: "3500-3799",
  Chubut: "9000-9299",
  Córdoba: "2100-2199,2400-2699,5000-5299,5800-5999,6100-6299",
  Corrientes: "3190-3349,3400-3499",
  "Entre Ríos": "2820-3299",
  Formosa: "3600-3639",
  Jujuy: "4500-4699",
  "La Pampa": "6200-6399,8200-8299",
  "La Rioja": "5300-5399,5470-5479",
  Mendoza: "5500-5699",
  Misiones: "3300-3399",
  Neuquén: "8300-8399,8407",
  "Río Negro": "8300-8599",
  Salta: "4190-4199,4400-4599",
  "San Juan": "5400-5499",
  "San Luis": "5700-5799,5880-5889,6216,6277-6279",
  "Santa Cruz": "9000-9099,9300-9409",
  "Santa Fe": "2000-2999,3000-3099,3500-3599,6100-6119",
  "Santiago del Estero": "2354,3700-3799,4200-4399,5250-5259",
  "Tierra del Fuego": "9410-9499",
  Tucumán: "4000-4199",
};

/**
 * De qué provincia(s) es un código postal ("1704", o el CPA "B1704ABC").
 * Vacío si no existe en ninguna: ahí conviene pedir que lo revise.
 */
export function provinciasDelCP(cp: string): string[] {
  const t = cp.trim();
  const n = /^([A-Za-z]\d{4}[A-Za-z]{3}|\d{4})$/.test(t) ? /\d{4}/.exec(t)![0] : null;
  return n ? Object.keys(RANGOS_CP).filter((p) => cpEnRangos(n, RANGOS_CP[p]!)) : [];
}

/** Token de sesión de Google (agrupa las sugerencias de una compra): un UUID. */
export const SesionDireccion = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

export const PedidoSugerencias = z.object({ texto: z.string().trim().min(3).max(120), sesion: SesionDireccion }).strict();
export const SugerenciaDireccion = z.object({ id: z.string(), principal: z.string(), secundario: z.string() });
export const RespuestaSugerencias = z.object({ sugerencias: z.array(SugerenciaDireccion) });
export type SugerenciaDireccion = z.infer<typeof SugerenciaDireccion>;

/** El id de Google ("ChIJ…"): sólo letras, números, guiones; va en la URL, así que nada más. */
export const PedidoLugar = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{10,300}$/), sesion: SesionDireccion }).strict();
export const LugarDireccion = z.object({
  calle: z.string(), numero: z.string(), cp: z.string(), localidad: z.string(), provincia: z.string().nullable(),
});
export type LugarDireccion = z.infer<typeof LugarDireccion>;

export const PedidoRevisar = z.object({
  calle: z.string().trim().min(2).max(100),
  numero: z.string().trim().min(1).max(10),
  localidad: z.string().trim().max(80).default(""),
  provincia: z.string().trim().min(2).max(60),
}).strict();
/*
 * ok           la calle y la altura existen (en esa localidad, si se pudo ver)
 * sugerencia   existe con otro nombre o en otra localidad: "¿Quisiste decir…?"
 * altura       la calle existe pero esa altura no
 * no_encontrada  ni la calle
 * sin_servicio   Georef no respondió o está apagado: no se dice nada
 */
export const RevisionDireccion = z.object({
  estado: z.enum(["ok", "sugerencia", "altura", "no_encontrada", "sin_servicio"]),
  sugerencia: z.object({ calle: z.string(), numero: z.string(), localidad: z.string(), provincia: z.string(), texto: z.string() }).nullable(),
});
export type RevisionDireccion = z.infer<typeof RevisionDireccion>;

/** Localidades parecidas a lo escrito, dentro de la provincia elegida (Georef). */
export const PedidoLocalidades = z.object({ texto: z.string().trim().min(3).max(60), provincia: z.string().trim().min(2).max(60) }).strict();
export const RespuestaLocalidades = z.object({ localidades: z.array(z.string()) });

/** Ajustes → Direcciones en el checkout. */
export const AjusteDirecciones = z.object({
  google: z.boolean(),
  georef: z.boolean(),
  /**
   * Topes por día para no pasar del uso gratis de Google: 10.000 por mes de
   * cada cosa. 300 × 31 días = 9.300, así que con los de fábrica no se paga
   * aunque todos los días se llegue al tope.
   */
  topeSugerencias: z.number().int().min(0).max(100_000),
  topeLugares: z.number().int().min(0).max(100_000),
}).strict();
export type AjusteDirecciones = z.infer<typeof AjusteDirecciones>;
export const DIRECCIONES_POR_DEFECTO: AjusteDirecciones = { google: true, georef: true, topeSugerencias: 300, topeLugares: 300 };
