/*
 * Entrada para el navegador: sólo módulos sin zod, así no viaja en el JS de
 * la tienda (zod + todos los esquemas eran ~100 KB gzip en cada página).
 * Los tipos se toman de todo el paquete; no generan código.
 */
export * from "./fotos.js";
export * from "./plata.js";
export * from "./texto.js";
export * from "./colores.js";
export * from "./categorias.js";
export * from "./packs.js";
export * from "./talles.js";
export * from "./constantes.js";
export * from "./seo-datos.js";
export * from "./origen.js";
export type * from "./index.js";
