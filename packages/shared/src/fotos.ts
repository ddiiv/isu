/*
 * Reglas de fotos de un producto.
 *
 * Hay dos clases de foto, y se usan distinto:
 *
 *   COLOR       La prenda sola, estirada o en percha, de UN color. Es la que
 *               aparece al elegir el color y la que arma la muestra del
 *               selector. Máximo 5 por color.
 *
 *   EXHIBICION  Con modelo, para la galería del producto. Puede decir qué
 *               color lleva puesto la modelo (así, al elegir ese color, se
 *               muestra primero) o ser general.
 *
 * El tope del producto padre no se carga a mano: son 5 por cada color que
 * tiene. Las de exhibición entran en ese mismo cupo. Un producto de 3 colores
 * puede tener hasta 15 fotos en total, repartidas como convenga, pero nunca
 * más de 5 de un mismo color.
 *
 * La base de datos aplica las mismas reglas con un trigger (ver migración
 * 0002): esta función es para avisar antes, no la única barrera.
 */

export const FOTOS_POR_COLOR = 5;

export const TIPOS_DE_FOTO = ["color", "exhibicion"] as const;
export type TipoDeFoto = (typeof TIPOS_DE_FOTO)[number];

/** Tope de fotos del producto padre: 5 × cantidad de colores. */
export function fotosMaximasDelProducto(cantidadDeColores: number): number {
  if (!Number.isInteger(cantidadDeColores) || cantidadDeColores < 0) {
    throw new RangeError("La cantidad de colores tiene que ser un entero ≥ 0");
  }
  return cantidadDeColores * FOTOS_POR_COLOR;
}

export interface EstadoDeFotos {
  /** fotos cargadas por color (clave del color → cantidad), sólo las de tipo COLOR */
  porColor: Record<string, number>;
  /** fotos de exhibición cargadas (con o sin color asignado) */
  exhibicion: number;
  cantidadDeColores: number;
}

export type MotivoRechazo = "color_lleno" | "producto_lleno" | "sin_colores" | "color_inexistente";

/**
 * ¿Se puede agregar una foto más? Devuelve null si sí, o el motivo si no.
 * `colores` es la lista de colores válidos del producto.
 */
export function puedeAgregarFoto(
  estado: EstadoDeFotos,
  nueva: { tipo: TipoDeFoto; color: string | null },
  colores: readonly string[],
): MotivoRechazo | null {
  if (estado.cantidadDeColores === 0) return "sin_colores";
  if (nueva.color !== null && !colores.includes(nueva.color)) return "color_inexistente";
  if (nueva.tipo === "color") {
    if (nueva.color === null) return "color_inexistente";
    if ((estado.porColor[nueva.color] ?? 0) >= FOTOS_POR_COLOR) return "color_lleno";
  }
  const total = Object.values(estado.porColor).reduce((a, b) => a + b, 0) + estado.exhibicion;
  if (total >= fotosMaximasDelProducto(estado.cantidadDeColores)) return "producto_lleno";
  return null;
}

/*
 * Tamaños que se generan de cada foto al subirla (webp). La tienda elige el
 * que corresponde con srcset: nunca se redimensiona en el servidor web al
 * vuelo, que en un pico es CPU que le falta a todo lo demás.
 */
export const ANCHOS_FOTO = [400, 800, 1200] as const;
export type AnchoFoto = (typeof ANCHOS_FOTO)[number];

/** clave "p/12/ab12cd34" → "<base>/p/12/ab12cd34-800.webp" */
export function urlFoto(base: string, clave: string, ancho: AnchoFoto): string {
  return `${base.replace(/\/+$/, "")}/${clave}-${ancho}.webp`;
}

/* Las claves las genera la tienda; igual se validan antes de armar una ruta con ellas. */
export const CLAVE_FOTO = /^p\/\d{1,9}\/[a-z0-9]{8,40}$/;
