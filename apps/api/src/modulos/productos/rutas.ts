import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type pg from "pg";
import { z } from "zod";
import { ListadoProductos, ProductoDetalle, slug } from "@isu/shared";
import type { CacheCorta } from "../../lib/cache.js";
import { noEncontrado } from "../../lib/errores.js";
import { buscar, coleccion, detalle, leerAjuste, productosDeCategoria, productosNuevos, slugsPublicables, tarjetas } from "./consultas.js";
import type { Descuentos } from "../../lib/descuentos.js";

/*
 * Catálogo público.
 *
 *   GET /v1/productos?categoria=mujer[&sub=remeras-y-tops]   grilla de una categoría
 *   GET /v1/productos?nuevos=8                               lo último que entró (home)
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
          z.object({ categoria: slug, sub: slug.optional() }).strict(),
          z.object({ nuevos: z.coerce.number().int().min(1).max(24) }).strict(),
          // Colecciones elegidas en el backoffice (sección del inicio y su página).
          z.object({ coleccion: z.enum(["nuevos", "destacados"]), limite: z.coerce.number().int().min(1).max(200).default(200) }).strict(),
        ]),
        response: { 200: ListadoProductos },
      },
    },
    async (req, reply) => {
      const q = req.query;
      const clave = "nuevos" in q ? `nuevos:${q.nuevos}` : "coleccion" in q ? `col:${q.coleccion}:${q.limite}` : `cat:${q.categoria}/${q.sub ?? ""}`;
      const r = await deps.cache.obtener(clave, async () => {
        let filas;
        if ("nuevos" in q) {
          // Lo marcado como nuevo; si todavía no se marcó nada, lo último que entró.
          filas = await coleccion(deps.pool, "nuevos", q.nuevos);
          if (!filas.length) filas = await productosNuevos(deps.pool, q.nuevos);
        } else if ("coleccion" in q) filas = await coleccion(deps.pool, q.coleccion, q.limite);
        else {
          const id = await categoriaId(q.categoria, q.sub);
          if (id === null) return null;
          filas = await productosDeCategoria(deps.pool, id);
        }
        const productos = await tarjetas(deps.pool, filas, "nuevos" in q ? false : await agotadosVisibles(), deps.descuentos);
        return { productos, total: productos.length };
      });
      if (!r) throw noEncontrado("Categoría");
      reply.header("cache-control", CACHE_PUBLICO);
      return r;
    },
  );

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
    { schema: { response: { 200: z.array(z.object({ slug, actualizadoEn: z.string() })) } } },
    async (_req, reply) => {
      reply.header("cache-control", "public, max-age=300, s-maxage=600");
      return deps.cache.obtener("slugs", () => slugsPublicables(deps.pool));
    },
  );
}
