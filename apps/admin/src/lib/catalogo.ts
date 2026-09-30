export interface FilaProducto {
  id: number; slug: string; nombre: string; sku: string; visible: boolean; enStocker: boolean; destacado: boolean; destacadoOrden: number; nuevo: boolean;
  categoriaStocker: string | null; stock: number; precio: number | null; fotos: number; colores: number; foto: string | null; categorias: number[];
}
export interface Categoria { id: number; nombre: string; slug: string; padreId: number | null; orden: number; visible: boolean; productos: number; seoTitulo: string | null; seoDescripcion: string | null }
export interface GuiaResumen { id: number; nombre: string; tipo: "nino" | "adulto"; medidas: string[]; talles: number; productos: number; actualizadoEn: string; actualizadoPor: string | null }

/** Nombre "Mujer › Remeras" de cada categoría. */
export function nombresCategorias(cs: Categoria[]) {
  const por = new Map(cs.map((c) => [c.id, c]));
  return new Map(cs.map((c) => [c.id, c.padreId ? `${por.get(c.padreId)?.nombre ?? "?"} › ${c.nombre}` : c.nombre]));
}

/** Árbol de dos niveles, en orden. */
export function arbol(cs: Categoria[]) {
  const orden = (a: Categoria, b: Categoria) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, "es");
  return cs.filter((c) => !c.padreId).sort(orden).map((p) => ({ ...p, hijas: cs.filter((h) => h.padreId === p.id).sort(orden) }));
}

/* "Remera Oversize" → "remera-oversize" (para la dirección de una categoría nueva). */
export const aSlug = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
