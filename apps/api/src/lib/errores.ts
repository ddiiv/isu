/* Error con código y estado HTTP. El mensaje es el que ve el cliente: nada interno. */
export class ErrorHttp extends Error {
  constructor(public status: number, public codigo: string, mensaje: string) {
    super(mensaje);
  }
}
export const noEncontrado = (que = "Recurso") => new ErrorHttp(404, "no_encontrado", `${que} no encontrado`);
