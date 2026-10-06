import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type pg from "pg";
import type { Redis } from "ioredis";
import { z } from "zod";
import {
  BannerPublico, nombreParaResena, Opiniones, ORDENES_RESENAS, PedidoParaOpinar, ResenasInicio, ResenasProducto, slug,
  type ResenaPublica,
} from "@isu/shared";
import { firmaOpinarValida } from "@isu/envios";
import type { CacheCorta } from "../../lib/cache.js";
import type { Colas } from "../../lib/colas.js";
import { ErrorHttp, noEncontrado } from "../../lib/errores.js";
import { frenar } from "../../lib/frenos.js";
import { ipDe } from "../../lib/cliente.js";

/*
 * Reseñas y portada (etapa 8).
 *
 *   GET  /v1/productos/:slug/resenas?orden=&pagina=   las publicadas de una prenda, con el resumen
 *   GET  /v1/resenas/inicio                            promedio de toda la tienda y las últimas (final del inicio)
 *   GET  /v1/portada                                   banners del carrusel del inicio
 *   GET  /v1/opinar/:numero?t=…                        qué puede opinar quien tiene el enlace del mail
 *   POST /v1/opinar/:numero?t=…                        guarda las opiniones
 *
 * Sólo opina quien compró y recibió: el enlace va firmado con el número de
 * pedido (como el de seguimiento) y el pedido tiene que estar entregado o
 * retirado. Una opinión por prenda y una general: no se puede inflar.
 */
const POR_PAGINA = 10;
const NUMERO = z.string().regex(/^ISU-\d{4,10}$/);
const FIRMA = z.string().regex(/^[A-Za-z0-9_-]{24}$/);
const CACHE_PUBLICO = "public, max-age=30, s-maxage=60, stale-while-revalidate=300";

interface FilaResena {
  id: number; nombre: string; estrellas: number; texto: string | null; calce: "chico" | "justo" | "grande" | null;
  talle: string | null; color: string | null; creado_en: Date; respuesta: string | null;
}
const publica = (r: FilaResena): ResenaPublica => ({
  id: r.id, nombre: r.nombre, estrellas: r.estrellas, texto: r.texto, calce: r.calce, talle: r.talle,
  color: r.color && r.color !== "Único" ? r.color : null, fecha: r.creado_en.toISOString(), respuesta: r.respuesta,
});
const COLUMNAS = "r.id, r.nombre, r.estrellas, r.texto, r.calce, r.talle, r.color, r.creado_en, r.respuesta";

export async function rutasResenas(app: FastifyInstance, deps: { pool: pg.Pool; redis: Redis; cache: CacheCorta; colas: Colas; canalInvalidar: string; secreto?: string }) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const { pool } = deps;

  api.get("/v1/productos/:slug/resenas", {
    schema: {
      params: z.object({ slug }),
      querystring: z.object({ orden: z.enum(ORDENES_RESENAS).default("recientes"), pagina: z.coerce.number().int().min(1).max(500).default(1) }).strict(),
      response: { 200: ResenasProducto },
    },
  }, async (req, reply) => {
    const { orden, pagina } = req.query;
    const r = await deps.cache.obtener(`resenas:${req.params.slug}:${orden}:${pagina}`, async () => {
      const p = await pool.query<{ id: number }>("SELECT id FROM tienda.productos WHERE slug = $1 AND visible AND en_stocker", [req.params.slug]);
      const id = p.rows[0]?.id;
      if (!id) return null;
      const ordenSql = orden === "mejores" ? "r.estrellas DESC, r.creado_en DESC" : orden === "peores" ? "r.estrellas ASC, r.creado_en DESC" : "r.creado_en DESC";
      const [lista, resumen] = await Promise.all([
        pool.query<FilaResena>(
          `SELECT ${COLUMNAS} FROM tienda.resenas r WHERE r.producto_id = $1 AND r.estado = 'publicada'
            ORDER BY ${ordenSql}, r.id DESC LIMIT $2 OFFSET $3`,
          [id, POR_PAGINA, (pagina - 1) * POR_PAGINA],
        ),
        pool.query<{ n: number; promedio: string | null; e1: number; e2: number; e3: number; e4: number; e5: number; chico: number; justo: number; grande: number }>(
          `SELECT count(*)::int AS n, round(avg(estrellas), 1) AS promedio,
                  count(*) FILTER (WHERE estrellas = 1)::int AS e1, count(*) FILTER (WHERE estrellas = 2)::int AS e2,
                  count(*) FILTER (WHERE estrellas = 3)::int AS e3, count(*) FILTER (WHERE estrellas = 4)::int AS e4,
                  count(*) FILTER (WHERE estrellas = 5)::int AS e5,
                  count(*) FILTER (WHERE calce = 'chico')::int AS chico, count(*) FILTER (WHERE calce = 'justo')::int AS justo,
                  count(*) FILTER (WHERE calce = 'grande')::int AS grande
             FROM tienda.resenas WHERE producto_id = $1 AND estado = 'publicada'`,
          [id],
        ),
      ]);
      const s = resumen.rows[0]!;
      return {
        resumen: {
          cantidad: s.n, promedio: s.promedio === null ? null : Number(s.promedio),
          estrellas: [s.e1, s.e2, s.e3, s.e4, s.e5], calce: { chico: s.chico, justo: s.justo, grande: s.grande },
        },
        resenas: lista.rows.map(publica),
        total: s.n,
      };
    });
    if (!r) throw noEncontrado("Producto");
    reply.header("cache-control", CACHE_PUBLICO);
    return r;
  });

  api.get("/v1/resenas/inicio", { schema: { response: { 200: ResenasInicio } } }, async (_req, reply) => {
    reply.header("cache-control", CACHE_PUBLICO);
    return deps.cache.obtener("resenas:inicio", async () => {
      const [total, lista] = await Promise.all([
        pool.query<{ n: number; promedio: string | null }>("SELECT count(*)::int AS n, round(avg(estrellas), 1) AS promedio FROM tienda.resenas WHERE estado = 'publicada'"),
        // Las últimas con algo escrito. El promedio de arriba es de TODAS (también las que no se muestran acá).
        pool.query<FilaResena & { slug: string | null; producto: string | null; foto: string | null; ancho: number | null; alto: number | null }>(
          `SELECT ${COLUMNAS}, p.slug, p.nombre AS producto, f.clave AS foto, f.ancho, f.alto
             FROM tienda.resenas r
             LEFT JOIN tienda.productos p ON p.id = r.producto_id AND p.visible AND p.en_stocker
             LEFT JOIN LATERAL (SELECT clave, ancho, alto FROM tienda.fotos WHERE producto_id = p.id
                                 ORDER BY (tipo = 'exhibicion') DESC, orden, id LIMIT 1) f ON true
            WHERE r.estado = 'publicada' AND r.texto IS NOT NULL AND length(r.texto) >= 15 AND r.estrellas >= 4
              AND (r.producto_id IS NULL OR p.id IS NOT NULL)
            ORDER BY r.creado_en DESC LIMIT 12`,
        ),
      ]);
      const t = total.rows[0]!;
      return {
        cantidad: t.n,
        promedio: t.promedio === null ? null : Number(t.promedio),
        resenas: lista.rows.map((r) => ({
          ...publica(r),
          producto: r.slug ? { slug: r.slug, nombre: r.producto!, foto: r.foto ? { clave: r.foto, ancho: r.ancho, alto: r.alto, alt: r.producto } : null } : null,
        })),
      };
    });
  });

  api.get("/v1/portada", { schema: { response: { 200: z.object({ banners: z.array(BannerPublico) }) } } }, async (_req, reply) => {
    reply.header("cache-control", CACHE_PUBLICO);
    return deps.cache.obtener("portada", async () => {
      const { rows } = await pool.query<{ id: number; alt: string; enlace: string | null; foto: string; foto_ancho: number | null; foto_alto: number | null; foto_movil: string | null; movil_ancho: number | null; movil_alto: number | null }>(
        `SELECT id, alt, enlace, foto, foto_ancho, foto_alto, foto_movil, movil_ancho, movil_alto FROM tienda.banners
          WHERE activo AND foto IS NOT NULL AND (desde IS NULL OR desde <= now()) AND (hasta IS NULL OR hasta > now())
          ORDER BY orden, id LIMIT 8`,
      );
      return {
        banners: rows.map((b) => ({
          id: b.id, alt: b.alt, enlace: b.enlace,
          foto: { clave: b.foto, ancho: b.foto_ancho, alto: b.foto_alto },
          fotoMovil: b.foto_movil ? { clave: b.foto_movil, ancho: b.movil_ancho, alto: b.movil_alto } : null,
        })),
      };
    });
  });

  // ── Opinar desde el enlace del mail ──
  const Params = z.object({ numero: NUMERO });
  const Firma = z.object({ t: FIRMA }).strict();

  /** El pedido del enlace, si la firma es buena. Mismo 404 si no existe o si la firma no corresponde. */
  async function pedidoDelEnlace(numero: string, t: string) {
    if (!deps.secreto || !firmaOpinarValida(numero, t, deps.secreto)) throw new ErrorHttp(404, "no_encontrado", "Ese enlace no es válido.");
    const { rows } = await pool.query<{ id: number; nombre: string; apellido: string; estado: string }>(
      "SELECT id, nombre, apellido, estado FROM tienda.pedidos WHERE numero = $1", [numero],
    );
    const p = rows[0];
    if (!p) throw new ErrorHttp(404, "no_encontrado", "Ese enlace no es válido.");
    if (!["entregado", "retirado"].includes(p.estado)) {
      throw new ErrorHttp(409, "sin_entregar", "Vas a poder opinar cuando te llegue el pedido. Te mandamos el enlace por mail.");
    }
    return p;
  }

  async function prendasDelPedido(pedidoId: number) {
    // Una por prenda: si llevó la misma en dos colores, se opina una vez (con el primer color y talle).
    const { rows } = await pool.query<{ producto_id: number; slug: string | null; nombre: string; color: string | null; talle: string | null; foto: string | null; ancho: number | null; alto: number | null; ya: boolean }>(
      `SELECT DISTINCT ON (i.producto_id) i.producto_id, p.slug, COALESCE(p.nombre, i.nombre) AS nombre, i.color, i.talle,
              f.clave AS foto, f.ancho, f.alto,
              EXISTS (SELECT 1 FROM tienda.resenas r WHERE r.pedido_id = i.pedido_id AND r.producto_id = i.producto_id) AS ya
         FROM tienda.pedido_items i
         JOIN tienda.productos p ON p.id = i.producto_id
         LEFT JOIN LATERAL (SELECT clave, ancho, alto FROM tienda.fotos WHERE producto_id = p.id
                             ORDER BY (tipo = 'exhibicion') DESC, orden, id LIMIT 1) f ON true
        WHERE i.pedido_id = $1 AND i.producto_id IS NOT NULL
        ORDER BY i.producto_id, i.id`,
      [pedidoId],
    );
    return rows;
  }

  api.get("/v1/opinar/:numero", {
    schema: { params: Params, querystring: Firma, response: { 200: PedidoParaOpinar } },
  }, async (req, reply) => {
    reply.header("cache-control", "no-store");
    const p = await pedidoDelEnlace(req.params.numero, req.query.t);
    const [prendas, general] = await Promise.all([
      prendasDelPedido(p.id),
      pool.query("SELECT 1 FROM tienda.resenas WHERE pedido_id = $1 AND producto_id IS NULL", [p.id]),
    ]);
    return {
      numero: req.params.numero,
      nombre: p.nombre.trim().split(/\s+/)[0] ?? "",
      productos: prendas.map((r) => ({
        productoId: r.producto_id, slug: r.slug, nombre: r.nombre, color: r.color && r.color !== "Único" ? r.color : null, talle: r.talle,
        foto: r.foto ? { clave: r.foto, ancho: r.ancho, alto: r.alto, alt: r.nombre } : null, yaOpino: r.ya,
      })),
      generalYaOpino: !!general.rowCount,
    };
  });

  api.post("/v1/opinar/:numero", {
    schema: { params: Params, querystring: Firma, body: Opiniones },
  }, async (req, reply) => {
    reply.header("cache-control", "no-store");
    // Por la IP del cliente (la tienda la pasa en x-isu-ip): el servidor de la tienda está exento del límite general.
    await frenar(deps.redis, "opinar-ip", ipDe(req, deps.secreto), 10, 600);
    const p = await pedidoDelEnlace(req.params.numero, req.query.t);
    const prendas = new Map((await prendasDelPedido(p.id)).map((r) => [r.producto_id, r]));
    for (const r of req.body.resenas) {
      if (r.productoId !== null && !prendas.has(r.productoId)) throw new ErrorHttp(400, "prenda", "Esa prenda no es de este pedido.");
    }
    const ajuste = (await pool.query<{ valor: { publicarSolas?: boolean } }>("SELECT valor FROM tienda.ajustes WHERE clave = 'resenas'")).rows[0]?.valor;
    const estado = ajuste?.publicarSolas === true ? "publicada" : "pendiente";
    const nombre = nombreParaResena(p.nombre, p.apellido);
    let guardadas = 0;
    const tocados: string[] = [];
    for (const r of req.body.resenas) {
      const prenda = r.productoId === null ? null : prendas.get(r.productoId)!;
      const ins = await pool.query(
        `INSERT INTO tienda.resenas (pedido_id, producto_id, estrellas, texto, calce, talle, color, nombre, estado)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (pedido_id, COALESCE(producto_id, 0)) DO NOTHING`,
        [p.id, r.productoId, r.estrellas, r.texto, r.productoId === null ? null : r.calce, prenda?.talle ?? null, prenda?.color ?? null, nombre, estado],
      );
      if (ins.rowCount) {
        guardadas++;
        if (prenda?.slug) tocados.push(prenda.slug);
      }
    }
    if (estado === "publicada" && guardadas) {
      // Se ven ya: la ficha (estrellas y lista) y el final del inicio.
      deps.cache.limpiar();
      await deps.redis.publish(deps.canalInvalidar, JSON.stringify({ etiquetas: ["catalogo"] })).catch(() => 0);
      await deps.colas.stocker("invalidar", { slugs: tocados.slice(0, 500) }).catch(() => {});
    }
    return { guardadas, yaEstaban: req.body.resenas.length - guardadas, publicadas: estado === "publicada" };
  });
}
