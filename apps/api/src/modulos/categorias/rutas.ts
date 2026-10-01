import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { CategoriaNodo, slug } from "@isu/shared";
import { esquema, type Db } from "@isu/db";
import type { CacheCorta } from "../../lib/cache.js";
import { noEncontrado } from "../../lib/errores.js";

/* Árbol de categorías visibles (dos niveles). Lo usa el menú y el sitemap. */
export async function rutasCategorias(app: FastifyInstance, deps: { db: Db; cache: CacheCorta }) {
  const arbol = async (): Promise<CategoriaNodo[]> => {
    const filas = await deps.db
      .select({
        id: esquema.categorias.id, padreId: esquema.categorias.padreId, nombre: esquema.categorias.nombre, slug: esquema.categorias.slug,
        seoTitulo: esquema.categorias.seoTitulo, seoDescripcion: esquema.categorias.seoDescripcion, texto: esquema.categorias.texto,
      })
      .from(esquema.categorias)
      .where(eq(esquema.categorias.visible, true))
      .orderBy(asc(esquema.categorias.orden), asc(esquema.categorias.nombre));
    const raices = filas.filter((f) => f.padreId === null);
    const nodo = (f: (typeof filas)[number], hijas: CategoriaNodo[]): CategoriaNodo => ({
      id: f.id, nombre: f.nombre, slug: f.slug, hijas, seoTitulo: f.seoTitulo, seoDescripcion: f.seoDescripcion, texto: f.texto,
    });
    return raices.map((r) => nodo(r, filas.filter((f) => f.padreId === r.id).map((h) => nodo(h, []))));
  };

  const api = app.withTypeProvider<ZodTypeProvider>();
  api.get("/v1/categorias", { schema: { response: { 200: z.array(CategoriaNodo) } } }, async (_req, reply) => {
    reply.header("cache-control", "public, max-age=60, s-maxage=300, stale-while-revalidate=600");
    return deps.cache.obtener("categorias", arbol);
  });

  // El slug se valida ANTES de llegar a la base: nada que no sea [a-z0-9-] entra a una consulta.
  api.get(
    "/v1/categorias/:slug",
    { schema: { params: z.object({ slug }), response: { 200: CategoriaNodo } } },
    async (req, reply) => {
      const cat = (await deps.cache.obtener("categorias", arbol)).find((c) => c.slug === req.params.slug);
      if (!cat) throw noEncontrado("Categoría");
      reply.header("cache-control", "public, max-age=60, s-maxage=300, stale-while-revalidate=600");
      return cat;
    },
  );
}
