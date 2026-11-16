import { CLAVE_CONSENTIMIENTO, leerEleccion, type MedicionPedido } from "@isu/shared";

/*
 * Lo que el checkout manda con el pedido para la API de conversiones de Meta: las cookies del Pixel y el
 * navegador. Sólo si la persona aceptó las cookies; si no, undefined y esa compra no se informa a Meta.
 */
export function leerMedicion(): MedicionPedido | undefined {
  try {
    if (leerEleccion(localStorage.getItem(CLAVE_CONSENTIMIENTO)) !== "granted") return undefined;
    const cookie = (n: string) => document.cookie.split("; ").find((x) => x.startsWith(`${n}=`))?.slice(n.length + 1);
    const fbp = cookie("_fbp"), fbc = cookie("_fbc");
    return { ...(fbp ? { fbp } : {}), ...(fbc ? { fbc } : {}), ua: navigator.userAgent.slice(0, 300) };
  } catch { return undefined; }
}
