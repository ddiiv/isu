/*
 * Estado del mapa de redirecciones, compartido entre el proxy y /api/revalidar
 * (los dos corren en el mismo proceso del servidor de la tienda, pero Next
 * los empaqueta por separado: por eso vive en globalThis y no en un módulo).
 */
export interface EstadoRedirecciones { mapa: Record<string, string> | null; vence: number }
const g = globalThis as typeof globalThis & { __isuRedirecciones?: EstadoRedirecciones };
export const estadoRedirecciones = (): EstadoRedirecciones => (g.__isuRedirecciones ??= { mapa: null, vence: 0 });
/** El catálogo o las redirecciones cambiaron: el próximo pedido trae el mapa nuevo (sin esperar los 5 minutos). */
export const vencerRedirecciones = () => { estadoRedirecciones().vence = 0; };
