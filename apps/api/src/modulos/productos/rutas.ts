import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type pg from "pg";
import { z } from "zod";
import { ListadoProductos, ProductoDetalle, slug } from "@isu/shared";
import type { CacheCorta } from "../../lib/cache.js";
import { noEncontrado } from "../../lib/errores.js";
import { buscar, coleccion, detalle, fotosDelMenu, leerAjuste, productosDeCategoria, productosNuevos, slugsPublicables, tarjetas } from "./consultas.js";
import type { Descuentos } from "../../lib/descuentos.js";

/*
 * Catálogo público.
 *
 *   GET /v1/productos?categoria=mujer[&sub=remeras-y-tops]   grilla de una categoría
 *   GET /v1/productos?nuevos=8                               lo último que entró (home)
 *   GET /v1/productos?coleccion=packs[&categoria=hombre]     lo que se vende en pack (etapa 8; por categoría, etapa 9)
 *   GET /v1/productos?coleccion=liquidacion[&categoria=…]    lo que está en Liquidación (etapa 9)
 *   GET /v1/menu                                             fotos del menú: 1 o 2 prendas por categoría de arriba (etapa 9)
 *   GET /v1/productos/:slug                                  ficha
 *   GET /v1/buscar?q=remera                                  búsqueda
 *   GET /v1/productos-slugs                                  para el sitemap
 *
 * La grilla devuelve la categoría entera (no paginada): los filtros de talle,
 * color y orden son instantáneos en el navegador y la página sale completa
 * para Google. Con el tope de 1000 por categoría sigue siendo una respuesta
 * chica (sin descripciones ni variantes sueltas).
 */
const CACHE_PUBLICO = "public, max-age=30, s-maxage=60, stale-while-revalidate=300";

export async function rutasProductos(app: FastifyInstance, deps: { pool: pg.Pool; cache: CacheCorta; descuentos: Descuentos }) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const agotadosVisibles = () => deps.cache.obtener("ajuste:mostrarAgotados", () => leerAjuste(deps.pool, "mostrarAgotados", true));

  const categoriaId = async (cat: string, sub?: string) => {
    const { rows } = await deps.pool.query<{ id: number }>(
      sub
        ? `SELECT h.id FROM tienda.categorias h JOIN tienda.categorias p ON p.id = h.padre_id
            WHERE p.slug = $1 AND p.padre_id IS NULL AND h.slug = $2 AND h.visible AND p.visible`
        : "SELECT id FROM tienda.categorias WHERE slug = $1 AND padre_id IS NULL AND visible",
      sub ? [cat, sub] : [cat],
    );
    return rows[0]?.id ?? null;
  };

  api.get(
    "/v1/productos",
    {
      schema: {
        querystring: z.union([
          // limite: el inicio pide unas pocas (y sólo con stock) para las pestañas Mujer / Hombre.
          z.object({ categoria: slug, sub: slug.optional(), limite: z.coerce.number().int().min(1).max(24).optional() }).strict(),
          z.object({ nuevos: z.coerce.number().int().min(1).max(24) }).strict(),
          // Colecciones elegidas en el backoffice (sección del inicio y su página).
          z.object({
            coleccion: z.enum(["nuevos", "destacados", "packs", "liquidacion"]), limite: z.coerce.number().int().min(1).max(200).default(200),
            // Etapa 9: /packs/hombre, /liquidacion/mujer (una categoría de arriba, con sus hijas).
            categoria: slug.optional(),
          }).strict(),
        ]),
        response: { 200: ListadoProductos },
      },
    },
    async (req, reply) => {
      const q = req.query;
      const clave = "nuevos" in q ? `nuevos:${q.nuevos}` : "coleccion" in q ? `col:${q.coleccion}:${q.limite}:${q.categoria ?? ""}` : `cat:${q.categoria}/${q.sub ?? ""}:${q.limite ?? ""}`;
      const r = await deps.cache.obtener(clave, async () => {
        let filas;
        if ("nuevos" in q) {
          // Lo marcado como nuevo; si todavía no se marcó nada, lo último que entró.
          filas = await coleccion(deps.pool, "nuevos", q.nuevos);
          if (!filas.length) filas = await productosNuevos(deps.pool, q.nuevos);
        } else if ("coleccion" in q) {
          const id = q.categoria ? await categoriaId(q.categoria) : null;
          if (q.categoria && id === null) return null;
          filas = await coleccion(deps.pool, q.coleccion, q.limite, id);
        }
        else {
          const id = await categoriaId(q.categoria, q.sub);
          if (id === null) return null;
          filas = await productosDeCategoria(deps.pool, id, q.limite, !!q.limite);
        }
        const recorte = "nuevos" in q || ("categoria" in q && !!q.limite);
        const productos = await tarjetas(deps.pool, filas, recorte ? false : await agotadosVisibles(), deps.descuentos);
        return { productos, total: productos.length };
      });
      if (!r) throw noEncontrado("Categoría");
      reply.header("cache-control", CACHE_PUBLICO);
      return r;
    },
  );

  api.get("/v1/menu", {
    schema: {
      response: { 200: z.object({ categorias: z.array(z.object({ categoria: z.string(), productos: z.array(z.object({ slug: z.string(), nombre: z.string(), foto: z.object({ clave: z.string(), ancho: z.number().int().nullable(), alto: z.number().int().nullable(), alt: z.string().nullable() }) })) })) }) },
    },
  }, async (_req, reply) => {
    reply.header("cache-control", CACHE_PUBLICO);
    return { categorias: await deps.cache.obtener("menu", () => fotosDelMenu(deps.pool)) };
  });

  api.get(
    "/v1/productos/:slug",
    { schema: { params: z.object({ slug }), response: { 200: ProductoDetalle } } },
    async (req, reply) => {
      const p = await deps.cache.obtener(`producto:${req.params.slug}`, () => detalle(deps.pool, req.params.slug, deps.descuentos));
      if (!p) throw noEncontrado("Producto");
      reply.header("cache-control", CACHE_PUBLICO);
      return p;
    },
  );

  api.get(
    "/v1/buscar",
    {
      schema: {
        querystring: z.object({ q: z.string().trim().min(2).max(60) }).strict(),
        response: { 200: ListadoProductos },
      },
    },
    async (req, reply) => {
      // Cada búsqueda es distinta: no pasa por la caché de memoria (se la llenaría de basura).
      const productos = await tarjetas(deps.pool, await buscar(deps.pool, req.query.q, 48), await agotadosVisibles(), deps.descuentos);
      reply.header("cache-control", "public, max-age=30, s-maxage=60");
      return { productos, total: productos.length };
    },
  );

  api.get(
    "/v1/productos-slugs",
    { schema: { response: { 200: z.array(z.object({ slug, nombre: z.string(), actualizadoEn: z.string(), fotos: z.array(z.string()) })) } } },
    async (_req, reply) => {
      reply.header("cache-control", "public, max-age=300, s-maxage=600");
      return deps.cache.obtener("slugs", () => slugsPublicables(deps.pool));
    },
  );
}
