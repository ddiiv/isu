import { z } from "zod";
import { normalizar } from "./texto.js";
import { CLAVES_MEDIDA } from "./talles.js";
import { FotoPublica } from "./catalogo.js";

/*
 * "Armá tu outfit": en una sola pantalla el cliente dice para quién es, su
 * talle (o sus medidas), cuánto quiere gastar y, si quiere, qué colores le
 * gustan. La tienda arma combinaciones de prendas que HAY en ese talle y que
 * entran en el presupuesto. Cada prenda se puede cambiar por otra y el outfit
 * entero va al carrito con un toque.
 */
export const PARTES = ["arriba", "abajo", "abrigo"] as const;
export type Parte = (typeof PARTES)[number];
export const NOMBRE_PARTE: Record<Parte, string> = { arriba: "Arriba", abajo: "Abajo", abrigo: "Abrigo" };

const REGLAS: Array<[RegExp, Parte]> = [
  [/\b(buzos?|camperas?|canguros?|hoodies?|chalecos?|camperon|parkas?|sweaters?|sacos?|cardigans?|polar|rompevientos?|tapados?)\b/, "abrigo"],
  [/\b(shorts?|bermudas?|pantalon(es)?|joggers?|calzas?|jeans?|babuchas?|chupines?|leggings?|cargos?|palazzos?|polleras?|faldas?|biker)\b/, "abajo"],
  [/\b(remeras?|musculosas?|tops?|chombas?|camisas?|camisetas?|blusas?|bodys?|crop|polos?)\b/, "arriba"],
];
/** De qué parte del outfit es una prenda, por su categoría de Stocker o su nombre. null = no entra (medias, gorras…). */
export function parteDe(categoria: string | null | undefined, nombre: string): Parte | null {
  for (const fuente of [categoria ?? "", nombre]) {
    const n = normalizar(fuente);
    if (!n) continue;
    const r = REGLAS.find(([re]) => re.test(n));
    if (r) return r[1];
  }
  return null;
}

/*
 * Familias de color, para las preferencias ("me gustan los azules") y para
 * que las combinaciones no sean un arcoíris: en un outfit va a lo sumo una
 * prenda de color fuerte; el resto, neutros (negro, blanco, gris, beige,
 * jean, azul marino) o de la misma familia.
 */
export const FAMILIAS = ["neutros", "azules", "verdes", "rojos", "rosas", "violetas", "amarillos", "tierra"] as const;
export type Familia = (typeof FAMILIAS)[number];
export const NOMBRE_FAMILIA: Record<Familia, string> = {
  neutros: "Neutros", azules: "Azules", verdes: "Verdes", rojos: "Rojos", rosas: "Rosas", violetas: "Violetas", amarillos: "Amarillos y naranjas", tierra: "Tierra",
};
export const MUESTRA_FAMILIA: Record<Familia, string> = {
  neutros: "#8a8a8a", azules: "#1f3f8f", verdes: "#2e7d4f", rojos: "#c62828", rosas: "#f2a7bd", violetas: "#6a3fa0", amarillos: "#f5d33a", tierra: "#9a6a3a",
};

export function familiaDeColor(hex: string | null | undefined): Familia {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex ?? "");
  if (!m) return "neutros";
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x ?? "0", 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  // Poco saturado, casi negro o casi blanco: neutro. Azul oscuro/jean y beige también combinan con todo.
  if (s < 0.18 || l < 0.13 || l > 0.9) return "neutros";
  if (h >= 200 && h < 250 && (l < 0.3 || s < 0.45)) return "neutros";
  if (h >= 25 && h < 50 && l > 0.6 && s < 0.6) return "neutros";
  if (h < 15 || h >= 345) return l > 0.7 ? "rosas" : "rojos";
  if (h < 45) return l < 0.45 || s < 0.55 ? "tierra" : "amarillos";
  if (h < 70) return l < 0.45 ? "tierra" : "amarillos";
  if (h < 170) return "verdes";
  if (h < 255) return "azules";
  if (h < 300) return "violetas";
  return "rosas";
}

/** ¿Combinan? A lo sumo una familia que no sea neutra. */
export function combinan(familias: Familia[]): boolean {
  return new Set(familias.filter((f) => f !== "neutros")).size <= 1;
}

export const PARA = ["mujer", "hombre", "ninos"] as const;

export const PedidoOutfits = z.object({
  para: z.enum(PARA),
  talle: z.string().trim().min(1).max(10).nullable().default(null),
  medidas: z.partialRecord(z.enum(CLAVES_MEDIDA), z.number().min(1).max(300)).default({}),
  presupuesto: z.number().int().min(100_00).max(100_000_000_00), // centavos
  partes: z.array(z.enum(PARTES)).min(1).max(3).default(["arriba", "abajo"]),
  familias: z.array(z.enum(FAMILIAS)).max(FAMILIAS.length).default([]),
  semilla: z.number().int().min(0).max(1_000_000).default(0),
  /** Para "cambiar esta prenda": qué parte, qué SKU quedan fijos, qué productos ya se vieron. */
  reemplazar: z.object({
    parte: z.enum(PARTES),
    fijos: z.array(z.string().max(100)).max(3),
    excluir: z.array(z.number().int().positive()).max(200),
  }).strict().optional(),
}).strict().refine((p) => p.talle || Object.keys(p.medidas).length > 0, { message: "Elegí tu talle o cargá tus medidas", path: ["talle"] });
export type PedidoOutfits = z.input<typeof PedidoOutfits>;

export const PiezaOutfit = z.object({
  parte: z.enum(PARTES),
  productoId: z.number().int(),
  slug: z.string(),
  nombre: z.string(),
  sku: z.string(),
  color: z.object({ clave: z.string(), nombre: z.string(), hex: z.string().nullable() }).nullable(),
  talle: z.string().nullable(),
  /** Si el talle salió de sus medidas y la guía de esa prenda. */
  talleRecomendado: z.boolean(),
  precio: z.number().int(),
  precioLista: z.number().int().nullable(),
  foto: FotoPublica.nullable(),
});
export type PiezaOutfit = z.infer<typeof PiezaOutfit>;

export const RespuestaOutfits = z.object({
  outfits: z.array(z.object({ piezas: z.array(PiezaOutfit), total: z.number().int() })),
  alternativas: z.array(PiezaOutfit).optional(),
  /** Si no salió nada: por qué, y desde cuánto habría. */
  motivo: z.enum(["ok", "presupuesto", "sin_prendas", "sin_talle"]),
  minimo: z.number().int().nullable(),
});
export type RespuestaOutfits = z.infer<typeof RespuestaOutfits>;
