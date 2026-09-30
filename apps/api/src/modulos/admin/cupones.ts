import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type pg from "pg";
import { z } from "zod";
import { CuponEntrada } from "@isu/shared";
import type { Entorno } from "../../entorno.js";
import { ErrorHttp } from "../../lib/errores.js";
import { ipDe } from "../../lib/cliente.js";
import { auditar, exigir } from "./sesion.js";

/*
 * Backoffice de cupones y promociones por monto. El cálculo en el carrito lo
 * lee de la base en cada cotización: no hay caché que limpiar al editar.
 *
 * Un cupón que ya se usó no se borra (se perdería de qué pedidos vino el
 * descuento): se desactiva.
 */
const Id = z.coerce.number().int().positive().max(2_147_483_647);

const COLUMNAS = `c.id, c.codigo, c.nombre, c.automatico, c.tipo, c.valor, c.alcance, c.categoria_ids AS "categoriaIds", c.producto_ids AS "productoIds",
  c.sobre_rebajas AS "sobreRebajas", c.minimo, c.desde, c.hasta, c.usos_max AS "usosMax", c.usos_por_cliente AS "usosPorCliente", c.usos, c.activo,
  c.creado_por AS "creadoPor", c.creado_en AS "creadoEn",
  (c.activo AND (c.desde IS NULL OR c.desde <= now()) AND (c.hasta IS NULL OR c.hasta > now()) AND (c.usos_max IS NULL OR c.usos < c.usos_max)) AS vigente`;

const aFila = (c: CuponEntrada) => [
  c.automatico ? null : c.codigo, c.nombre, c.automatico, c.tipo, c.tipo === "envio_gratis" ? 0 : c.valor, c.alcance,
  c.alcance === "categorias" ? c.categoriaIds : [], c.alcance === "productos" ? c.productoIds : [],
  c.sobreRebajas, c.minimo, c.desde, c.hasta, c.usosMax, c.automatico ? null : c.usosPorCliente, c.activo,
];

function repetido(e: unknown): never {
  if ((e as { code?: string }).code === "23505") throw new ErrorHttp(409, "codigo_repetido", "Ya existe un cupón con ese código.");
  throw e;
}

export async function rutasCuponesAdmin(app: FastifyInstance, deps: { pool: pg.Pool; env: Entorno }) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const { pool } = deps;
  const ip = (req: FastifyRequest) => ipDe(req, deps.env.INTERNO_TOKEN);

  api.get("/v1/admin/cupones", async (req) => {
    await exigir(pool, req);
    const { rows } = await pool.query(
      `SELECT ${COLUMNAS},
              -- Lo que rindió: pedidos pagados con el cupón y cuánto se descontó en ellos.
              (SELECT count(*)::int FROM tienda.pedidos p WHERE p.cupon_id = c.id AND p.pagado_en IS NOT NULL) AS "pedidosPagados",
              (SELECT COALESCE(sum(p.descuento_cupon + p.envio_bonificado), 0)::bigint FROM tienda.pedidos p WHERE p.cupon_id = c.id AND p.pagado_en IS NOT NULL) AS "descontado",
              (SELECT COALESCE(sum(p.total), 0)::bigint FROM tienda.pedidos p WHERE p.cupon_id = c.id AND p.pagado_en IS NOT NULL) AS "vendido"
         FROM tienda.cupones c ORDER BY c.activo DESC, c.id DESC`);
    return { cupones: rows.map((r) => ({ ...r, descontado: Number(r.descontado), vendido: Number(r.vendido) })) };
  });

  api.post("/v1/admin/cupones", { schema: { body: CuponEntrada } }, async (req, reply) => {
    const a = await exigir(pool, req, "operador");
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO tienda.cupones (codigo, nombre, automatico, tipo, valor, alcance, categoria_ids, producto_ids, sobre_rebajas, minimo, desde, hasta,
                                   usos_max, usos_por_cliente, activo, creado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
      [...aFila(req.body), a.email]).catch(repetido);
    await auditar(pool, a, "crear_cupon", "cupon", rows[0]!.id, req.body, ip(req));
    return reply.code(201).send({ id: rows[0]!.id });
  });

  api.put("/v1/admin/cupones/:id", { schema: { params: z.object({ id: Id }), body: CuponEntrada } }, async (req) => {
    const a = await exigir(pool, req, "operador");
    const r = await pool.query(
      `UPDATE tienda.cupones SET codigo=$2, nombre=$3, automatico=$4, tipo=$5, valor=$6, alcance=$7, categoria_ids=$8, producto_ids=$9, sobre_rebajas=$10,
              minimo=$11, desde=$12, hasta=$13, usos_max=$14, usos_por_cliente=$15, activo=$16, actualizado_en=now()
        WHERE id = $1`, [req.params.id, ...aFila(req.body)]).catch(repetido);
    if (!r.rowCount) throw new ErrorHttp(404, "no_encontrado", "No existe ese cupón.");
    await auditar(pool, a, "editar_cupon", "cupon", req.params.id, req.body, ip(req));
    return { ok: true };
  });

  api.delete("/v1/admin/cupones/:id", { schema: { params: z.object({ id: Id }) } }, async (req) => {
    const a = await exigir(pool, req, "operador");
    const usado = await pool.query("SELECT 1 FROM tienda.pedidos WHERE cupon_id = $1 LIMIT 1", [req.params.id]);
    if (usado.rowCount) throw new ErrorHttp(409, "usado", "Este cupón ya se usó en pedidos: desactivalo en vez de borrarlo (así queda el registro).");
    const r = await pool.query("DELETE FROM tienda.cupones WHERE id = $1", [req.params.id]);
    if (!r.rowCount) throw new ErrorHttp(404, "no_encontrado", "No existe ese cupón.");
    await auditar(pool, a, "borrar_cupon", "cupon", req.params.id, null, ip(req));
    return { ok: true };
  });

  // En qué pedidos se usó (los últimos 200).
  api.get("/v1/admin/cupones/:id/usos", { schema: { params: z.object({ id: Id }) } }, async (req) => {
    await exigir(pool, req);
    const { rows } = await pool.query(
      `SELECT p.numero, p.email, p.estado, p.total, p.descuento_cupon + p.envio_bonificado AS descuento, p.creado_en AS "creadoEn", u.vigente
         FROM tienda.cupon_usos u JOIN tienda.pedidos p ON p.id = u.pedido_id
        WHERE u.cupon_id = $1 ORDER BY u.id DESC LIMIT 200`, [req.params.id]);
    return { usos: rows };
  });
}
