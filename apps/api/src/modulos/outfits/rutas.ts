import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type pg from "pg";
import {
  PedidoOutfits, RespuestaOutfits, combinan, familiaDeColor, normalizarTalle, parteDe, recomendarTalle,
  type Familia, type FotoPublica, type Parte, type PiezaOutfit,
} from "@isu/shared";
import type { CacheCorta } from "../../lib/cache.js";
import { conRebaja, type Descuentos } from "../../lib/descuentos.js";
import { guiaDe } from "../productos/consultas.js";

/*
 * POST /v1/outfits — "Armá tu outfit".
 *
 * Se parte de las prendas publicadas de "Mujer", "Hombre" o "Niños" que
 * tienen stock. Cada una se ubica en una parte (arriba, abajo, abrigo: por
 * su categoría, o lo que diga el backoffice) y se queda sólo con los colores
 * que hay en el talle del cliente. Si el cliente cargó medidas en vez de
 * talle, el talle sale de la guía de talles de ESA prenda (una remera
 * oversize y una al cuerpo no dan el mismo talle).
 *
 * Después se prueban combinaciones al azar (con semilla: "Otras ideas" pide
 * otra semilla) y se quedan las que entran en el presupuesto, combinan de
 * color y aprovechan mejor la plata, sin repetir prendas entre outfits.
 *
 * Es POST porque las medidas del cliente no tienen que quedar en URLs ni en
 * logs de terceros. No se guarda nada.
 */
const OUTFITS = 6;
const INTENTOS = 4000;

interface Opcion extends PiezaOutfit { familia: Familia }
interface Candidato {
  id: number; slug: string; nombre: string; parte: Parte;
  guia: ReturnType<typeof guiaDe>;
  variantes: Array<{ sku: string; talle: string | null; precio: number; precioLista: number | null; color: { clave: string; nombre: string; hex: string | null } | null; foto: FotoPublica | null }>;
}

/** Números al azar repetibles (mulberry32): la misma semilla da las mismas ideas. */
function azar(semilla: number) {
  let a = (semilla * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function rutasOutfits(app: FastifyInstance, deps: { pool: pg.Pool; cache: CacheCorta; descuentos: Descuentos }) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const { pool } = deps;

  /* Las prendas con stock de una categoría de arriba, ya con descuento. Cacheado (es igual para todos). */
  const candidatos = (para: string) => deps.cache.obtener(`outfits:${para}`, async (): Promise<Candidato[]> => {
    const ps = await pool.query<{ id: number; slug: string; nombre: string; stocker_categoria: string | null; parte_outfit: string | null; guia: Record<string, unknown> | null }>(
      `SELECT p.id, p.slug, p.nombre, p.stocker_categoria, p.parte_outfit,
              CASE WHEN g.id IS NULL THEN NULL ELSE jsonb_build_object('nombre', g.nombre, 'tipo', g.tipo, 'medidas', g.medidas, 'filas', g.filas, 'nota', g.nota) END AS guia
         FROM tienda.productos p LEFT JOIN tienda.guias_talles g ON g.id = p.guia_talles_id
        WHERE p.visible AND p.en_stocker AND p.parte_outfit IS DISTINCT FROM 'ninguna'
          AND EXISTS (SELECT 1 FROM tienda.producto_categorias pc JOIN tienda.categorias c ON c.id = pc.categoria_id
                       LEFT JOIN tienda.categorias pa ON pa.id = c.padre_id
                      WHERE pc.producto_id = p.id AND c.visible AND COALESCE(pa.slug, c.slug) = $1)
        LIMIT 2000`, [para]);
    const usables = ps.rows.map((p) => ({ ...p, parte: (p.parte_outfit as Parte | null) ?? parteDe(p.stocker_categoria, p.nombre) })).filter((p) => p.parte);
    if (!usables.length) return [];
    const ids = usables.map((p) => p.id);
    const [vs, cs, fs, pct] = await Promise.all([
      pool.query<{ producto_id: number; sku: string; talle: string | null; precio: number; color_id: number | null }>(
        "SELECT producto_id, sku, talle, precio, color_id FROM tienda.variantes WHERE producto_id = ANY($1::int[]) AND activo AND stock > 0 ORDER BY orden, id", [ids]),
      pool.query<{ id: number; clave: string; nombre: string; hex: string | null }>(
        "SELECT id, clave, nombre, hex FROM tienda.producto_colores WHERE producto_id = ANY($1::int[]) AND activo", [ids]),
      pool.query<{ producto_id: number; tipo: string; color_id: number | null; clave: string; ancho: number | null; alto: number | null; alt: string | null }>(
        "SELECT producto_id, tipo, color_id, clave, ancho, alto, alt FROM tienda.fotos WHERE producto_id = ANY($1::int[]) ORDER BY (tipo = 'color') DESC, orden, id", [ids]),
      deps.descuentos.para(ids),
    ]);
    const colores = new Map(cs.rows.map((c) => [c.id, c]));
    const fotoDe = (productoId: number, colorId: number | null): FotoPublica | null => {
      const f = fs.rows.find((x) => x.producto_id === productoId && x.color_id === colorId && colorId !== null)
        ?? fs.rows.find((x) => x.producto_id === productoId && x.tipo === "exhibicion")
        ?? fs.rows.find((x) => x.producto_id === productoId);
      return f ? { clave: f.clave, ancho: f.ancho, alto: f.alto, alt: f.alt } : null;
    };
    return usables.map((p) => ({
      id: p.id, slug: p.slug, nombre: p.nombre, parte: p.parte!, guia: guiaDe(p.guia),
      variantes: vs.rows.filter((v) => v.producto_id === p.id).map((v) => {
        const c = v.color_id ? colores.get(v.color_id) : undefined;
        const d = pct.get(p.id) ?? 0;
        return {
          sku: v.sku, talle: v.talle,
          precio: conRebaja(v.precio, d),
          precioLista: d ? v.precio : null,
          color: c ? { clave: c.clave, nombre: c.nombre, hex: c.hex } : null,
          foto: fotoDe(p.id, v.color_id),
        };
      }),
    })).filter((p) => p.variantes.length);
  });

  api.post("/v1/outfits", { schema: { body: PedidoOutfits, response: { 200: RespuestaOutfits } } }, async (req, reply) => {
    reply.header("cache-control", "no-store");
    const b = req.body;
    const talle = b.talle ? normalizarTalle(b.talle) : null;
    const lista = await candidatos(b.para);

    // Una opción por producto y color que hay en el talle del cliente.
    const opciones = new Map<Parte, Opcion[]>();
    let sinTalle = 0;
    for (const p of lista) {
      if (!b.partes.includes(p.parte) && b.reemplazar?.parte !== p.parte) continue;
      let buscado = talle;
      let recomendado = false;
      if (!buscado) {
        const r = p.guia ? recomendarTalle(p.guia, b.medidas) : null;
        if (!r?.talle) { sinTalle++; continue; }
        buscado = r.talle;
        recomendado = true;
      }
      const vistos = new Set<string>();
      for (const v of p.variantes) {
        // Prendas de talle único entran para cualquiera.
        const tv = v.talle ? normalizarTalle(v.talle) : null;
        if (tv && tv !== buscado && !/^(U|UNICO|ÚNICO)$/.test(tv)) continue;
        const clave = v.color?.clave ?? "-";
        if (vistos.has(clave)) continue;
        vistos.add(clave);
        const familia = familiaDeColor(v.color?.hex);
        if (b.familias.length && familia !== "neutros" && !b.familias.includes(familia)) continue;
        const o: Opcion = {
          parte: p.parte, productoId: p.id, slug: p.slug, nombre: p.nombre, sku: v.sku, color: v.color, talle: v.talle,
          talleRecomendado: recomendado && !!tv, precio: v.precio, precioLista: v.precioLista, foto: v.foto, familia,
        };
        opciones.set(p.parte, [...(opciones.get(p.parte) ?? []), o]);
      }
    }
    const sinFamilia = ({ familia: _f, ...o }: Opcion): PiezaOutfit => o;
    const rnd = azar(b.semilla + 1);
    const mezclar = <T>(xs: T[]) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; } return a; };

    // "Cambiar esta prenda": alternativas para una parte, con lo que queda del presupuesto.
    if (b.reemplazar) {
      const fijos = b.reemplazar.fijos.map((sku) => [...opciones.values()].flat().find((o) => o.sku === sku)).filter((o): o is Opcion => !!o);
      const resto = b.presupuesto - fijos.reduce((s, o) => s + o.precio, 0);
      const excluir = new Set([...b.reemplazar.excluir, ...fijos.map((f) => f.productoId)]);
      const alternativas = mezclar(opciones.get(b.reemplazar.parte) ?? [])
        .filter((o) => !excluir.has(o.productoId) && o.precio <= resto && combinan([...fijos.map((f) => f.familia), o.familia]));
      const unicas = alternativas.filter((o, i) => alternativas.findIndex((x) => x.productoId === o.productoId) === i).slice(0, 8);
      return { outfits: [], alternativas: unicas.map(sinFamilia), motivo: unicas.length ? "ok" as const : "presupuesto" as const, minimo: null };
    }

    const partes = b.partes;
    const faltan = partes.filter((p) => !(opciones.get(p)?.length));
    if (faltan.length) return { outfits: [], motivo: sinTalle && !talle ? "sin_talle" as const : "sin_prendas" as const, minimo: null };
    const minimo = partes.reduce((s, p) => s + Math.min(...opciones.get(p)!.map((o) => o.precio)), 0);
    if (minimo > b.presupuesto) return { outfits: [], motivo: "presupuesto" as const, minimo };

    const preferidas: Familia[] = b.familias.filter((f) => f !== "neutros");
    const posibles: Array<{ piezas: Opcion[]; total: number; puntaje: number }> = [];
    const vistas = new Set<string>();
    for (let i = 0; i < INTENTOS && posibles.length < 60; i++) {
      const piezas = partes.map((p) => { const os = opciones.get(p)!; return os[Math.floor(rnd() * os.length)]!; });
      const total = piezas.reduce((s, o) => s + o.precio, 0);
      if (total > b.presupuesto) continue;
      const clave = piezas.map((o) => o.sku).join("|");
      if (vistas.has(clave)) continue;
      vistas.add(clave);
      const familias = piezas.map((o) => o.familia);
      if (!combinan(familias)) continue;
      // Con colores elegidos, que al menos una prenda sea de esos colores (no todo negro).
      if (preferidas.length && !familias.some((f) => preferidas.includes(f))) continue;
      // Aprovechar el presupuesto suma; un poco de azar para que no salga siempre lo mismo.
      posibles.push({ piezas, total, puntaje: total / b.presupuesto + rnd() * 0.35 });
    }
    posibles.sort((a, b2) => b2.puntaje - a.puntaje);
    // Sin repetir prendas entre outfits (si alcanza la variedad).
    const elegidos: typeof posibles = [];
    const usados = new Set<number>();
    for (const o of posibles) {
      if (elegidos.length >= OUTFITS) break;
      if (o.piezas.some((p) => usados.has(p.productoId))) continue;
      elegidos.push(o);
      o.piezas.forEach((p) => usados.add(p.productoId));
    }
    for (const o of posibles) {
      if (elegidos.length >= OUTFITS) break;
      if (!elegidos.includes(o)) elegidos.push(o);
    }
    return {
      outfits: elegidos.map((o) => ({ piezas: o.piezas.map(sinFamilia), total: o.total })),
      motivo: elegidos.length ? "ok" as const : "presupuesto" as const,
      minimo,
    };
  });
}
