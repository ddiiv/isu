import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type pg from "pg";
import type { Redis } from "ioredis";
import { CuponesEvaluados, CuponesPublicos, formatearPesos, PedidoEvaluar, resumenCupon } from "@isu/shared";
import type { Entorno } from "../../entorno.js";
import type { CacheCorta } from "../../lib/cache.js";
import { ipDe } from "../../lib/cliente.js";
import { promocionesVigentes } from "../../lib/cupones.js";
import type { Descuentos } from "../../lib/descuentos.js";
import { frenar } from "../../lib/frenos.js";
import { cuponesDe, ruletaAbierta, type Quien } from "../../lib/ruleta.js";
import { sesionDe } from "../cuentas/rutas.js";
import { cotizar } from "../pedidos/cotizar.js";

/*
 * Cupones que la tienda muestra.
 *
 *   GET  /v1/cupones          sin sesión: los cupones que el dueño marcó como «visibles» (con su código), las promociones automáticas
 *                             vigentes y si hay una ruleta abierta. NUNCA sale un cupón personal ni uno con código secreto.
 *   POST /v1/cupones/evaluar  «Cupones disponibles» del carrito: cada cupón visible y los que ganó ESTE cliente (su sesión, o el
 *                             identificador de su navegador) evaluado contra el carrito: si aplica y cuánto ahorra, o cuánto falta.
 * Ninguna de las dos devuelve datos de clientes.
 */
interface Visible { codigo: string; nombre: string; descripcion: string | null; tipo: "porcentaje" | "monto" | "envio_gratis" | "mezcla" | "segunda_unidad"; valor: number; tope: string | null; minimo: number; hasta: Date | null }

const visibles = async (pool: pg.Pool) => (await pool.query<Visible>(
  `SELECT codigo, nombre, descripcion, tipo, valor, tope, minimo, hasta FROM tienda.cupones c
    WHERE c.visible AND c.cliente_id IS NULL AND c.codigo IS NOT NULL AND c.activo AND (c.desde IS NULL OR c.desde <= now()) AND (c.hasta IS NULL OR c.hasta > now())
      AND (c.usos_max IS NULL OR c.usos < c.usos_max) AND (c.evento_id IS NULL OR tienda.evento_vigente(c.evento_id)) ORDER BY c.id DESC LIMIT 50`)).rows;
const detalleDe = (c: { tipo: Visible["tipo"]; valor: number; tope: string | number | null }) =>
  resumenCupon({ tipo: c.tipo, valor: c.valor, tope: c.tope === null ? null : Number(c.tope) }, formatearPesos);

export async function rutasCuponesPublicos(app: FastifyInstance, deps: { pool: pg.Pool; cache: CacheCorta; redis: Redis; env: Entorno; descuentos: Descuentos }) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const ip = (req: FastifyRequest) => ipDe(req, deps.env.INTERNO_TOKEN);

  api.get("/v1/cupones", { schema: { response: { 200: CuponesPublicos } } }, async (_req, reply) => {
    reply.header("cache-control", "public, max-age=60, s-maxage=60");
    return deps.cache.obtener("cupones-publicos", async () => {
      const [vis, promos, ruleta] = await Promise.all([visibles(deps.pool), promocionesVigentes(deps.pool), ruletaAbierta(deps.pool)]);
      return {
        cupones: vis.map((c) => ({ codigo: c.codigo, nombre: c.nombre, descripcion: c.descripcion, minimo: c.minimo, hasta: c.hasta?.toISOString() ?? null, detalle: detalleDe(c) })),
        promociones: promos.map((p) => ({ nombre: p.nombre, minimo: p.minimo, hasta: p.hasta?.toISOString() ?? null, detalle: detalleDe(p) })),
        ruleta,
      };
    });
  });

  api.post("/v1/cupones/evaluar", { schema: { body: PedidoEvaluar, response: { 200: CuponesEvaluados } } }, async (req, reply) => {
    await frenar(deps.redis, "cupones-evaluar", ip(req), 60, 600);
    reply.header("cache-control", "no-store");
    const s = await sesionDe(req, deps);
    const quien: Quien | null = s ? { clienteId: s.clienteId } : req.body.dispositivo ? { dispositivo: req.body.dispositivo, ip: ip(req), sal: deps.env.INTERNO_TOKEN ?? "isu-ruleta" } : null;
    // Primero los suyos (la ruleta), después los que la tienda muestra; sin repetir, hasta 8.
    const propios = quien ? await cuponesDe(deps.pool, quien) : [];
    const candidatos = [
      ...propios.map((c) => ({ codigo: c.codigo, nombre: c.nombre.replace(/^Ruleta: /, ""), detalle: c.nombre.replace(/^Ruleta: /, ""), minimo: c.minimo, hasta: c.hasta, propio: true })),
      ...(await visibles(deps.pool)).map((c) => ({ codigo: c.codigo, nombre: c.nombre, detalle: detalleDe(c), minimo: c.minimo, hasta: c.hasta?.toISOString() ?? null, propio: false })),
    ].filter((c, i, a) => a.findIndex((x) => x.codigo === c.codigo) === i).slice(0, 8);

    const salida = [];
    for (const c of candidatos) {
      // Se cotiza el MISMO carrito con cada cupón: la respuesta es exactamente lo que pasaría al aplicarlo.
      const q = await cotizar(deps.pool, req.body.items, { entrega: req.body.entrega, medioPago: req.body.medioPago, descuentos: deps.descuentos, cupon: c.codigo, clienteId: s?.clienteId ?? null }).catch(() => null);
      const aplicable = !!q && q.cupon?.codigo === c.codigo;
      const falta = q && !aplicable && c.minimo > q.subtotal ? c.minimo - q.subtotal : null;
      salida.push({
        ...c, aplicable, ahorro: aplicable ? (q!.descuentoCupon ?? 0) : 0, envioGratis: aplicable && !!q!.cupon?.envioGratis, falta,
        motivo: !aplicable && falta === null ? (q?.avisoCupon ?? "No se puede usar en este carrito.") : null,
      });
    }
    // Los que se pueden usar primero, el que más ahorra arriba; después los que faltan poco.
    salida.sort((a, b) => Number(b.aplicable) - Number(a.aplicable) || b.ahorro - a.ahorro || (a.falta ?? Infinity) - (b.falta ?? Infinity));
    return { cupones: salida };
  });
}
