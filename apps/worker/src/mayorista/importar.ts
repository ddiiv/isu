import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type pg from "pg";
import { z } from "zod";
import { aSlug, FOTOS_POR_COLOR, proponerCategorias } from "@isu/shared";
import type { Almacen } from "../fotos/almacen.js";
import { guardarFoto } from "../fotos/importar.js";
import { FotoInvalida, MAX_BYTES, procesarFoto } from "../fotos/procesar.js";
import { AJUSTES, CATEGORIAS, type Ajuste } from "./decisiones.js";

/*
 * Importa del sitio mayorista lo que Stocker no tiene: las fotos (con su
 * color y la principal primero), el color exacto de cada muestra y la
 * categoría de la tienda. El producto, el precio (el del mayorista es
 * mayorista) y el stock siguen viniendo sólo de Stocker.
 *
 * El enganche es por SKU: el padre ("ISUBOXPAN") y, si no aparece, por los
 * SKU de las combinaciones ("ISUBOXPANNEG4"), que son los de las variantes
 * de Stocker. El color de cada foto se resuelve igual: por los SKU de las
 * combinaciones de ese color, y si no, por el nombre.
 *
 * Cómo quedan las fotos:
 *   · la principal del mayorista → la primera de exhibición (es la de la
 *     grilla); si tiene color, lleva ese color y la ficha abre en él
 *   · las de un color → fotos de ese color (hasta 5, como pide la tienda)
 *   · las que no tienen color → exhibición general (se ven con todos)
 *   · el tope del producto (5 × colores) lo pone la base; lo que no entra
 *     se informa
 *
 * Es repetible: cada foto recuerda su origen ("mayorista:<id>") y la que ya
 * está no se vuelve a subir. Un producto con fotos cargadas a mano no se
 * toca (salvo con `reemplazar`). Sin `aplicar` no escribe nada: muestra lo
 * que haría.
 */

export const URL_MAYORISTA = "https://isumayoristapedidos-production.up.railway.app";
/* Las fotos siempre del mismo sitio y con esta forma: nada de rutas que lleven a otro lado. */
const RUTA_FOTO = /^\/fotos\/[A-Za-z0-9_-]{6,64}\.(jpe?g|png|webp)$/;
const HEX = /^#[0-9a-fA-F]{6}$/;

const Texto = (max: number) => z.string().trim().max(max);
export const CatalogoMayorista = z.object({
  categorias: z.array(z.object({ id: z.number(), nombre: Texto(80) })).max(500).default([]),
  productos: z.array(z.object({
    sku: Texto(60).min(3),
    titulo: Texto(200),
    categoriaId: z.number().nullish(),
    genero: Texto(40).nullish(),
    foto: Texto(200).nullish(),
    fotos: z.array(z.object({ ruta: Texto(200), color: Texto(60).nullish() })).max(300).default([]),
    colores: z.array(z.object({ nombre: Texto(60), hex: Texto(20).nullish() })).max(100).default([]),
    combinaciones: z.array(z.object({ sku: Texto(100), color: Texto(60).nullish(), talle: Texto(40).nullish() })).max(2000).default([]),
  })).max(3000),
});
export type CatalogoMayorista = z.infer<typeof CatalogoMayorista>;
type ProductoMayorista = CatalogoMayorista["productos"][number];

export interface FotoPlan {
  origen: string;
  ruta: string;
  tipo: "color" | "exhibicion";
  colorId: number | null;
  /** para el informe */
  color: string | null;
  principal: boolean;
}

export interface PlanProducto {
  sku: string;
  titulo: string;
  productoId: number;
  nombre: string;
  slug: string;
  categorias: string[];
  categoriaIds: number[];
  colores: Array<{ id: number; nombre: string; hex: string | null; nombreFijo: boolean }>;
  soloTalles: string[] | null;
  fotos: FotoPlan[];
  /** el orden de todas las del mayorista (la principal primero): una corrida que completa otra lo respeta */
  orden: string[];
  /** fotos que ya estaban (mismo origen) */
  yaEstaban: number;
  /** true: tiene fotos cargadas a mano y no se tocan */
  conFotosPropias: boolean;
  avisos: string[];
}

export interface Plan {
  productos: PlanProducto[];
  /** del mayorista y no de Stocker: no se pueden crear (Stocker manda) */
  sinProducto: Array<{ sku: string; titulo: string }>;
}

interface Tienda {
  productos: Array<{ id: number; padre: string; nombre: string; slug: string }>;
  variantes: Map<string, { productoId: number; colorId: number | null }>;
  colores: Map<number, Array<{ id: number; clave: string; nombre: string; activo: boolean }>>;
  fotos: Map<number, Array<{ origen: string | null }>>;
  categorias: Map<string, number>;
}

async function leerTienda(pool: pg.Pool): Promise<Tienda> {
  const [ps, vs, cs, fs, cats] = await Promise.all([
    pool.query<{ id: number; padre: string; nombre: string; slug: string }>(
      "SELECT id, upper(stocker_padre) AS padre, nombre, slug FROM tienda.productos WHERE en_stocker"),
    pool.query<{ sku: string; producto_id: number; color_id: number | null }>(
      "SELECT upper(v.sku) AS sku, v.producto_id, v.color_id FROM tienda.variantes v JOIN tienda.productos p ON p.id = v.producto_id AND p.en_stocker"),
    pool.query<{ id: number; producto_id: number; clave: string; nombre: string; activo: boolean }>(
      "SELECT id, producto_id, clave, nombre, activo FROM tienda.producto_colores ORDER BY orden, id"),
    pool.query<{ producto_id: number; origen: string | null }>("SELECT producto_id, origen FROM tienda.fotos"),
    pool.query<{ id: number; ruta: string }>(
      `SELECT c.id, COALESCE(p.slug || '/', '') || c.slug AS ruta FROM tienda.categorias c LEFT JOIN tienda.categorias p ON p.id = c.padre_id`),
  ]);
  const agrupar = <T extends { producto_id: number }>(filas: T[]) => {
    const m = new Map<number, T[]>();
    for (const f of filas) m.set(f.producto_id, [...(m.get(f.producto_id) ?? []), f]);
    return m;
  };
  return {
    productos: ps.rows,
    variantes: new Map(vs.rows.map((v) => [v.sku, { productoId: v.producto_id, colorId: v.color_id }])),
    colores: agrupar(cs.rows),
    fotos: agrupar(fs.rows),
    categorias: new Map(cats.rows.map((c) => [c.ruta, c.id])),
  };
}

function productoDe(m: ProductoMayorista, t: Tienda): Tienda["productos"][number] | null | "varios" {
  const padre = m.sku.toUpperCase();
  const porPadre = t.productos.filter((p) => p.padre === padre);
  if (porPadre.length === 1) return porPadre[0]!;
  if (porPadre.length > 1) return "varios";
  // Por las variantes: todas las combinaciones que Stocker conoce tienen que ser del mismo producto.
  const ids = new Set(m.combinaciones.map((c) => t.variantes.get(c.sku.toUpperCase())?.productoId).filter((x): x is number => x !== undefined));
  if (ids.size === 1) return t.productos.find((p) => p.id === [...ids][0]) ?? null;
  return ids.size > 1 ? "varios" : null;
}

/** Color del mayorista → id del color en la tienda (por los SKU de ese color; si no, por el nombre). */
function resolverColor(nombre: string, m: ProductoMayorista, productoId: number, t: Tienda): number | null {
  const votos = new Map<number, number>();
  for (const c of m.combinaciones) {
    if (c.color !== nombre) continue;
    const v = t.variantes.get(c.sku.toUpperCase());
    if (v?.productoId === productoId && v.colorId !== null) votos.set(v.colorId, (votos.get(v.colorId) ?? 0) + 1);
  }
  const ganador = [...votos].sort((a, b) => b[1] - a[1])[0];
  if (ganador) return ganador[0];
  const clave = aSlug(nombre, 40);
  return (t.colores.get(productoId) ?? []).find((c) => c.clave === clave)?.id ?? null;
}

const idDeRuta = (ruta: string) => ruta.replace(/^\/fotos\//, "").replace(/\.\w+$/, "");

function planDe(m: ProductoMayorista, prod: Tienda["productos"][number], t: Tienda, reemplazar: boolean, categoriasMayorista: Map<number, string>): PlanProducto {
  const sku = m.sku.toUpperCase();
  const ajuste: Ajuste = AJUSTES[sku] ?? {};
  const avisos: string[] = [];

  // ── Categorías ──
  let categorias = [...(CATEGORIAS[sku] ?? [])];
  if (!categorias.length) {
    const cat = m.categoriaId !== null && m.categoriaId !== undefined ? categoriasMayorista.get(m.categoriaId) : null;
    categorias = proponerCategorias(cat, m.genero, m.titulo).map(([padre, hija]) => (hija ? `${padre}/${hija}` : padre));
    if (categorias.length) avisos.push(`categoría deducida del nombre: ${categorias.join(" + ")}`);
    else avisos.push("no se pudo deducir la categoría: queda como está");
  }
  const categoriaIds: number[] = [];
  for (const c of categorias) {
    const id = t.categorias.get(c) ?? t.categorias.get(c.split("/")[0]!);
    if (id === undefined) avisos.push(`la categoría «${c}» no existe en la tienda`);
    else if (!categoriaIds.includes(id)) categoriaIds.push(id);
  }

  // ── Colores (hex del mayorista; nombre fijo si hay ajuste) ──
  const colores: PlanProducto["colores"] = [];
  const colorDe = new Map<string, number | null>();
  for (const c of m.colores) {
    const id = resolverColor(c.nombre, m, prod.id, t);
    colorDe.set(c.nombre, id);
    if (id === null) { avisos.push(`el color «${c.nombre}» no está en Stocker`); continue; }
    const aj = ajuste.colores?.[c.nombre];
    const hex = aj?.hex ?? (c.hex && HEX.test(c.hex) ? c.hex.toLowerCase() : null);
    colores.push({ id, nombre: aj?.nombre ?? c.nombre, hex, nombreFijo: !!aj });
  }

  // ── Fotos ──
  const actuales = t.fotos.get(prod.id) ?? [];
  const conFotosPropias = !reemplazar && actuales.some((f) => !f.origen?.startsWith("mayorista:"));
  const yaImportadas = new Set(reemplazar ? [] : actuales.map((f) => f.origen));
  const activos = (t.colores.get(prod.id) ?? []).filter((c) => c.activo).length;
  const tope = activos * 5;
  const fotos: FotoPlan[] = [];
  const ordenOrigenes: string[] = [];
  let yaEstaban = 0;
  if (conFotosPropias) {
    avisos.push("ya tiene fotos cargadas a mano: las fotos no se tocan");
  } else {
    // La principal primero; el resto en el orden del mayorista.
    const orden = [...m.fotos].sort((a, b) => Number(b.ruta === m.foto) - Number(a.ruta === m.foto));
    const porColor = new Map<number, number>();
    let total = actuales.length - (reemplazar ? actuales.length : 0);
    for (const f of orden) {
      if (!RUTA_FOTO.test(f.ruta)) { avisos.push(`foto con una ruta rara, salteada: ${f.ruta.slice(0, 60)}`); continue; }
      const origen = `mayorista:${idDeRuta(f.ruta)}`;
      ordenOrigenes.push(origen);
      if (yaImportadas.has(origen)) { yaEstaban++; continue; }
      const principal = f.ruta === m.foto;
      let colorId: number | null = null;
      if (f.color) {
        colorId = colorDe.has(f.color) ? colorDe.get(f.color)! : resolverColor(f.color, m, prod.id, t);
        // La principal entra igual (sin color); las demás de un color que no se vende, no.
        if (colorId === null && !principal) { avisos.push(`foto de «${f.color}», un color que no está en Stocker: salteada`); continue; }
      }
      const tipo = principal || colorId === null ? "exhibicion" : "color";
      if (tipo === "color") {
        const n = porColor.get(colorId!) ?? 0;
        if (n >= FOTOS_POR_COLOR) { avisos.push(`«${f.color}» ya tiene ${FOTOS_POR_COLOR} fotos: una salteada`); continue; }
        porColor.set(colorId!, n + 1);
      }
      if (total >= tope) { avisos.push(`tope de ${tope} fotos (5 × ${activos} colores): ${orden.length - orden.indexOf(f)} sin lugar`); break; }
      total++;
      fotos.push({ origen, ruta: f.ruta, tipo, colorId, color: f.color ?? null, principal });
    }
    if (!m.fotos.length) avisos.push("sin fotos en el mayorista: queda oculto");
  }
  return {
    sku: m.sku, titulo: m.titulo, productoId: prod.id, nombre: prod.nombre, slug: prod.slug,
    categorias, categoriaIds, colores, soloTalles: ajuste.soloTalles ? [...ajuste.soloTalles] : null,
    fotos, orden: ordenOrigenes, yaEstaban, conFotosPropias, avisos,
  };
}

export async function planificar(pool: pg.Pool, cat: CatalogoMayorista, o: { reemplazar?: boolean } = {}): Promise<Plan> {
  const t = await leerTienda(pool);
  const categoriasMayorista = new Map(cat.categorias.map((c) => [c.id, c.nombre]));
  const plan: Plan = { productos: [], sinProducto: [] };
  const vistos = new Set<number>();
  for (const m of cat.productos) {
    const prod = productoDe(m, t);
    if (prod === null || prod === "varios") { plan.sinProducto.push({ sku: m.sku, titulo: m.titulo }); continue; }
    if (vistos.has(prod.id)) { plan.sinProducto.push({ sku: m.sku, titulo: `${m.titulo} (repetido: ya se enganchó otro con el mismo producto)` }); continue; }
    vistos.add(prod.id);
    plan.productos.push(planDe(m, prod, t, !!o.reemplazar, categoriasMayorista));
  }
  return plan;
}

export type Descargar = (ruta: string) => Promise<Buffer>;

/*
 * Descarga del sitio mayorista: sólo rutas /fotos/…, con tope de tamaño y de
 * tiempo. Es el sitio de producción del mayorista: se le pide con calma (una
 * pausa entre pedidos) y, si contesta 429/5xx o se corta, se reintenta con
 * espera creciente (2, 4, 8 y 16 s, o lo que diga Retry-After).
 */
export function descargadorDe(base: string, o: { pausaMs?: number; esperas?: number[] } = {}): Descargar {
  const origen = new URL(base).origin;
  const pausa = o.pausaMs ?? 250;
  const esperas = o.esperas ?? [2_000, 4_000, 8_000, 16_000];
  let turno: Promise<unknown> = Promise.resolve();
  const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
  // De a un pedido por vez hacia el mayorista, con la pausa entre uno y otro.
  const enFila = <T>(fn: () => Promise<T>): Promise<T> => {
    const r = turno.then(fn);
    turno = r.then(() => dormir(pausa), () => dormir(pausa));
    return r;
  };
  const pedir = async (ruta: string): Promise<Buffer> => {
    const r = await fetch(`${origen}${ruta}`, { redirect: "error", signal: AbortSignal.timeout(60_000) });
    if (r.status === 429 || r.status >= 500) {
      const e = new Error(`el mayorista contestó ${r.status}`) as Error & { reintentar?: number };
      const ra = Number(r.headers.get("retry-after"));
      e.reintentar = Number.isFinite(ra) && ra > 0 ? Math.min(ra, 60) * 1000 : 0;
      throw e;
    }
    if (!r.ok) throw Object.assign(new Error(`el mayorista contestó ${r.status}`), { final: true });
    if (!/^image\//.test(r.headers.get("content-type") ?? "")) throw Object.assign(new Error("no es una imagen"), { final: true });
    if (Number(r.headers.get("content-length") ?? 0) > MAX_BYTES) throw Object.assign(new Error("pesa más de 25 MB"), { final: true });
    const b = Buffer.from(await r.arrayBuffer());
    if (b.length > MAX_BYTES) throw Object.assign(new Error("pesa más de 25 MB"), { final: true });
    return b;
  };
  return async (ruta) => {
    if (!RUTA_FOTO.test(ruta)) throw new Error("ruta de foto inválida");
    for (let intento = 0; ; intento++) {
      try {
        return await enFila(() => pedir(ruta));
      } catch (e) {
        const err = e as Error & { final?: boolean; reintentar?: number };
        if (err.final || intento >= esperas.length) throw err;
        await dormir(err.reintentar || esperas[intento]!);
      }
    }
  };
}

/** Guarda lo bajado en una carpeta: si hay que volver a correr la importación, no se le pide de nuevo al mayorista. */
export function conCache(descargar: Descargar, dir: string): Descargar {
  return async (ruta) => {
    if (!RUTA_FOTO.test(ruta)) throw new Error("ruta de foto inválida");
    // El nombre sale de la ruta ya validada (letras, números, - y _): no puede salirse de la carpeta.
    const archivo = path.join(dir, path.basename(ruta));
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- carpeta elegida por quien corre el comando; nombre validado
    const guardada = await readFile(archivo).catch(() => null);
    if (guardada) return guardada;
    const b = await descargar(ruta);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- ídem
    await mkdir(dir, { recursive: true }).then(() => writeFile(archivo, b)).catch(() => {});
    return b;
  };
}

export async function leerCatalogo(base: string): Promise<CatalogoMayorista> {
  const r = await fetch(`${new URL(base).origin}/api/catalogo`, { redirect: "error", signal: AbortSignal.timeout(60_000), headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`el mayorista contestó ${r.status}`);
  return CatalogoMayorista.parse(await r.json());
}

export interface Resultado {
  productos: number;
  fotosSubidas: number;
  fotosOmitidas: Array<{ sku: string; foto: string; motivo: string }>;
  ocultados: string[];
  mostrados: string[];
  /** slugs para regenerar */
  slugs: string[];
}

/*
 * Aplica el plan. Primero lo del producto (categorías, colores, talles) en
 * una transacción corta; después las fotos, cada una en la suya (ver
 * guardarFoto). Al final, visibilidad: sin ninguna foto → oculto; si no
 * tenía y ahora tiene → visible.
 */
export async function aplicar(
  pool: pg.Pool, almacen: Almacen, plan: Plan, descargar: Descargar,
  o: { reemplazar?: boolean; log?: (s: string) => void; paralelo?: number } = {},
): Promise<Resultado> {
  const log = o.log ?? (() => {});
  const res: Resultado = { productos: 0, fotosSubidas: 0, fotosOmitidas: [], ocultados: [], mostrados: [], slugs: [] };
  for (const p of plan.productos) {
    log(`${p.sku} · ${p.nombre}`);
    const cli = await pool.connect();
    let teniaFotos: boolean;
    try {
      await cli.query("BEGIN");
      await cli.query("SELECT 1 FROM tienda.productos WHERE id = $1 FOR UPDATE", [p.productoId]);
      if (p.categoriaIds.length) {
        await cli.query("DELETE FROM tienda.producto_categorias WHERE producto_id = $1", [p.productoId]);
        await cli.query("INSERT INTO tienda.producto_categorias (producto_id, categoria_id) SELECT $1, unnest($2::int[])", [p.productoId, p.categoriaIds]);
        // Fijas: la sincronización con Stocker ya no las recalcula.
        await cli.query("UPDATE tienda.productos SET categoria_id = $2, categorias_fijas = true, actualizado_en = now() WHERE id = $1", [p.productoId, p.categoriaIds[0]]);
      }
      for (const c of p.colores) {
        await cli.query(
          `UPDATE tienda.producto_colores SET hex = COALESCE($3, hex),
                  nombre = CASE WHEN $4 THEN $2 ELSE nombre END, nombre_fijo = nombre_fijo OR $4
            WHERE id = $1`,
          [c.id, c.nombre.slice(0, 60), c.hex, c.nombreFijo],
        );
      }
      if (p.soloTalles) {
        await cli.query(
          `UPDATE tienda.variantes SET oculta = x.oculta, activo = CASE WHEN x.oculta THEN false ELSE activo END, actualizado_en = now()
             FROM (SELECT id, NOT (COALESCE(talle, '') = ANY($2::text[])) AS oculta FROM tienda.variantes WHERE producto_id = $1) x
            WHERE tienda.variantes.id = x.id AND tienda.variantes.oculta IS DISTINCT FROM x.oculta`,
          [p.productoId, p.soloTalles],
        );
      }
      if (o.reemplazar && p.fotos.length) {
        const viejas = await cli.query<{ clave: string }>("DELETE FROM tienda.fotos WHERE producto_id = $1 RETURNING clave", [p.productoId]);
        await cli.query("COMMIT");
        for (const v of viejas.rows) for (const w of [400, 800, 1200]) await almacen.borrar(`${v.clave}-${w}.webp`).catch(() => {});
      } else {
        await cli.query("COMMIT");
      }
      teniaFotos = !!(await pool.query("SELECT 1 FROM tienda.fotos WHERE producto_id = $1 LIMIT 1", [p.productoId])).rowCount;
    } catch (e) {
      await cli.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      cli.release();
    }

    // Se adelantan unas pocas (la descarga va en fila; el procesado, en paralelo); el guardado, en orden.
    const paralelo = Math.max(1, o.paralelo ?? 3);
    const procesadas = new Map<string, Promise<Awaited<ReturnType<typeof procesarFoto>>>>();
    const preparar = (f: FotoPlan) => {
      if (!procesadas.has(f.origen)) procesadas.set(f.origen, descargar(f.ruta).then(procesarFoto));
      return procesadas.get(f.origen)!;
    };
    for (let i = 0; i < p.fotos.length; i++) {
      for (const g of p.fotos.slice(i, i + paralelo)) preparar(g).catch(() => {});
      const f = p.fotos[i]!;
      const nombre = `${f.principal ? "principal" : f.color ?? "general"} ${f.ruta}`;
      let proc;
      try {
        proc = await preparar(f);
      } catch (e) {
        const motivo = e instanceof FotoInvalida ? e.message : `no se pudo bajar: ${(e as Error).message}`;
        res.fotosOmitidas.push({ sku: p.sku, foto: f.ruta, motivo });
        log(`  ✗ ${nombre}: ${motivo}`);
        continue;
      } finally {
        procesadas.delete(f.origen);
      }
      const error = await guardarFoto(pool, almacen, { productoId: p.productoId, tipo: f.tipo, colorId: f.colorId, alt: p.nombre, origen: f.origen }, proc);
      if (error) { res.fotosOmitidas.push({ sku: p.sku, foto: f.ruta, motivo: error }); log(`  ✗ ${nombre}: ${error}`); }
      else { res.fotosSubidas++; log(`  ✓ ${nombre}`); }
    }

    // Si una corrida anterior quedó a medias, las que faltaban entraron al final: vuelven a su lugar.
    if (p.orden.length) {
      await pool.query(
        `UPDATE tienda.fotos f SET orden = x.pos FROM unnest($2::text[]) WITH ORDINALITY AS x(origen, pos)
          WHERE f.producto_id = $1 AND f.origen = x.origen AND f.orden IS DISTINCT FROM x.pos`,
        [p.productoId, p.orden],
      );
    }
    const tieneFotos = !!(await pool.query("SELECT 1 FROM tienda.fotos WHERE producto_id = $1 LIMIT 1", [p.productoId])).rowCount;
    if (!tieneFotos) {
      const r = await pool.query("UPDATE tienda.productos SET visible = false, actualizado_en = now() WHERE id = $1 AND visible", [p.productoId]);
      if (r.rowCount) res.ocultados.push(p.sku);
    } else if (!teniaFotos) {
      const r = await pool.query("UPDATE tienda.productos SET visible = true, actualizado_en = now() WHERE id = $1 AND NOT visible", [p.productoId]);
      if (r.rowCount) res.mostrados.push(p.sku);
    }
    res.productos++;
    res.slugs.push(p.slug);
  }
  return res;
}

/** El plan en texto, para revisarlo antes de aplicarlo. */
export function informe(plan: Plan): string {
  const l: string[] = [];
  for (const p of plan.productos) {
    const porColor = new Map<string, number>();
    for (const f of p.fotos) {
      const k = f.principal ? `principal${f.color ? ` (${f.color})` : ""}` : f.color ?? "generales";
      porColor.set(k, (porColor.get(k) ?? 0) + 1);
    }
    const fotos = p.conFotosPropias ? "fotos propias (no se tocan)"
      : `${p.fotos.length} fotos${p.yaEstaban ? ` (+${p.yaEstaban} ya estaban)` : ""}: ${[...porColor].map(([k, n]) => `${k} ${n}`).join(", ") || "—"}`;
    l.push(`${p.sku.padEnd(10)} ${p.nombre}`);
    l.push(`           → ${p.categorias.join(" + ") || "(sin categoría)"} · ${fotos}`);
    if (p.soloTalles) l.push(`           talles a la venta: ${p.soloTalles.join(", ")} (el resto, oculto)`);
    for (const c of p.colores.filter((x) => x.nombreFijo)) l.push(`           color: «${c.nombre}» ${c.hex ?? ""} (nombre fijo)`);
    for (const a of p.avisos) l.push(`           ! ${a}`);
  }
  if (plan.sinProducto.length) {
    l.push("", `Sin producto en Stocker (no se importan: hay que darlos de alta en Stocker primero): ${plan.sinProducto.length}`);
    for (const s of plan.sinProducto) l.push(`  ${s.sku} · ${s.titulo}`);
  }
  const fotos = plan.productos.reduce((n, p) => n + p.fotos.length, 0);
  l.push("", `${plan.productos.length} productos enganchados · ${fotos} fotos para subir · ${plan.sinProducto.length} sin producto en Stocker`);
  return l.join("\n");
}
