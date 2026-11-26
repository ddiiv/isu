import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type pg from "pg";
import { z } from "zod";
import sharp from "sharp";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage } from "pdf-lib";
import { compararTalles } from "@isu/shared";
import type { Almacen } from "@isu/almacen";
import type { Entorno } from "../../entorno.js";
import { ErrorHttp } from "../../lib/errores.js";
import { ipDe } from "../../lib/cliente.js";
import { auditar, exigir } from "./sesion.js";

/*
 * Catálogo en PDF para uso interno (backoffice → Catálogo PDF), lo más compacto posible: 16 productos por hoja A4, cada uno con foto de
 * frente y de espalda (las mismas fotos que muestra la web), nombre, SKU padre (el agrupador de Stocker), colores y talles. Los productos se eligen en la pantalla (`productos.en_catalogo`, 0040) y quedan guardados.
 *
 * Fotos: las de isu-fotos dicen su vista en `origen` («ia/…/Frente», «…/Espalda», «…/Solo-Frente»); se usa la del modelo y, si no hay, la
 * de la prenda sola. Sin esas, la primera y la segunda foto del producto. Las fotos están en WebP y pdf-lib sólo acepta JPG/PNG: se
 * pasan a JPG (achicadas) al armar el PDF. No hay datos de clientes.
 */
const Seleccion = z.object({ ids: z.array(z.coerce.number().int().positive()).max(5000) }).strict();
const MAX_PRODUCTOS = 800;

interface Foto { producto_id: number; clave: string; origen: string | null; alt: string | null; color_id: number | null }
const vista = (f: Foto) => (f.origen?.split("/").pop() ?? f.alt?.split(" - ").pop() ?? "").trim().toLowerCase();

/**
 * Frente y espalda de un producto (las fotos vienen en el orden de la tienda). Primero un par del MISMO color (el del modelo, si no el de
 * la prenda sola): así frente y espalda muestran la misma prenda. Si no hay par, el mejor frente y la mejor espalda que haya; sin vistas,
 * las dos primeras fotos (del mismo color si se puede).
 */
export function frenteYEspalda(fotos: Foto[]): [Foto | null, Foto | null] {
  const colores = [...new Set(fotos.map((f) => f.color_id))];
  for (const [fr, es] of [["frente", "espalda"], ["solo-frente", "solo-espalda"]]) {
    for (const c of colores) {
      const deColor = fotos.filter((f) => f.color_id === c);
      const par = [deColor.find((f) => vista(f) === fr), deColor.find((f) => vista(f) === es)];
      if (par[0] && par[1]) return [par[0], par[1]];
    }
  }
  const de = (...vs: string[]) => vs.map((v) => fotos.find((f) => vista(f) === v)).find(Boolean) ?? null;
  const frente = de("frente", "solo-frente") ?? fotos[0] ?? null;
  const mismoColor = fotos.filter((f) => f.color_id === frente?.color_id);
  const espalda = de("espalda", "solo-espalda") ?? mismoColor.find((f) => f !== frente) ?? fotos.find((f) => f !== frente) ?? null;
  return [frente, espalda];
}

/** Helvetica (WinAnsi) no dibuja todo: lo que no puede, afuera (antes que cortar el PDF por un emoji en un nombre). */
const seguro = (t: string, f: PDFFont) => [...t].filter((c) => { try { f.encodeText(c); return true; } catch { return false; } }).join("");

/** Corta un texto en líneas que entren en `ancho`. */
function lineas(t: string, f: PDFFont, tam: number, ancho: number): string[] {
  const out: string[] = [];
  let linea = "";
  for (const p of t.split(/\s+/)) {
    const prueba = linea ? `${linea} ${p}` : p;
    if (f.widthOfTextAtSize(prueba, tam) <= ancho || !linea) linea = prueba;
    else { out.push(linea); linea = p; }
  }
  if (linea) out.push(linea);
  return out;
}

/** Lo que lleva cada ficha del catálogo. `frente`/`espalda`: claves de foto (las mismas que muestra la web). */
export interface FichaCatalogo { nombre: string; sku: string; colores: string[]; talles: string[]; frente: string | null; espalda: string | null }

/*
 * El PDF, compacto (uso interno): A4 con 2 columnas × 8 filas = 16 productos por hoja. Cada ficha: frente y espalda chicas a la
 * izquierda; nombre, SKU padre, colores y talles a la derecha. `foto(clave)` devuelve la imagen (WebP de la tienda) o null.
 */
export async function armarPdfCatalogo(fichas: FichaCatalogo[], foto: (clave: string) => Promise<Buffer | null>): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Catálogo Isuwaya");
  const [normal, negrita] = await Promise.all([doc.embedFont(StandardFonts.Helvetica), doc.embedFont(StandardFonts.HelveticaBold)]);
  const marca = rgb(0.173, 0.373, 0.569);   // #2c5f91, el azul de la marca
  const tenue = rgb(0.42, 0.42, 0.42);
  const tinta = rgb(0.09, 0.09, 0.09);

  // Las fotos, de a varias a la vez (en R2 cada lectura tarda). WebP → JPG chico: pdf-lib sólo acepta JPG/PNG.
  const claves = [...new Set(fichas.flatMap((f) => [f.frente, f.espalda]).filter((c): c is string => !!c))];
  const imagenes = new Map<string, PDFImage>();
  for (let i = 0; i < claves.length; i += 8) {
    await Promise.all(claves.slice(i, i + 8).map(async (clave) => {
      const crudo = await foto(clave).catch(() => null);
      if (!crudo) return;
      const jpg = await sharp(crudo).resize({ width: 240, withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 72 }).toBuffer().catch(() => null);
      if (jpg) imagenes.set(clave, await doc.embedJpg(jpg));
    }));
  }

  const [W, H] = [595.28, 841.89];   // A4
  const M = 22, cabecera = 22, sep = 10, COLS = 2, FILAS = 8;
  const anchoFicha = (W - 2 * M - sep) / COLS, altoFicha = (H - 2 * M - cabecera - sep * (FILAS - 1)) / FILAS;
  const altoFoto = altoFicha - 6, anchoFoto = altoFoto * 0.75, hueco = 3;
  const xTexto = 2 * anchoFoto + hueco + 8, anchoTexto = anchoFicha - xTexto - 4;
  const fecha = new Date().toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Argentina/Buenos_Aires" });
  const porHoja = COLS * FILAS, hojas = Math.ceil(fichas.length / porHoja);

  for (let h = 0; h < hojas; h++) {
    const pag = doc.addPage([W, H]);
    pag.drawText("Isuwaya · Catálogo interno", { x: M, y: H - M - 10, size: 10, font: negrita, color: marca });
    pag.drawText(seguro(`${fecha} · ${fichas.length} productos · hoja ${h + 1} de ${hojas}`, normal), { x: W - M - 190, y: H - M - 10, size: 8, font: normal, color: tenue });
    for (const [k, f] of fichas.slice(h * porHoja, (h + 1) * porHoja).entries()) {
      const col = k % COLS, fila = Math.floor(k / COLS);
      const x = M + col * (anchoFicha + sep), y = H - M - cabecera - (fila + 1) * altoFicha - fila * sep;
      pag.drawRectangle({ x, y, width: anchoFicha, height: altoFicha, borderColor: rgb(0.9, 0.9, 0.89), borderWidth: 0.6 });
      [f.frente, f.espalda].forEach((clave, j) => {
        const fx = x + 3 + j * (anchoFoto + hueco), fy = y + 3;
        pag.drawRectangle({ x: fx, y: fy, width: anchoFoto, height: altoFoto, color: rgb(0.965, 0.965, 0.96) });
        const img = clave ? imagenes.get(clave) : undefined;
        if (img) {
          const e = Math.min(anchoFoto / img.width, altoFoto / img.height);
          pag.drawImage(img, { x: fx + (anchoFoto - img.width * e) / 2, y: fy + (altoFoto - img.height * e) / 2, width: img.width * e, height: img.height * e });
        } else pag.drawText(j === 0 ? "Sin foto" : "Sin espalda", { x: fx + 4, y: fy + altoFoto / 2, size: 6, font: normal, color: tenue });
      });
      // Texto: nombre (hasta 2 líneas), SKU, colores (hasta 3) y talles (hasta 2).
      let ty = y + altoFicha - 12;
      const escribir = (texto: string, fuente: PDFFont, tam: number, color: ReturnType<typeof rgb>, max: number) => {
        const ls = lineas(seguro(texto, fuente), fuente, tam, anchoTexto);
        for (const [i, l] of ls.slice(0, max).entries()) {
          pag.drawText(i === max - 1 && ls.length > max ? `${l.slice(0, -1)}…` : l, { x: x + xTexto, y: ty, size: tam, font: fuente, color });
          ty -= tam + 2;
        }
      };
      escribir(f.nombre, negrita, 8.5, tinta, 2);
      escribir(f.sku, normal, 7.5, marca, 1);
      ty -= 2;
      escribir(`Colores: ${f.colores.length ? f.colores.join(", ") : "—"}`, normal, 6.8, tinta, 3);
      escribir(`Talles: ${f.talles.length ? [...f.talles].sort(compararTalles).join(" · ") : "—"}`, normal, 6.8, tinta, 2);
    }
  }
  return doc.save();
}

export async function rutasCatalogoPdf(app: FastifyInstance, deps: { pool: pg.Pool; env: Entorno; fotos: Almacen | null }) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const { pool } = deps;
  const ip = (req: FastifyRequest) => ipDe(req, deps.env.INTERNO_TOKEN);

  api.get("/v1/admin/catalogo", async (req) => {
    await exigir(pool, req);
    const { rows } = await pool.query(
      `SELECT p.id, p.nombre, p.stocker_padre AS sku, p.visible, p.en_catalogo AS "enCatalogo",
              (SELECT f.clave FROM tienda.fotos f WHERE f.producto_id = p.id ORDER BY (f.tipo = 'color') DESC, f.orden, f.id LIMIT 1) AS foto,
              (SELECT count(*)::int FROM tienda.fotos f WHERE f.producto_id = p.id) AS fotos
         FROM tienda.productos p WHERE p.eliminado_en IS NULL ORDER BY p.nombre, p.id`);
    return { productos: rows };
  });

  // La selección completa: lo que está en la lista entra, el resto sale.
  api.put("/v1/admin/catalogo", { schema: { body: Seleccion } }, async (req) => {
    const a = await exigir(pool, req, "operador");
    const ids = [...new Set(req.body.ids)];
    const r = await pool.query("UPDATE tienda.productos SET en_catalogo = (id = ANY($1::int[])) WHERE en_catalogo IS DISTINCT FROM (id = ANY($1::int[]))", [ids]);
    await auditar(pool, a, "seleccionar_catalogo", "catalogo", null, { cantidad: ids.length }, ip(req));
    return { ok: true, cambiados: r.rowCount ?? 0 };
  });

  api.get("/v1/admin/catalogo/pdf", async (req, reply) => {
    const a = await exigir(pool, req);
    const { rows: productos } = await pool.query<{ id: number; nombre: string; sku: string; colores: string[]; talles: string[] }>(
      `SELECT p.id, p.nombre, p.stocker_padre AS sku,
              COALESCE((SELECT array_agg(c.nombre ORDER BY c.orden, c.id) FROM tienda.producto_colores c
                         WHERE c.producto_id = p.id AND EXISTS (SELECT 1 FROM tienda.variantes v WHERE v.color_id = c.id AND v.activo)), '{}') AS colores,
              COALESCE((SELECT array_agg(DISTINCT v.talle) FROM tienda.variantes v WHERE v.producto_id = p.id AND v.activo AND v.talle IS NOT NULL), '{}') AS talles
         FROM tienda.productos p WHERE p.en_catalogo AND p.eliminado_en IS NULL ORDER BY p.nombre, p.id LIMIT $1`, [MAX_PRODUCTOS]);
    if (!productos.length) throw new ErrorHttp(400, "catalogo_vacio", "Elegí al menos un producto para el catálogo.");
    const { rows: fotos } = await pool.query<Foto>(
      "SELECT producto_id, clave, origen, alt, color_id FROM tienda.fotos WHERE producto_id = ANY($1::int[]) ORDER BY producto_id, (tipo = 'color') DESC, orden, id",
      [productos.map((p) => p.id)]);

    const pdf = await armarPdfCatalogo(productos.map((p) => {
      const [frente, espalda] = frenteYEspalda(fotos.filter((f) => f.producto_id === p.id));
      return { nombre: p.nombre, sku: p.sku, colores: p.colores, talles: p.talles, frente: frente?.clave ?? null, espalda: espalda?.clave ?? null };
    }), async (clave) => (await deps.fotos?.leer(`${clave}-800.webp`)) ?? null);

    await auditar(pool, a, "descargar_catalogo", "catalogo", null, { productos: productos.length }, ip(req));
    reply.header("content-type", "application/pdf");
    reply.header("content-disposition", `attachment; filename="catalogo-isuwaya-${new Date().toISOString().slice(0, 10)}.pdf"`);
    reply.header("x-content-type-options", "nosniff");
    return reply.send(Buffer.from(pdf));
  });
}
