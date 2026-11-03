import { z } from "zod";
import { esClaveMedida, infoMedida, MEDIDA_LIBRE, normalizarTalle, ordenarGuia, tallesDeTipo, TIPOS_GUIA } from "./talles.js";

/* Los esquemas de las guías de talles (lo demás, sin zod, está en talles.ts: lo usa el navegador). */
const Cm = z.number().min(0).max(300);
export const Rango = z.tuple([Cm, Cm]).refine(([a, b]) => b >= a, "El máximo no puede ser menor que el mínimo");

export const GuiaTalles = z.object({
  nombre: z.string().trim().min(2).max(80),
  tipo: z.enum(TIPOS_GUIA),
  medidas: z.array(z.string().trim().refine((m) => esClaveMedida(m) || MEDIDA_LIBRE.test(m), "Nombre de medida inválido")).min(1).max(8)
    .refine((m) => new Set(m.map((x) => x.toLowerCase())).size === m.length, "Hay medidas repetidas"),
  filas: z.array(z.object({
    talle: z.string().trim().min(1).max(10),
    // Una entrada por medida (en el mismo orden). null = no aplica en ese talle.
    valores: z.array(Rango.nullable()).max(8),
  }).strict()).min(1).max(20),
  nota: z.string().trim().max(500).nullable().default(null),
}).strict().superRefine((g, ctx) => {
  const validos = new Set(tallesDeTipo(g.tipo));
  const vistos = new Set<string>();
  g.filas.forEach((f, i) => {
    const t = normalizarTalle(f.talle);
    if (g.tipo !== "otro" && !validos.has(t)) ctx.addIssue({ code: "custom", path: ["filas", i, "talle"], message: `"${f.talle}" no es un talle de ${g.tipo === "nino" ? "niños (4 a 16)" : "adulto (XS a 5XL)"}` });
    if (vistos.has(t)) ctx.addIssue({ code: "custom", path: ["filas", i, "talle"], message: `El talle ${t} está dos veces` });
    vistos.add(t);
    if (f.valores.length !== g.medidas.length) ctx.addIssue({ code: "custom", path: ["filas", i, "valores"], message: "Falta completar alguna medida" });
  });
});
export type GuiaTalles = z.infer<typeof GuiaTalles>;

/** La guía como la ve el cliente (en la ficha del producto). */
export const GuiaPublica = z.object({
  nombre: z.string(),
  tipo: z.enum(TIPOS_GUIA),
  medidas: z.array(z.object({ clave: z.string(), nombre: z.string(), tipo: z.enum(["cuerpo", "prenda"]), ayuda: z.string() })),
  filas: z.array(z.object({ talle: z.string(), valores: z.array(Rango.nullable()) })),
  nota: z.string().nullable(),
});
export type GuiaPublica = z.infer<typeof GuiaPublica>;

export function guiaPublica(g: GuiaTalles): GuiaPublica {
  const o = ordenarGuia(g);
  return {
    nombre: o.nombre, tipo: o.tipo, nota: o.nota,
    medidas: o.medidas.map((c) => ({ clave: c, ...infoMedida(c) })),
    filas: o.filas,
  };
}
