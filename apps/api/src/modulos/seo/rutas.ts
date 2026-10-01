import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Redis } from "ioredis";
import type pg from "pg";
import { z } from "zod";
import { MapaRedirecciones, RedireccionEntrada, rutaVieja } from "@isu/shared";
import type { Entorno } from "../../entorno.js";
import type { CacheCorta } from "../../lib/cache.js";
import type { Colas } from "../../lib/colas.js";
import { ErrorHttp } from "../../lib/errores.js";
import { ipDe } from "../../lib/cliente.js";
import { auditar, exigir } from "../admin/sesion.js";

/*
 * Redirecciones 301 de la tienda anterior (migración 0012).
 *
 *   GET /v1/redirecciones          el mapa resuelto, para la tienda (proxy.ts)
 *   /v1/admin/redirecciones        listado, alta, edición y baja (backoffice)
 *
 * Una dirección con SKU va a la ficha actual del producto mientras esté
 * publicado; si no (oculto, de baja, todavía no llegó de Stocker), a su
 * plan B ("hacia"). Así un producto que se renombra o vuelve a publicarse
 * no deja la redirección apuntando a una página vieja.
 */
const Id = z.coerce.number().int().positive().max(2_147_483_647);

interface Fila {
  id: number; desde: string; sku: string | null; hacia: string; origen: string; creadoEn: Date;
  productoSlug: string | null; productoNombre: string | null; publicado: boolean | null;
}

async function leer(pool: pg.Pool): Promise<Fila[]> {
  const { rows } = await pool.query<Fila>(
    `SELECT r.id, r.desde, r.sku, r.hacia, r.origen, r.creado_en AS "creadoEn",
            p.slug AS "productoSlug", p.nombre AS "productoNombre", p.publicado
       FROM tienda.redirecciones r
       LEFT JOIN LATERAL (
         -- Por SKU padre o por el SKU de una variante (en Jumpseller a veces se cargó el de un talle).
         SELECT p.slug, p.nombre, (p.visible AND p.en_stocker) AS publicado
           FROM tienda.productos p
          WHERE r.sku IS NOT NULL
            AND (upper(p.stocker_padre) = upper(r.sku)
                 OR p.id IN (SELECT v.producto_id FROM tienda.variantes v WHERE upper(v.sku) = upper(r.sku)))
          ORDER BY (p.visible AND p.en_stocker) DESC, p.id
          LIMIT 1) p ON true
      ORDER BY r.origen DESC, r.desde
      LIMIT 20000`);
  return rows;
}

const destinoDe = (f: Fila) => (f.productoSlug && f.publicado ? `/producto/${f.productoSlug}` : f.hacia);

/**
 * Sigue las cadenas (A → B y B también se redirige → C): Google prefiere un
 * solo salto. Un círculo (A → B → A) se descarta entero: mejor un 404 que una
 * página que no termina de cargar nunca.
 */
export function resolverCadenas(pares: Array<[string, string]>): Record<string, string> {
  const directo = new Map(pares);
  const mapa: Record<string, string> = {};
  for (const [desde, hacia] of pares) {
    let destino: string | null = hacia;
    const vistos = new Set([desde]);
    for (let i = 0; i < 10 && destino; i++) {
      const siguiente = rutaVieja(destino.split("?")[0]!);
      if (!siguiente || !directo.has(siguiente)) break;
      if (vistos.has(siguiente)) destino = null;
      else { vistos.add(siguiente); destino = directo.get(siguiente)!; }
    }
    if (destino && rutaVieja(destino.split("?")[0]!) !== desde) mapa[desde] = destino;
  }
  return mapa;
}

export async function rutasSeo(app: FastifyInstance, deps: { pool: pg.Pool; redis: Redis; env: Entorno; cache: CacheCorta; colas: Colas; canalInvalidar: string }) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const { pool } = deps;
  const ip = (req: FastifyRequest) => ipDe(req, deps.env.INTERNO_TOKEN);
  const mapa = () => deps.cache.obtener("redirecciones", async () => resolverCadenas((await leer(pool)).map((f) => [f.desde, destinoDe(f)])));

  api.get("/v1/redirecciones", { schema: { response: { 200: MapaRedirecciones } } }, async (_req, reply) => {
    reply.header("cache-control", "public, max-age=60, s-maxage=300");
    return { mapa: await mapa() };
  });

  async function cambio() {
    deps.cache.limpiar();
    await deps.redis.publish(deps.canalInvalidar, JSON.stringify({ etiquetas: ["redirecciones"] })).catch(() => 0);
    // El worker le avisa a la tienda (/api/revalidar) y la tienda trae el mapa nuevo al toque.
    await deps.colas.stocker("invalidar", { slugs: [] });
  }
  function repetida(e: unknown): never {
    if ((e as { code?: string }).code === "23505") throw new ErrorHttp(409, "repetida", "Esa dirección vieja ya tiene una redirección: editala.");
    if ((e as { code?: string }).code === "23514") throw new ErrorHttp(400, "invalida", "Revisá las direcciones: la vieja y la nueva tienen que ser rutas de la tienda y distintas.");
    throw e;
  }
  /** Que el cambio no arme un círculo con las que ya hay. */
  async function sinCirculo(r: RedireccionEntrada, sinId?: number) {
    const otras = (await leer(pool)).filter((f) => f.id !== sinId).map((f): [string, string] => [f.desde, destinoDe(f)]);
    const pares: Array<[string, string]> = [...otras, [r.desde, r.hacia]];
    if (!(r.desde in resolverCadenas(pares))) {
      throw new ErrorHttp(409, "circulo", `${r.hacia} ya redirige (directa o indirectamente) a ${r.desde}: quedaría dando vueltas.`);
    }
  }

  api.get("/v1/admin/redirecciones", async (req) => {
    await exigir(pool, req);
    const filas = await leer(pool);
    const resuelto = resolverCadenas(filas.map((f) => [f.desde, destinoDe(f)]));
    return {
      redirecciones: filas.map((f) => ({
        id: f.id, desde: f.desde, sku: f.sku, hacia: f.hacia, origen: f.origen, creadoEn: f.creadoEn,
        destino: resuelto[f.desde] ?? null,
        producto: f.productoSlug ? { nombre: f.productoNombre, slug: f.productoSlug, publicado: !!f.publicado } : null,
      })),
    };
  });

  api.post("/v1/admin/redirecciones", { schema: { body: RedireccionEntrada } }, async (req, reply) => {
    const a = await exigir(pool, req, "operador");
    const b = req.body;
    await sinCirculo(b);
    const { rows } = await pool.query<{ id: number }>(
      "INSERT INTO tienda.redirecciones (desde, sku, hacia, origen, creado_por) VALUES ($1, $2, $3, 'manual', $4) RETURNING id",
      [b.desde, b.sku, b.hacia, a.email]).catch(repetida);
    await auditar(pool, a, "crear_redireccion", "redireccion", rows[0]!.id, b, ip(req));
    await cambio();
    return reply.code(201).send({ id: rows[0]!.id });
  });

  api.put("/v1/admin/redirecciones/:id", { schema: { params: z.object({ id: Id }), body: RedireccionEntrada } }, async (req) => {
    const a = await exigir(pool, req, "operador");
    const b = req.body;
    await sinCirculo(b, req.params.id);
    const r = await pool.query("UPDATE tienda.redirecciones SET desde = $2, sku = $3, hacia = $4 WHERE id = $1", [req.params.id, b.desde, b.sku, b.hacia]).catch(repetida);
    if (!r.rowCount) throw new ErrorHttp(404, "no_encontrado", "No existe esa redirección.");
    await auditar(pool, a, "editar_redireccion", "redireccion", req.params.id, b, ip(req));
    await cambio();
    return { ok: true };
  });

  api.delete("/v1/admin/redirecciones/:id", { schema: { params: z.object({ id: Id }) } }, async (req) => {
    const a = await exigir(pool, req, "operador");
    const r = await pool.query<{ desde: string }>("DELETE FROM tienda.redirecciones WHERE id = $1 RETURNING desde", [req.params.id]);
    if (!r.rowCount) throw new ErrorHttp(404, "no_encontrado", "No existe esa redirección.");
    await auditar(pool, a, "borrar_redireccion", "redireccion", req.params.id, r.rows[0], ip(req));
    await cambio();
    return { ok: true };
  });
}
