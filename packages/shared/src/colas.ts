/*
 * Colas de trabajo en segundo plano (BullMQ sobre Redis).
 *
 * Todo lo que habla con un tercero y puede tardar o fallar va por acá y no
 * dentro de un pedido HTTP del cliente: si Andreani tarda 20 s, el cliente no
 * se queda mirando un spinner, y si falla, se reintenta solo.
 */
export const COLAS = {
  stocker: "stocker",               // sincronizar stock/precios, mandar pedidos (etapa 1-2)
  notificaciones: "notificaciones", // email y WhatsApp de seguimiento (etapa 4)
  envios: "envios",                 // etiquetas y tracking de correos (etapa 4)
  pagos: "pagos",                   // conciliar Mercado Pago y vencer transferencias (etapa 2)
} as const;
export type NombreCola = (typeof COLAS)[keyof typeof COLAS];

/* Reintentos: 5 veces con espera exponencial (5 s, 10 s, 20 s…). */
export const OPCIONES_TRABAJO = {
  attempts: 5,
  backoff: { type: "exponential" as const, delay: 5_000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

/*
 * Dónde quedó la lectura del feed de novedades de Stocker (qué se despachó,
 * qué se canceló). Va en tienda.ajustes: lo mueve sólo el worker, la API lo
 * lee sin moverlo. No es un ajuste editable del backoffice.
 */
export const CLAVE_CURSOR_NOVEDADES = "cursorNovedadesStocker";

/** Stocker libera sola la mercadería que no se cobró en 7 días (contrato v1 § 3.5): el plazo de pago de la tienda no pasa de ahí. */
export const HORAS_MAXIMAS_PAGO = 7 * 24;
