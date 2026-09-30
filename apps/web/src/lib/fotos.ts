import { ANCHOS_FOTO, urlFoto, type FotoPublica } from "@isu/shared";

/* De dónde salen las fotos (R2 en producción; la API en desarrollo). */
const CDN = (process.env.NEXT_PUBLIC_CDN_IMAGENES ?? "").split(",")[0]?.trim() || "/fotos";

export function srcSet(f: FotoPublica): string {
  return ANCHOS_FOTO.map((w) => `${urlFoto(CDN, f.clave, w)} ${w}w`).join(", ");
}
export const src = (f: FotoPublica, ancho: 400 | 800 | 1200 = 800) => urlFoto(CDN, f.clave, ancho);
