/* Error con código y estado HTTP. El mensaje es el que ve el cliente: nada interno. */
export class ErrorHttp extends Error {
  /** `datos`: información extra para el cliente (p. ej. qué artículos faltaron). Nunca nada interno. */
  constructor(public status: number, public codigo: string, mensaje: string, public datos?: Record<string, unknown>) {
    super(mensaje);
  }
}
export const noEncontrado = (que = "Recurso") => new ErrorHttp(404, "no_encontrado", `${que} no encontrado`);
export const noAutorizado = () => new ErrorHttp(401, "sin_sesion", "Tenés que ingresar a tu cuenta.");
export const invalido = (mensaje: string) => new ErrorHttp(400, "validacion", mensaje);
export const conflicto = (codigo: string, mensaje: string) => new ErrorHttp(409, codigo, mensaje);
