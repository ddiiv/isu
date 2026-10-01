import type pg from "pg";
import { proponerCategorias, rutaVieja } from "@isu/shared";

/*
 * Lee la tienda anterior (Jumpseller u otra con sitemap.xml) y arma las
 * redirecciones que falten: cada producto por su SKU, con su categoría de
 * esta tienda como plan B; el resto, a la categoría que se deduce de la
 * dirección. La migración 0012 ya trae las 70 del 30/09/2026: esto es para
 * lo que se haya agregado después.
 */
export type Pedir = (url: string) => Promise<{ ok: boolean; status: number; texto: string }>;

export const pedirWeb: Pedir = async (url) => {
  const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20_000), headers: { "user-agent": "isu-tienda/redirecciones" } });
  return { ok: r.ok, status: r.status, texto: r.ok ? await r.text() : "" };
};

const locs = (xml: string) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]!.replace(/&amp;/g, "&"));

/** Todas las direcciones del sitemap (sigue los índices de sitemaps, un nivel). */
export async function leerSitemap(base: string, pedir: Pedir): Promise<string[]> {
  const r = await pedir(`${base}/sitemap.xml`);
  if (!r.ok) throw new Error(`${base}/sitemap.xml respondió ${r.status}`);
  if (!/<sitemapindex/i.test(r.texto)) return locs(r.texto);
  const todas: string[] = [];
  for (const s of locs(r.texto).slice(0, 50)) {
    const h = await pedir(s);
    if (h.ok) todas.push(...locs(h.texto));
  }
  return todas;
}

/** El SKU padre de una ficha: en los datos estructurados, el más corto (los de cada talle lo extienden). */
export function skuDePagina(html: string): { sku: string | null; titulo: string | null } {
  const skus = [...html.matchAll(/"sku"\s*:\s*"([A-Za-z0-9._-]{2,100})"/g)].map((m) => m[1]!);
  const sku = skus.sort((a, b) => a.length - b.length)[0]?.toUpperCase() ?? null;
  const titulo = html.match(/<title>([^<]*)/)?.[1]?.trim() ?? null;
  return { sku, titulo };
}

export interface Propuesta { desde: string; sku: string | null; hacia: string; nota: string }

/** Plan B de un producto: su categoría en esta tienda (si ya está), o la que sugiere el título. */
export async function planBDe(pool: pg.Pool, sku: string | null, texto: string): Promise<{ hacia: string; nota: string }> {
  if (sku) {
    const { rows } = await pool.query<{ ruta: string; nombre: string }>(
      `SELECT CASE WHEN c.padre_id IS NULL THEN '/' || c.slug ELSE '/' || pa.slug || '/' || c.slug END AS ruta, p.nombre
         FROM tienda.productos p
         JOIN tienda.producto_categorias pc ON pc.producto_id = p.id
         JOIN tienda.categorias c ON c.id = pc.categoria_id
         LEFT JOIN tienda.categorias pa ON pa.id = c.padre_id
        WHERE upper(p.stocker_padre) = $1
        ORDER BY (c.padre_id IS NOT NULL) DESC, c.id LIMIT 1`, [sku]);
    if (rows[0]) return { hacia: rows[0].ruta, nota: `producto ${rows[0].nombre}` };
  }
  const [cat] = proponerCategorias(null, null, texto.replace(/\bdama\b/gi, "mujer").replace(/\bni[nñ]o\b/gi, "niños").replace(/[-/]/g, " "));
  if (cat) return { hacia: `/${cat[0]}${cat[1] ? `/${cat[1]}` : ""}`, nota: sku ? `SKU ${sku} todavía no está en la tienda: plan B por el título` : "deducido de la dirección" };
  return { hacia: "/", nota: "no se pudo deducir: va al inicio (revisalo en el backoffice)" };
}

/** Lo que falta redirigir de la tienda anterior. */
export async function proponer(pool: pg.Pool, base: string, pedir: Pedir, opciones: { pausaMs?: number; log?: (s: string) => void } = {}): Promise<Propuesta[]> {
  const urls = await leerSitemap(base, pedir);
  const existentes = new Set((await pool.query<{ desde: string }>("SELECT desde FROM tienda.redirecciones")).rows.map((r) => r.desde));
  const out: Propuesta[] = [];
  const vistas = new Set<string>();
  for (const u of urls) {
    const desde = rutaVieja(u);
    if (!desde || existentes.has(desde) || vistas.has(desde)) continue;
    vistas.add(desde);
    // Las fichas de Jumpseller cuelgan de la raíz (/abel-pantalon-hombre); las categorías tienen más tramos.
    let sku: string | null = null;
    let texto = desde;
    if (desde.split("/").length === 2) {
      const r = await pedir(u).catch(() => null);
      if (r?.ok) { const d = skuDePagina(r.texto); sku = d.sku; texto = d.titulo ?? desde; }
      if (opciones.pausaMs) await new Promise((s) => setTimeout(s, opciones.pausaMs));
    }
    const plan = await planBDe(pool, sku, `${texto} ${desde}`);
    if (plan.hacia === desde) continue;
    out.push({ desde, sku, ...plan });
    opciones.log?.(`  ${desde}  →  ${sku ? `ficha de ${sku}, si no ` : ""}${plan.hacia}   (${plan.nota})`);
  }
  return out;
}

export async function guardar(pool: pg.Pool, propuestas: Propuesta[]): Promise<number> {
  if (!propuestas.length) return 0;
  const r = await pool.query(
    `INSERT INTO tienda.redirecciones (desde, sku, hacia, origen, creado_por)
     SELECT d, s, h, 'jumpseller', 'importador' FROM unnest($1::text[], $2::text[], $3::text[]) AS t(d, s, h)
     ON CONFLICT (desde) DO NOTHING`,
    [propuestas.map((p) => p.desde), propuestas.map((p) => p.sku), propuestas.map((p) => p.hacia)]);
  return r.rowCount ?? 0;
}
