import type { FastifyInstance, FastifyReply } from "fastify";
import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { noEncontrado } from "../../lib/errores.js";

/*
 * Fotos y videos servidos desde disco (FOTOS_DIR). Con R2 configurado van a
 * su bucket y se sirven desde su dominio, sin pasar por la API.
 *
 * La ruta del archivo se arma únicamente si el pedido calza EXACTO con el
 * formato que genera la tienda: nada de "..", ni barras de más, ni otras
 * extensiones.
 */
// Fotos de productos (p/…, también en .jpg para el catálogo de Meta), banners de la portada (b/…, etapa 8) y videos de producto (v/…).
const ARCHIVO = /^(p\/(\d{1,9}|[a-f0-9]{12})\/[a-z0-9]{8,40}-(400|800|1200)\.(webp|jpg)|b\/(\d{1,9}|[a-f0-9]{12})\/[a-z0-9]{8,40}-(800|1600|2400)\.webp|v\/[a-f0-9]{12}\/[a-f0-9]{16}\.mp4)$/;

/* Una ruta relativa se toma desde la raíz del monorepo (donde está el .env), no desde apps/api. */
export function desdeLaRaiz(dir: string): string {
  if (path.isAbsolute(dir)) return dir;
  let d = process.cwd();
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- sólo se mira si existe el archivo del workspace
  while (!existsSync(path.join(d, "pnpm-workspace.yaml")) && path.dirname(d) !== d) d = path.dirname(d);
  return path.resolve(d, dir);
}

export async function rutasFotos(app: FastifyInstance, deps: { dir: string }) {
  const raiz = desdeLaRaiz(deps.dir);
  app.get<{ Params: { "*": string } }>("/fotos/*", async (req, reply) => {
    const rel = req.params["*"];
    if (!ARCHIVO.test(rel)) throw noEncontrado("Foto");
    // La .jpg no está en disco: se lee la .webp y se convierte.
    const jpg = rel.endsWith(".jpg");
    const archivo = path.join(raiz, jpg ? rel.replace(/\.jpg$/, ".webp") : rel);
    if (!archivo.startsWith(raiz + path.sep)) throw noEncontrado("Foto");
    let tamano: number;
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta validada arriba
      const s = await stat(archivo);
      if (!s.isFile()) throw new Error();
      tamano = s.size;
    } catch {
      throw noEncontrado("Foto");
    }
    if (rel.endsWith(".mp4")) return video(req.headers.range, archivo, tamano, reply);
    // JPEG no tiene transparencia: se aplana sobre blanco. Antes de las cabeceras: un error no puede quedar cacheado un año.
    const convertida = jpg ? await sharp(archivo).flatten({ background: "#ffffff" }).jpeg({ quality: 85 }).toBuffer() : null;
    reply
      .header("content-type", jpg ? "image/jpeg" : "image/webp")
      .header("cache-control", "public, max-age=31536000, immutable")
      .header("cross-origin-resource-policy", "cross-origin");
    if (convertida) return reply.send(convertida);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta validada arriba
    return reply.send(createReadStream(archivo));
  });
}

/*
 * Video por partes (Range): Safari no reproduce un video si el servidor no las da, y los demás lo usan para
 * adelantar sin bajar todo. Sólo un tramo por pedido ("bytes=inicio-fin", "bytes=inicio-" o "bytes=-últimos").
 */
export function tramo(range: string | undefined, tamano: number): { inicio: number; fin: number } | "invalido" | null {
  if (!range) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!m || (!m[1] && !m[2])) return "invalido";
  let inicio: number, fin: number;
  if (!m[1]) { inicio = Math.max(0, tamano - Number(m[2])); fin = tamano - 1; }
  else { inicio = Number(m[1]); fin = m[2] ? Math.min(Number(m[2]), tamano - 1) : tamano - 1; }
  return inicio > fin || inicio >= tamano ? "invalido" : { inicio, fin };
}

function video(range: string | undefined, archivo: string, tamano: number, reply: FastifyReply) {
  reply.header("accept-ranges", "bytes").header("cross-origin-resource-policy", "cross-origin");
  const t = tramo(range, tamano);
  if (t === "invalido") return reply.code(416).header("content-range", `bytes */${tamano}`).send();
  // Después del 416: un error no puede quedar cacheado un año.
  reply.header("content-type", "video/mp4").header("cache-control", "public, max-age=31536000, immutable");
  if (!t) {
    reply.header("content-length", tamano);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta validada en la ruta
    return reply.send(createReadStream(archivo));
  }
  reply.code(206).header("content-range", `bytes ${t.inicio}-${t.fin}/${tamano}`).header("content-length", t.fin - t.inicio + 1);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta validada en la ruta
  return reply.send(createReadStream(archivo, { start: t.inicio, end: t.fin }));
}
