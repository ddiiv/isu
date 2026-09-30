import sharp from "sharp";
import { ANCHOS_FOTO, type AnchoFoto } from "@isu/shared";

/*
 * Una foto subida → tres webp (400, 800 y 1200 px de ancho).
 *
 *   · Se gira según el EXIF (las del celular vienen acostadas) y después se
 *     le borran TODOS los metadatos: una foto tomada en el local trae el GPS.
 *   · Nunca se agranda: si la original mide 700 px, la de 800 y la de 1200
 *     salen de 700.
 *   · Se rechaza lo que no es imagen o es desproporcionado (una "bomba" de
 *     60.000 × 60.000 px tumba el proceso al descomprimirla).
 */
export const MAX_BYTES = 25 * 1024 * 1024;
const MAX_PIXELES = 50_000_000;
const FORMATOS = new Set(["jpeg", "png", "webp", "heif", "avif", "tiff"]);

export interface FotoProcesada {
  ancho: number;
  alto: number;
  tamanos: Array<{ ancho: AnchoFoto; datos: Buffer }>;
}

export class FotoInvalida extends Error {}

export async function procesarFoto(original: Buffer): Promise<FotoProcesada> {
  if (original.length > MAX_BYTES) throw new FotoInvalida(`Pesa más de ${MAX_BYTES / 1024 / 1024} MB`);
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    meta = await sharp(original, { limitInputPixels: MAX_PIXELES, failOn: "error" }).metadata();
  } catch {
    throw new FotoInvalida("No es una imagen válida");
  }
  if (!meta.format || !FORMATOS.has(meta.format)) throw new FotoInvalida(`Formato no admitido: ${meta.format ?? "desconocido"}`);
  if (!meta.width || !meta.height || meta.width < 300 || meta.height < 300) throw new FotoInvalida("Muy chica: mínimo 300 × 300 px");
  const proporcion = meta.width / meta.height;
  if (proporcion > 3 || proporcion < 1 / 3) throw new FotoInvalida("Proporción rara (más de 3 a 1)");

  const tamanos: FotoProcesada["tamanos"] = [];
  let ancho = 0, alto = 0;
  for (const w of ANCHOS_FOTO) {
    const { data, info } = await sharp(original, { limitInputPixels: MAX_PIXELES })
      .rotate()
      .resize({ width: w, withoutEnlargement: true })
      .webp({ quality: w <= 400 ? 72 : 80, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    tamanos.push({ ancho: w, datos: data });
    ancho = info.width;
    alto = info.height;
  }
  return { ancho, alto, tamanos };
}
