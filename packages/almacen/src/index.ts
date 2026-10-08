import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { AwsClient } from "aws4fetch";

/*
 * Dónde quedan los archivos que sube la tienda.
 *
 *   fotos         públicas: R2 con dominio público (CDN_IMAGENES); en desarrollo, disco
 *   comprobantes  PRIVADOS: otro bucket, sin dominio público; sólo los lee el backoffice
 *   etiquetas     PRIVADAS (nombre y dirección del cliente): el mismo bucket privado, en e/
 *
 * Cada almacén tiene un patrón de nombre de archivo: nada que no calce entra
 * a una ruta o a una URL. Así ni un error de programación ni un pedido
 * armado pueden escribir o leer fuera de su lugar.
 */
export interface Almacen {
  guardar(archivo: string, datos: Buffer, tipo: string): Promise<void>;
  leer(archivo: string): Promise<Buffer | null>;
  borrar(archivo: string): Promise<void>;
}

/*
 * Fotos y banners son públicos: su dirección no lleva el id del producto ni
 * del banner. Las nuevas van en una carpeta al azar (p/3f9a0c1b2d4e/…); las
 * viejas (p/139/…) siguen sirviendo hasta pasarlas con `pnpm fotos:sin-ids`.
 */
export const PATRON_FOTOS = /^p\/(\d{1,9}|[a-f0-9]{12})\/[a-z0-9]{8,40}-(400|800|1200)\.webp$/;
export const PATRON_BANNERS = /^b\/(\d{1,9}|[a-f0-9]{12})\/[a-z0-9]{8,40}-(800|1600|2400)\.webp$/;
/** Una clave nueva para una foto ("p") o un banner ("b"): sin ids, todo al azar. */
export const claveNueva = (tipo: "p" | "b") => `${tipo}/${randomBytes(6).toString("hex")}/${randomBytes(8).toString("hex")}`;
export const PATRON_COMPROBANTES = /^c\/\d{1,9}\/[a-z0-9]{16,40}\.(webp|pdf)$/;
export const PATRON_ETIQUETAS = /^e\/\d{1,9}\/[a-z0-9]{16,40}\.pdf$/;

/* Una ruta relativa se toma desde la raíz del monorepo (donde está el .env), no desde la carpeta de cada app. */
export function desdeLaRaiz(dir: string): string {
  if (path.isAbsolute(dir)) return dir;
  let d = process.cwd();
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- sólo se mira si existe el archivo del workspace
  while (!existsSync(path.join(d, "pnpm-workspace.yaml")) && path.dirname(d) !== d) d = path.dirname(d);
  return path.resolve(d, dir);
}

function validar(patron: RegExp, archivo: string) {
  if (!patron.test(archivo)) throw new Error("Nombre de archivo inválido para este almacén");
}

export function almacenEnDisco(dir: string, patron: RegExp): Almacen {
  const raiz = desdeLaRaiz(dir);
  const ruta = (archivo: string) => {
    validar(patron, archivo);
    const r = path.join(raiz, archivo);
    if (!r.startsWith(raiz + path.sep)) throw new Error("Ruta fuera de la carpeta del almacén");
    return r;
  };
  return {
    async guardar(archivo, datos) {
      const r = ruta(archivo);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta validada
      await mkdir(path.dirname(r), { recursive: true });
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta validada
      await writeFile(r, datos);
    },
    async leer(archivo) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta validada
      try { return await readFile(ruta(archivo)); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
    },
    async borrar(archivo) {
      await rm(ruta(archivo), { force: true });
    },
  };
}

export function almacenR2(o: { cuenta: string; bucket: string; id: string; secreto: string }, patron: RegExp): Almacen {
  const cliente = new AwsClient({ accessKeyId: o.id, secretAccessKey: o.secreto, service: "s3", region: "auto" });
  const base = `https://${encodeURIComponent(o.cuenta)}.r2.cloudflarestorage.com/${encodeURIComponent(o.bucket)}`;
  const pedir = async (metodo: "PUT" | "GET" | "DELETE", archivo: string, cuerpo?: Buffer, tipo?: string) => {
    validar(patron, archivo);
    return cliente.fetch(`${base}/${archivo}`, {
      method: metodo,
      body: cuerpo ? new Uint8Array(cuerpo) : undefined,
      headers: cuerpo ? { "content-type": tipo ?? "application/octet-stream", "cache-control": "public, max-age=31536000, immutable" } : {},
    });
  };
  return {
    async guardar(archivo, datos, tipo) {
      const r = await pedir("PUT", archivo, datos, tipo);
      if (!r.ok) throw new Error(`R2 contestó ${r.status} al subir`);
    },
    async leer(archivo) {
      const r = await pedir("GET", archivo);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`R2 contestó ${r.status} al leer`);
      return Buffer.from(await r.arrayBuffer());
    },
    async borrar(archivo) {
      const r = await pedir("DELETE", archivo);
      if (!r.ok && r.status !== 404) throw new Error(`R2 contestó ${r.status} al borrar`);
    },
  };
}

/** Fotos: R2 si están las cuatro variables, si no la carpeta FOTOS_DIR. */
export function almacenDeFotos(env: NodeJS.ProcessEnv = process.env): Almacen {
  if (env.R2_CUENTA && env.R2_BUCKET && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY) {
    return almacenR2({ cuenta: env.R2_CUENTA, bucket: env.R2_BUCKET, id: env.R2_ACCESS_KEY_ID, secreto: env.R2_SECRET_ACCESS_KEY }, PATRON_FOTOS);
  }
  if (env.FOTOS_DIR) return almacenEnDisco(env.FOTOS_DIR, PATRON_FOTOS);
  throw new Error("Configurá dónde guardar las fotos: FOTOS_DIR (desarrollo) o R2_CUENTA/R2_BUCKET/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY");
}

/** Banners de la portada: el mismo lugar público que las fotos, con su propio patrón (b/…). */
export function almacenDeBanners(env: NodeJS.ProcessEnv = process.env): Almacen {
  if (env.R2_CUENTA && env.R2_BUCKET && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY) {
    return almacenR2({ cuenta: env.R2_CUENTA, bucket: env.R2_BUCKET, id: env.R2_ACCESS_KEY_ID, secreto: env.R2_SECRET_ACCESS_KEY }, PATRON_BANNERS);
  }
  if (env.FOTOS_DIR) return almacenEnDisco(env.FOTOS_DIR, PATRON_BANNERS);
  throw new Error("Configurá dónde guardar las fotos: FOTOS_DIR (desarrollo) o R2_CUENTA/R2_BUCKET/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY");
}

/** Comprobantes: bucket PRIVADO aparte (R2_BUCKET_PRIVADO), o la carpeta COMPROBANTES_DIR. */
export function almacenDeComprobantes(env: NodeJS.ProcessEnv = process.env): Almacen | null {
  if (env.R2_CUENTA && env.R2_BUCKET_PRIVADO && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY) {
    return almacenR2({ cuenta: env.R2_CUENTA, bucket: env.R2_BUCKET_PRIVADO, id: env.R2_ACCESS_KEY_ID, secreto: env.R2_SECRET_ACCESS_KEY }, PATRON_COMPROBANTES);
  }
  if (env.COMPROBANTES_DIR) return almacenEnDisco(env.COMPROBANTES_DIR, PATRON_COMPROBANTES);
  return null;
}
export * from "./procesar.js";

/** Etiquetas de envío: el mismo lugar privado que los comprobantes (otra carpeta, otro patrón). */
export function almacenDeEtiquetas(env: NodeJS.ProcessEnv = process.env): Almacen | null {
  if (env.R2_CUENTA && env.R2_BUCKET_PRIVADO && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY) {
    return almacenR2({ cuenta: env.R2_CUENTA, bucket: env.R2_BUCKET_PRIVADO, id: env.R2_ACCESS_KEY_ID, secreto: env.R2_SECRET_ACCESS_KEY }, PATRON_ETIQUETAS);
  }
  if (env.COMPROBANTES_DIR) return almacenEnDisco(env.COMPROBANTES_DIR, PATRON_ETIQUETAS);
  return null;
}
