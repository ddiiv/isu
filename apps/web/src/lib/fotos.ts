import { ANCHOS_BANNER, ANCHOS_FOTO, urlFoto, type FotoPublica } from "@isu/shared";

/* De dónde salen las fotos (R2 en producción; la API en desarrollo). */
const CDN = (process.env.NEXT_PUBLIC_CDN_IMAGENES ?? "").split(",")[0]?.trim() || "/fotos";

export function srcSet(f: FotoPublica): string {
  return ANCHOS_FOTO.map((w) => `${urlFoto(CDN, f.clave, w)} ${w}w`).join(", ");
}
export const src = (f: FotoPublica, ancho: 400 | 800 | 1200 = 800) => urlFoto(CDN, f.clave, ancho);

/* Banners de la portada (etapa 8): 800, 1600 y 2400 px. */
export const srcSetBanner = (clave: string) => ANCHOS_BANNER.map((w) => `${urlFoto(CDN, clave, w)} ${w}w`).join(", ");
export const srcBanner = (clave: string, ancho: (typeof ANCHOS_BANNER)[number] = 1600) => urlFoto(CDN, clave, ancho);
