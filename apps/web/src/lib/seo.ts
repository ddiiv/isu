import type { ConfigPublica, ContextoSeo, FotoPublica } from "@isu/shared";
import { src } from "./fotos";
import { SITIO } from "./sitio";

/* Lo que necesitan los datos estructurados y el feed, a partir de los ajustes de la tienda. */
export const absoluta = (u: string) => (/^https?:\/\//.test(u) ? u : `${SITIO.url}${u.startsWith("/") ? "" : "/"}${u}`);

export function contextoSeo(config: ConfigPublica): ContextoSeo {
  return {
    sitio: SITIO.url,
    marca: SITIO.nombre,
    foto: (f: FotoPublica, ancho) => absoluta(src(f, ancho)),
    costoEnvio: config.costoEnvio > 0 ? config.costoEnvio : null,
    envioGratisDesde: config.envioGratisDesde,
    cuotas: config.cuotasSinInteres,
    descuentoTransferencia: config.descuentoTransferencia,
    // Lo que dice /devoluciones.
    diasDevolucion: 30,
  };
}
