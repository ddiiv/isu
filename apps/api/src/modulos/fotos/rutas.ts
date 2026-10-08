import type { FastifyInstance } from "fastify";
import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { noEncontrado } from "../../lib/errores.js";

/*
 * Fotos servidas desde disco. SÓLO para desarrollo y para las pruebas: en
 * producción las fotos van a un bucket (Cloudflare R2) y se sirven desde su
 * dominio, sin pasar por la API.
 *
 * La ruta del archivo se arma únicamente si el pedido calza EXACTO con el
 * formato que genera la tienda: nada de "..", ni barras de más, ni otras
 * extensiones.
 */
// Fotos de productos (p/…) y banners de la portada (b/…, etapa 8).
const ARCHIVO = /^(p\/(\d{1,9}|[a-f0-9]{12})\/[a-z0-9]{8,40}-(400|800|1200)|b\/(\d{1,9}|[a-f0-9]{12})\/[a-z0-9]{8,40}-(800|1600|2400))\.webp$/;

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
    const archivo = path.join(raiz, rel);
    if (!archivo.startsWith(raiz + path.sep)) throw noEncontrado("Foto");
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta validada arriba
      const s = await stat(archivo);
      if (!s.isFile()) throw new Error();
    } catch {
      throw noEncontrado("Foto");
    }
    reply
      .header("content-type", "image/webp")
      .header("cache-control", "public, max-age=31536000, immutable")
      .header("cross-origin-resource-policy", "cross-origin");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta validada arriba
    return reply.send(createReadStream(archivo));
  });
}
