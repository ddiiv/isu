import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type pg from "pg";
import type { Redis } from "ioredis";
import { z } from "zod";
import { CodigoCupon, CP, DestinoEnvio, Email, EnvioPublico, Items, MedioPago, RespuestaOpcionesEnvio, SucursalEnvio, TRANSPORTES, type TransporteTienda } from "@isu/shared";
import type { Transportes } from "@isu/envios";
import type { Entorno } from "../../entorno.js";
import { ErrorHttp } from "../../lib/errores.js";
import { frenar } from "../../lib/frenos.js";
import { ipDe } from "../../lib/cliente.js";
import type { Descuentos } from "../../lib/descuentos.js";
import { cotizar } from "../pedidos/cotizar.js";
import type { CotizadorEnvios } from "./cotizador.js";
import { envioPublico, firmaSeguimientoValida } from "./publico.js";

/*
 * Envíos del lado del cliente:
 *   POST /v1/envios/opciones      cuánto sale mandar el carrito a un CP, con cada transporte
 *   GET  /v1/envios/sucursales    sucursales de un transporte cerca de un CP
 *   GET  /v1/seguimiento/:numero  cómo viene el envío (con el enlace firmado del aviso)
 *
 * Cada consulta de opciones le pega a las APIs de los transportes (con
 * caché): tiene su propio freno por IP para que nadie las use de gratis.
 */
export async function rutasEnvios(app: FastifyInstance, deps: {
  pool: pg.Pool; redis: Redis; env: Entorno; cotizador: CotizadorEnvios; transportes: Transportes; descuentos: Descuentos;
}) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const sinCache = { "cache-control": "no-store" };

  api.post("/v1/envios/opciones", {
    schema: { body: z.object({ items: Items, destino: DestinoEnvio, medioPago: MedioPago.optional(), cupon: CodigoCupon.optional(), email: Email.optional() }).strict(), response: { 200: RespuestaOpcionesEnvio } },
  }, async (req, reply) => {
    await frenar(deps.redis, "envios-ip", ipDe(req, deps.env.INTERNO_TOKEN), 120, 600);
    if (req.body.cupon?.trim()) await frenar(deps.redis, "cupon-ip", ipDe(req, deps.env.INTERNO_TOKEN), 40, 600);
    const c = await cotizar(deps.pool, req.body.items, { medioPago: req.body.medioPago, descuentos: deps.descuentos, cupon: req.body.cupon, email: req.body.email, entrega: "envio" });
    reply.headers(sinCache);
    const r = await deps.cotizador.opciones({ destino: req.body.destino, carrito: { lineas: c.lineas, filas: c.filas, neto: c.neto }, medioPago: req.body.medioPago });
    // Cupón de envío gratis: las opciones salen en $0 (Mercado Envíos no: lo cobra Mercado Pago).
    if (c.aplicado?.envioGratis) {
      r.opciones = r.opciones.map((o) => (o.soloMercadoPago ? o : { ...o, precio: 0, gratis: true }));
    }
    return r;
  });

  api.get("/v1/envios/sucursales", {
    schema: {
      querystring: z.object({ transporte: z.enum(TRANSPORTES), cp: CP, provincia: z.string().trim().max(60).optional() }).strict(),
      response: { 200: z.object({ sucursales: z.array(SucursalEnvio) }) },
    },
  }, async (req, reply) => {
    await frenar(deps.redis, "envios-ip", ipDe(req, deps.env.INTERNO_TOKEN), 120, 600);
    const s = await deps.cotizador.sucursales(req.query.transporte as TransporteTienda, req.query.cp, req.query.provincia ?? null).catch(() => {
      throw new ErrorHttp(503, "sin_sucursales", "No pudimos traer las sucursales. Probá de nuevo o elegí envío a domicilio.");
    });
    reply.header("cache-control", "public, max-age=600");
    return { sucursales: s };
  });

  api.get("/v1/seguimiento/:numero", {
    schema: {
      params: z.object({ numero: z.string().regex(/^ISU-\d{4,10}$/) }),
      querystring: z.object({ t: z.string().regex(/^[A-Za-z0-9_-]{24}$/) }).strict(),
      response: { 200: z.object({ numero: z.string(), estado: z.string(), nombre: z.string(), envio: EnvioPublico.nullable() }) },
    },
  }, async (req, reply) => {
    const no = () => new ErrorHttp(404, "no_encontrado", "No encontramos ese seguimiento.");
    if (!deps.env.INTERNO_TOKEN || !firmaSeguimientoValida(req.params.numero, req.query.t, deps.env.INTERNO_TOKEN)) throw no();
    const { rows } = await deps.pool.query("SELECT id, numero, estado, nombre, entrega, transporte, servicio_envio, sucursal_envio FROM tienda.pedidos WHERE numero = $1", [req.params.numero]);
    const p = rows[0];
    if (!p) throw no();
    reply.headers(sinCache);
    // Sólo el nombre de pila: el enlace puede reenviarse y no tiene por qué mostrar más.
    return { numero: p.numero, estado: p.estado, nombre: String(p.nombre).split(" ")[0] ?? "", envio: await envioPublico(deps.pool, deps.transportes, p) };
  });
}
