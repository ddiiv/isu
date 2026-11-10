/*
 * ¿La tienda está apagada? El proxy lo mira en cada visita, así que se guarda
 * en memoria (como el mapa de redirecciones: vive en globalThis porque el
 * proxy y /api/revalidar se empaquetan por separado). `cerrada` es null hasta
 * que se pudo preguntar una vez a la API.
 */
export interface EstadoTienda { cerrada: boolean | null; vence: number }
const g = globalThis as typeof globalThis & { __isuTienda?: EstadoTienda };
export const estadoTienda = (): EstadoTienda => (g.__isuTienda ??= { cerrada: null, vence: 0 });
/** El dueño prendió o apagó la tienda (o cambió el catálogo): el próximo pedido pregunta de nuevo, sin esperar al vencimiento. */
export const vencerTienda = () => { estadoTienda().vence = 0; };

/** Páginas que siguen abiertas con la tienda apagada: lo de quien ya compró (pedido, seguimiento, arrepentimiento, opinión, baja de recordatorios) y lo legal. */
export const LIBRES_CON_TIENDA_APAGADA = /^\/(pedido|seguimiento|arrepentimiento|opinar|baja-recordatorios|terminos|privacidad|devoluciones|cerrada)(\/|$)/;
