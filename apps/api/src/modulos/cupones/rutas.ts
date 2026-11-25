import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type pg from "pg";
import { CuponesPublicos, formatearPesos, resumenCupon } from "@isu/shared";
import type { CacheCorta } from "../../lib/cache.js";
import { promocionesVigentes } from "../../lib/cupones.js";
import { ruletaAbierta } from "../../lib/ruleta.js";

/*
 * GET /v1/cupones — lo que la tienda muestra sin sesión: los cupones que el dueño marcó como «visibles» (con su código), las
 * promociones automáticas vigentes y si hay una ruleta abierta. NUNCA sale un cupón personal (el de la ruleta) ni uno con código
 * secreto: sólo lo que se eligió mostrar. No hay datos de clientes.
 */
export async function rutasCuponesPublicos(app: FastifyInstance, deps: { pool: pg.Pool; cache: CacheCorta }) {
  app.withTypeProvider<ZodTypeProvider>().get("/v1/cupones", { schema: { response: { 200: CuponesPublicos } } }, async (_req, reply) => {
    reply.header("cache-control", "public, max-age=60, s-maxage=60");
    return deps.cache.obtener("cupones-publicos", async () => {
      const [visibles, promos, ruleta] = await Promise.all([
        deps.pool.query<{ codigo: string; nombre: string; descripcion: string | null; tipo: "porcentaje" | "monto" | "envio_gratis" | "mezcla" | "segunda_unidad"; valor: number; tope: string | null; minimo: number; hasta: Date | null }>(
          `SELECT codigo, nombre, descripcion, tipo, valor, tope, minimo, hasta FROM tienda.cupones c
            WHERE c.visible AND c.cliente_id IS NULL AND c.codigo IS NOT NULL AND c.activo AND (c.desde IS NULL OR c.desde <= now()) AND (c.hasta IS NULL OR c.hasta > now())
              AND (c.usos_max IS NULL OR c.usos < c.usos_max) AND (c.evento_id IS NULL OR tienda.evento_vigente(c.evento_id)) ORDER BY c.id DESC LIMIT 50`),
        promocionesVigentes(deps.pool),
        ruletaAbierta(deps.pool),
      ]);
      return {
        cupones: visibles.rows.map((c) => ({
          codigo: c.codigo, nombre: c.nombre, descripcion: c.descripcion, minimo: c.minimo, hasta: c.hasta?.toISOString() ?? null,
          detalle: resumenCupon({ tipo: c.tipo, valor: c.valor, tope: c.tope === null ? null : Number(c.tope) }, formatearPesos),
        })),
        promociones: promos.map((p) => ({
          nombre: p.nombre, minimo: p.minimo, hasta: p.hasta?.toISOString() ?? null,
          detalle: resumenCupon({ tipo: p.tipo, valor: p.valor, tope: p.tope }, formatearPesos),
        })),
        ruleta,
      };
    });
  });
}
