import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type pg from "pg";
import type { Redis } from "ioredis";
import {
  AjusteDirecciones, DIRECCIONES_POR_DEFECTO, LugarDireccion, PedidoLugar, PedidoRevisar, PedidoSugerencias, RespuestaSugerencias, RevisionDireccion,
  sinTildes, type AjusteDirecciones as Ajuste,
} from "@isu/shared";
import type { Entorno } from "../../entorno.js";
import { CacheCorta } from "../../lib/cache.js";
import { ErrorHttp } from "../../lib/errores.js";
import { frenar } from "../../lib/frenos.js";
import { ipDe } from "../../lib/cliente.js";
import type { Georef, Google } from "../../lib/direcciones.js";
import { leerAjuste } from "../productos/consultas.js";
import { exigir } from "../admin/sesion.js";

/*
 * Ayudas para la dirección del checkout (etapa 11):
 *   POST /v1/direcciones/sugerencias   mientras se escribe la calle (Google)
 *   POST /v1/direcciones/lugar         los datos de la sugerencia elegida (Google)
 *   POST /v1/direcciones/revisar       ¿existe esa calle y altura? (Georef, gratis)
 *   GET  /v1/admin/direcciones         (backoffice) qué está configurado y cuánto se usó hoy
 *
 * Google cobra pasado el uso gratis: además del freno por IP hay un tope
 * por día de sugerencias y de datos (Ajustes → Direcciones). Pasado el tope,
 * el checkout sigue como siempre (a mano) hasta el día siguiente. La clave
 * de Google vive sólo en el servidor.
 *
 * Nada de esto frena una compra: si un servicio no contesta, se dice nada.
 */
export async function leerAjusteDirecciones(pool: pg.Pool): Promise<Ajuste> {
  const v = AjusteDirecciones.safeParse(await leerAjuste(pool, "direcciones", DIRECCIONES_POR_DEFECTO));
  return v.success ? v.data : DIRECCIONES_POR_DEFECTO;
}

/** Fecha del día en Argentina (el tope se renueva a la medianoche de acá). */
const hoy = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

export async function rutasDirecciones(app: FastifyInstance, deps: {
  pool: pg.Pool; redis: Redis; env: Entorno; cache: CacheCorta; google: Google | null; georef: Georef | null;
}) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const ajuste = () => deps.cache.obtener("ajuste:direcciones", () => leerAjusteDirecciones(deps.pool));
  // Georef con caché propia: la misma dirección revisada dos veces no sale dos veces.
  const revisadas = new CacheCorta(600, 2000);
  const ip = (req: Parameters<typeof ipDe>[0]) => ipDe(req, deps.env.INTERNO_TOKEN);

  /** ¿Queda tope hoy? Sin Redis no se cuenta, así que no se usa Google (mejor sin ayuda que una factura). */
  async function quedaTope(tipo: "sugerencias" | "lugares", tope: number): Promise<boolean> {
    if (tope <= 0) return false;
    const k = `isu:direcciones:${tipo}:${hoy()}`;
    try {
      const n = await deps.redis.incr(k);
      if (n === 1) await deps.redis.expire(k, 2 * 86400);
      return n <= tope;
    } catch { return false; }
  }

  api.get("/v1/admin/direcciones", async (req) => {
    await exigir(deps.pool, req, "dueno");
    const usado = async (tipo: string) => {
      try { return Number(await deps.redis.get(`isu:direcciones:${tipo}:${hoy()}`)) || 0; } catch { return null; }
    };
    const [sugerencias, lugares] = await Promise.all([usado("sugerencias"), usado("lugares")]);
    return { google: !!deps.google, georef: !!deps.georef, hoy: { sugerencias, lugares } };
  });

  api.post("/v1/direcciones/sugerencias", { schema: { body: PedidoSugerencias, response: { 200: RespuestaSugerencias } } }, async (req, reply) => {
    reply.header("cache-control", "no-store");
    const a = await ajuste();
    if (!deps.google || !a.google) return { sugerencias: [] };
    await frenar(deps.redis, "dir-sug-ip", ip(req), 150, 600);
    if (!(await quedaTope("sugerencias", a.topeSugerencias))) return { sugerencias: [] };
    try { return { sugerencias: await deps.google.sugerencias(req.body.texto, req.body.sesion) }; }
    catch (e) { req.log.warn({ err: (e as Error).message }, "sugerencias de direcciones: Google no respondió"); return { sugerencias: [] }; }
  });

  api.post("/v1/direcciones/lugar", { schema: { body: PedidoLugar, response: { 200: LugarDireccion } } }, async (req, reply) => {
    reply.header("cache-control", "no-store");
    const a = await ajuste();
    const sinServicio = () => new ErrorHttp(503, "sin_servicio", "No pudimos completar la dirección: escribila a mano.");
    if (!deps.google || !a.google) throw sinServicio();
    await frenar(deps.redis, "dir-lugar-ip", ip(req), 40, 600);
    if (!(await quedaTope("lugares", a.topeLugares))) throw sinServicio();
    try { return await deps.google.lugar(req.body.id, req.body.sesion); }
    catch (e) { req.log.warn({ err: (e as Error).message }, "datos de la dirección: Google no respondió"); throw sinServicio(); }
  });

  api.post("/v1/direcciones/revisar", { schema: { body: PedidoRevisar, response: { 200: RevisionDireccion } } }, async (req, reply) => {
    reply.header("cache-control", "no-store");
    const a = await ajuste();
    if (!deps.georef || !a.georef) return { estado: "sin_servicio" as const, sugerencia: null };
    await frenar(deps.redis, "dir-revisar-ip", ip(req), 80, 600);
    const d = req.body;
    const clave = sinTildes(`${d.calle}|${d.numero}|${d.localidad}|${d.provincia}`);
    try { return await revisadas.obtener(clave, () => deps.georef!.revisar(d)); }
    catch (e) { req.log.warn({ err: (e as Error).message }, "revisar dirección: Georef no respondió"); return { estado: "sin_servicio" as const, sugerencia: null }; }
  });
}
