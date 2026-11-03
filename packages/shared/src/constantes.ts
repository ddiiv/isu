/*
 * Constantes que también usa el navegador. Acá no se importa zod: los
 * componentes de la tienda las toman de "@isu/shared/puro" y así zod no viaja
 * en el JS de cada página. Los esquemas que las usan siguen en su módulo.
 */

/*
 * El stock nunca viaja exacto: arriba de STOCK_VISIBLE_MAX se informa ese
 * tope. Al cliente le alcanza con "hay" / "¡últimas!", y no se le regala a
 * la competencia el inventario exacto de cada prenda.
 */
export const STOCK_VISIBLE_MAX = 10;

export const MAX_UNIDADES_POR_ARTICULO = 20;
export const MAX_LINEAS_CARRITO = 30;

/** Hasta cuántos packs iguales en una línea. */
export const MAX_PACKS_POR_LINEA = 10;

/* Enlace a la tienda: "/algo", nunca "//otro.sitio" ni "/\\otro". */
// eslint-disable-next-line security/detect-unsafe-regex -- anclada, sin alternativas que se solapen y con largo máximo
export const ENLACE_TIENDA = /^\/([A-Za-z0-9_#?=&.-][A-Za-z0-9/_#?=&.-]{0,198})?$/;

export const CALCES = ["chico", "justo", "grande"] as const;
export const TEXTO_CALCE: Record<(typeof CALCES)[number], string> = { chico: "Le quedó chico", justo: "Talle justo", grande: "Le quedó grande" };

export const ESTADOS_ENVIO = ["creado", "en_camino", "en_sucursal", "en_reparto", "entregado", "no_entregado", "devuelto", "cancelado"] as const;
export type EstadoEnvioTienda = (typeof ESTADOS_ENVIO)[number];
export const NOMBRE_ESTADO_ENVIO: Record<EstadoEnvioTienda, string> = {
  creado: "Preparando el envío", en_camino: "En camino", en_sucursal: "Listo para retirar en la sucursal", en_reparto: "Llega hoy",
  entregado: "Entregado", no_entregado: "No se pudo entregar", devuelto: "Devuelto", cancelado: "Envío cancelado",
};

export const PARTES = ["arriba", "abajo", "abrigo"] as const;
export type Parte = (typeof PARTES)[number];
export const NOMBRE_PARTE: Record<Parte, string> = { arriba: "Arriba", abajo: "Abajo", abrigo: "Abrigo" };

export const FAMILIAS = ["neutros", "azules", "verdes", "rojos", "rosas", "violetas", "amarillos", "tierra"] as const;
export type Familia = (typeof FAMILIAS)[number];
export const NOMBRE_FAMILIA: Record<Familia, string> = {
  neutros: "Neutros", azules: "Azules", verdes: "Verdes", rojos: "Rojos", rosas: "Rosas", violetas: "Violetas", amarillos: "Amarillos y naranjas", tierra: "Tierra",
};
export const MUESTRA_FAMILIA: Record<Familia, string> = {
  neutros: "#8a8a8a", azules: "#1f3f8f", verdes: "#2e7d4f", rojos: "#c62828", rosas: "#f2a7bd", violetas: "#6a3fa0", amarillos: "#f5d33a", tierra: "#9a6a3a",
};
