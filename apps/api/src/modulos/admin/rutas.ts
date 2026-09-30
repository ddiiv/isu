import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type pg from "pg";
import type { Redis } from "ioredis";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { hash } from "@node-rs/argon2";
import { procesarFoto, FotoInvalida, type Almacen } from "@isu/almacen";
import { ConfigPublica, ESTADOS_PENDIENTES, Local, parteDe, slug as esquemaSlug } from "@isu/shared";
import type { Entorno } from "../../entorno.js";
import type { CacheCorta } from "../../lib/cache.js";
import type { Colas } from "../../lib/colas.js";
import { ErrorHttp } from "../../lib/errores.js";
import { ipDe } from "../../lib/cliente.js";
import type { ServicioPedidos } from "../pedidos/servicio.js";
import { ARGON_ADMIN } from "./ingreso.js";
import { rutasGuiasAdmin } from "./talles.js";
import { auditar, exigir, type Admin } from "./sesion.js";

/*
 * Backoffice. Todo exige sesión con doble factor y un rol:
 *   lectura   GET
 *   operador  pedidos, pagos, productos, fotos, categorías, descuentos, clientes
 *   dueno     ajustes, usuarios, auditoría
 * Cada cambio queda auditado (quién, qué, cuándo, desde qué IP).
 * Lo que cambia la vidriera tira la caché de la API y regenera las páginas.
 */
export interface DepsAdmin {
  pool: pg.Pool; redis: Redis; env: Entorno; colas: Colas; cache: CacheCorta; servicio: ServicioPedidos;
  fotos: Almacen | null; comprobantes: Almacen | null; canalInvalidar: string;
}

const Id = z.coerce.number().int().positive().max(2_147_483_647);
const NUMERO = z.string().regex(/^ISU-\d{4,10}$/);
const Pagina = z.coerce.number().int().min(1).max(10_000).default(1);
const POR_PAGINA = 50;
const ESTADOS_ENTREGA = ["listo_para_retirar", "retirado", "enviado", "entregado"] as const;

export async function rutasAdmin(app: FastifyInstance, deps: DepsAdmin) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const { pool } = deps;
  const ip = (req: FastifyRequest) => ipDe(req, deps.env.INTERNO_TOKEN);
  app.addHook("onSend", async (req, reply) => { if (req.url.startsWith("/v1/admin")) reply.header("cache-control", "no-store"); });

  /** La vidriera cambió: caché de esta réplica, de las demás, y las páginas de la tienda. */
  async function invalidar(slugs: string[]) {
    deps.cache.limpiar();
    await deps.redis.publish(deps.canalInvalidar, JSON.stringify({ etiquetas: ["catalogo"] })).catch(() => 0);
    await deps.colas.stocker("invalidar", { slugs: slugs.slice(0, 500) });
  }
  const slugsDe = async (ids: number[]) => (await pool.query<{ slug: string }>("SELECT slug FROM tienda.productos WHERE id = ANY($1::int[])", [ids])).rows.map((r) => r.slug);

  // ── Panel ────────────────────────────────────────────────────────
  api.get("/v1/admin/resumen", async (req) => {
    await exigir(pool, req);
    const [ped, rev, cat, sinc] = await Promise.all([
      pool.query<{ hoy: number; ventas_hoy: number; ventas_mes: number }>(
        `SELECT count(*) FILTER (WHERE creado_en::date = (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date)::int AS hoy,
                COALESCE(sum(total) FILTER (WHERE estado IN ('pagado','enviado','entregado','listo_para_retirar','retirado') AND pagado_en > date_trunc('day', now() AT TIME ZONE 'America/Argentina/Buenos_Aires') AT TIME ZONE 'America/Argentina/Buenos_Aires'), 0)::bigint AS ventas_hoy,
                COALESCE(sum(total) FILTER (WHERE estado IN ('pagado','enviado','entregado','listo_para_retirar','retirado') AND pagado_en > date_trunc('month', now())), 0)::bigint AS ventas_mes
           FROM tienda.pedidos`),
      pool.query<{ estado: string; n: number }>(
        `SELECT estado, count(*)::int AS n FROM tienda.pedidos
          WHERE estado IN ('esperando_pago','esperando_transferencia','transferencia_informada','a_pagar_en_local','pagado','pagado_tarde','listo_para_retirar') GROUP BY estado`),
      pool.query<{ publicados: number; sin_fotos: number; agotados: number }>(
        `SELECT count(*) FILTER (WHERE p.visible AND p.en_stocker)::int AS publicados,
                count(*) FILTER (WHERE p.visible AND p.en_stocker AND NOT EXISTS (SELECT 1 FROM tienda.fotos f WHERE f.producto_id = p.id))::int AS sin_fotos,
                count(*) FILTER (WHERE p.visible AND p.en_stocker AND NOT EXISTS (SELECT 1 FROM tienda.variantes v WHERE v.producto_id = p.id AND v.activo AND v.stock > 0))::int AS agotados
           FROM tienda.productos p`),
      pool.query<{ tipo: string; inicio: Date; fin: Date | null; error: string | null; cambios: number | null }>(
        "SELECT DISTINCT ON (tipo) tipo, inicio, fin, error, cambios FROM tienda.sincronizaciones ORDER BY tipo, inicio DESC"),
    ]);
    const p = ped.rows[0]!;
    return {
      pedidosHoy: p.hoy, ventasHoy: Number(p.ventas_hoy), ventasMes: Number(p.ventas_mes),
      porEstado: Object.fromEntries(rev.rows.map((r) => [r.estado, r.n])),
      catalogo: cat.rows[0],
      sincronizacion: sinc.rows.map((s) => ({ tipo: s.tipo, inicio: s.inicio.toISOString(), fin: s.fin?.toISOString() ?? null, error: s.error, cambios: s.cambios })),
    };
  });

  // ── Pedidos ──────────────────────────────────────────────────────
  api.get("/v1/admin/pedidos", { schema: { querystring: z.object({ estado: z.string().regex(/^[a-z_]{3,30}$/).optional(), q: z.string().trim().max(80).optional(), pagina: Pagina }).strict() } }, async (req) => {
    await exigir(pool, req);
    const { estado, q, pagina } = req.query;
    const filtro: string[] = ["estado NOT IN ('reservando')"];
    const params: unknown[] = [];
    if (estado) { params.push(estado); filtro.push(`estado = $${params.length}`); }
    if (q) { params.push(`%${q.replace(/[%_\\]/g, "\\$&")}%`); filtro.push(`(numero ILIKE $${params.length} OR email ILIKE $${params.length} OR (nombre || ' ' || apellido) ILIKE $${params.length} OR dni ILIKE $${params.length})`); }
    params.push(POR_PAGINA, (pagina - 1) * POR_PAGINA);
    const { rows } = await pool.query(
      `SELECT numero, estado, medio_pago AS "medioPago", entrega, total, nombre, apellido, email, creado_en AS "creadoEn", vence_en AS "venceEn", pagado_en AS "pagadoEn",
              count(*) OVER()::int AS "totalFilas"
         FROM tienda.pedidos WHERE ${filtro.join(" AND ")} ORDER BY creado_en DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return { pedidos: rows.map(({ totalFilas: _t, ...r }) => r), total: rows[0]?.totalFilas ?? 0, porPagina: POR_PAGINA };
  });

  api.get("/v1/admin/pedidos/:numero", { schema: { params: z.object({ numero: NUMERO }) } }, async (req) => {
    await exigir(pool, req);
    const { rows } = await pool.query("SELECT * FROM tienda.pedidos WHERE numero = $1", [req.params.numero]);
    const p = rows[0];
    if (!p) throw new ErrorHttp(404, "no_encontrado", "No existe ese pedido.");
    const [items, pagos, eventos, comprobantes] = await Promise.all([
      pool.query("SELECT sku, nombre, color, talle, precio, precio_lista AS \"precioLista\", cantidad FROM tienda.pedido_items WHERE pedido_id = $1 ORDER BY id", [p.id]),
      pool.query("SELECT proveedor, externo, estado, monto, registrado_por AS \"registradoPor\", creado_en AS \"creadoEn\" FROM tienda.pagos WHERE pedido_id = $1 ORDER BY id", [p.id]),
      pool.query("SELECT estado, detalle, actor, creado_en AS \"creadoEn\" FROM tienda.pedido_eventos WHERE pedido_id = $1 ORDER BY id", [p.id]),
      pool.query("SELECT id, tipo, bytes, creado_en AS \"creadoEn\" FROM tienda.comprobantes WHERE pedido_id = $1 ORDER BY id", [p.id]),
    ]);
    const { acceso_hash: _a, ip: _ip, ...publico } = p;
    return { pedido: publico, items: items.rows, pagos: pagos.rows, eventos: eventos.rows, comprobantes: comprobantes.rows };
  });

  // Registrar un pago (transferencia acreditada, cobro en el local).
  api.post("/v1/admin/pedidos/:numero/pago", {
    schema: { params: z.object({ numero: NUMERO }), body: z.object({ medio: z.enum(["transferencia", "local"]), monto: z.number().int().positive(), referencia: z.string().trim().min(3).max(80) }).strict() },
  }, async (req) => {
    const a = await exigir(pool, req, "operador");
    const r = await deps.servicio.pagar(req.params.numero, { proveedor: req.body.medio, externo: req.body.referencia, monto: req.body.monto, detalle: { desde: "backoffice" }, quien: a.email });
    await auditar(pool, a, "registrar_pago", "pedido", req.params.numero, req.body, ip(req));
    return r;
  });

  api.post("/v1/admin/pedidos/:numero/cancelar", { schema: { params: z.object({ numero: NUMERO }), body: z.object({ motivo: z.string().trim().min(3).max(300) }).strict() } }, async (req) => {
    const a = await exigir(pool, req, "operador");
    const { rows } = await pool.query("SELECT * FROM tienda.pedidos WHERE numero = $1", [req.params.numero]);
    const p = rows[0];
    if (!p) throw new ErrorHttp(404, "no_encontrado", "No existe ese pedido.");
    const cancelable = (ESTADOS_PENDIENTES as readonly string[]).includes(p.estado) || (p.estado === "pagado" && await deps.servicio.sigueEnDeposito(p.numero).catch(() => false));
    if (!cancelable) throw new ErrorHttp(409, "no_cancelable", "Este pedido ya no se puede cancelar desde acá (ya salió o ya estaba cerrado).");
    const c = await deps.servicio.liberar(p, "cancelado", `Cancelado por ${a.nombre}: ${req.body.motivo}`, a.email);
    if (!c) throw new ErrorHttp(409, "cambio", "El pedido cambió de estado mientras tanto. Recargá.");
    await auditar(pool, a, "cancelar_pedido", "pedido", p.numero, { motivo: req.body.motivo, estadoAnterior: p.estado }, ip(req));
    return { numero: p.numero, estado: "cancelado", reembolsar: p.estado === "pagado" };
  });

  // Entrega (hasta que la etapa 4 lo haga con los correos).
  api.post("/v1/admin/pedidos/:numero/entrega", { schema: { params: z.object({ numero: NUMERO }), body: z.object({ estado: z.enum(ESTADOS_ENTREGA), detalle: z.string().trim().max(300).optional() }).strict() } }, async (req) => {
    const a = await exigir(pool, req, "operador");
    const validos: Record<string, string[]> = {
      listo_para_retirar: ["pagado"], retirado: ["listo_para_retirar", "pagado"], enviado: ["pagado"], entregado: ["enviado"],
    };
    const { rows } = await pool.query<{ id: number; estado: string; entrega: string }>(
      "UPDATE tienda.pedidos SET estado = $2, actualizado_en = now() WHERE numero = $1 AND estado = ANY($3::text[]) RETURNING id, estado, entrega",
      [req.params.numero, req.body.estado, validos[req.body.estado]],
    );
    if (!rows[0]) throw new ErrorHttp(409, "transicion", "Ese cambio de estado no corresponde para este pedido.");
    await deps.servicio.evento(pool, rows[0].id, req.body.estado, a.email, req.body.detalle);
    await auditar(pool, a, "entrega", "pedido", req.params.numero, req.body, ip(req));
    return { numero: req.params.numero, estado: req.body.estado };
  });

  api.post("/v1/admin/pedidos/:numero/notas", { schema: { params: z.object({ numero: NUMERO }), body: z.object({ notas: z.string().trim().max(1000) }).strict() } }, async (req) => {
    const a = await exigir(pool, req, "operador");
    const r = await pool.query("UPDATE tienda.pedidos SET notas_internas = NULLIF($2, '') WHERE numero = $1", [req.params.numero, req.body.notas]);
    if (!r.rowCount) throw new ErrorHttp(404, "no_encontrado", "No existe ese pedido.");
    await auditar(pool, a, "notas", "pedido", req.params.numero, null, ip(req));
    return { ok: true };
  });

  // Comprobante: se descarga (nunca se muestra en línea: un PDF o una imagen ajena no se ejecuta en nuestro dominio).
  api.get("/v1/admin/pedidos/:numero/comprobantes/:id", { schema: { params: z.object({ numero: NUMERO, id: Id }) } }, async (req, reply) => {
    const a = await exigir(pool, req);
    if (!deps.comprobantes) throw new ErrorHttp(503, "sin_almacen", "No hay almacén de comprobantes configurado.");
    const { rows } = await pool.query<{ clave: string; tipo: string }>(
      "SELECT c.clave, c.tipo FROM tienda.comprobantes c JOIN tienda.pedidos p ON p.id = c.pedido_id WHERE p.numero = $1 AND c.id = $2", [req.params.numero, req.params.id]);
    if (!rows[0]) throw new ErrorHttp(404, "no_encontrado", "No existe ese comprobante.");
    const datos = await deps.comprobantes.leer(rows[0].clave);
    if (!datos) throw new ErrorHttp(404, "no_encontrado", "El archivo no está.");
    await auditar(pool, a, "ver_comprobante", "pedido", req.params.numero, { id: req.params.id }, ip(req));
    return reply
      .header("content-type", rows[0].tipo)
      .header("content-disposition", `attachment; filename="comprobante-${req.params.numero}-${req.params.id}.${rows[0].tipo === "application/pdf" ? "pdf" : "webp"}"`)
      .header("content-security-policy", "default-src 'none'; sandbox")
      .send(datos);
  });

  // ── Productos ────────────────────────────────────────────────────
  api.get("/v1/admin/productos", {
    schema: {
      querystring: z.object({
        q: z.string().trim().max(80).optional(),
        categoria: Id.optional(),
        filtro: z.enum(["todos", "visibles", "ocultos", "sin_fotos", "agotados", "destacados", "nuevos", "de_baja"]).default("todos"),
        pagina: Pagina,
      }).strict(),
    },
  }, async (req) => {
    await exigir(pool, req);
    const { q, categoria, filtro, pagina } = req.query;
    const w: string[] = [];
    const params: unknown[] = [];
    if (q) { params.push(`%${q.replace(/[%_\\]/g, "\\$&")}%`); w.push(`(p.nombre ILIKE $${params.length} OR p.stocker_padre ILIKE $${params.length})`); }
    if (categoria) { params.push(categoria); w.push(`EXISTS (SELECT 1 FROM tienda.producto_categorias pc JOIN tienda.categorias c ON c.id = pc.categoria_id WHERE pc.producto_id = p.id AND (c.id = $${params.length} OR c.padre_id = $${params.length}))`); }
    const filtros: Record<string, string> = {
      todos: "p.en_stocker", visibles: "p.en_stocker AND p.visible", ocultos: "p.en_stocker AND NOT p.visible", de_baja: "NOT p.en_stocker",
      sin_fotos: "p.en_stocker AND NOT EXISTS (SELECT 1 FROM tienda.fotos f WHERE f.producto_id = p.id)",
      agotados: "p.en_stocker AND NOT EXISTS (SELECT 1 FROM tienda.variantes v WHERE v.producto_id = p.id AND v.activo AND v.stock > 0)",
      destacados: "p.destacado", nuevos: "p.nuevo",
    };
    w.push(filtros[filtro]!);
    params.push(POR_PAGINA, (pagina - 1) * POR_PAGINA);
    const { rows } = await pool.query(
      `SELECT p.id, p.slug, p.nombre, p.stocker_padre AS sku, p.visible, p.en_stocker AS "enStocker", p.destacado, p.destacado_orden AS "destacadoOrden", p.nuevo,
              p.stocker_categoria AS "categoriaStocker", p.stocker_genero AS "generoStocker", p.categorias_fijas AS "categoriasFijas",
              (SELECT COALESCE(sum(v.stock), 0)::int FROM tienda.variantes v WHERE v.producto_id = p.id AND v.activo) AS stock,
              (SELECT min(v.precio) FROM tienda.variantes v WHERE v.producto_id = p.id AND v.activo) AS precio,
              (SELECT count(*)::int FROM tienda.fotos f WHERE f.producto_id = p.id) AS fotos,
              (SELECT count(*)::int FROM tienda.producto_colores c WHERE c.producto_id = p.id AND c.activo) AS colores,
              (SELECT f.clave FROM tienda.fotos f WHERE f.producto_id = p.id ORDER BY (f.tipo = 'exhibicion') DESC, f.orden, f.id LIMIT 1) AS foto,
              COALESCE((SELECT array_agg(pc.categoria_id ORDER BY pc.categoria_id) FROM tienda.producto_categorias pc WHERE pc.producto_id = p.id), '{}') AS categorias,
              count(*) OVER()::int AS "totalFilas"
         FROM tienda.productos p WHERE ${w.join(" AND ")}
        ORDER BY p.creado_en DESC, p.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return { productos: rows.map(({ totalFilas: _t, ...r }) => r), total: rows[0]?.totalFilas ?? 0, porPagina: POR_PAGINA };
  });

  api.get("/v1/admin/productos/:id", { schema: { params: z.object({ id: Id }) } }, async (req) => {
    await exigir(pool, req);
    const { rows } = await pool.query("SELECT * FROM tienda.productos WHERE id = $1", [req.params.id]);
    const p = rows[0];
    if (!p) throw new ErrorHttp(404, "no_encontrado", "No existe ese producto.");
    const [colores, fotos, variantes, cats] = await Promise.all([
      pool.query("SELECT id, clave, nombre, hex, orden, activo FROM tienda.producto_colores WHERE producto_id = $1 ORDER BY orden, id", [p.id]),
      pool.query("SELECT id, tipo, color_id AS \"colorId\", orden, clave, ancho, alto, alt FROM tienda.fotos WHERE producto_id = $1 ORDER BY tipo, color_id NULLS FIRST, orden, id", [p.id]),
      pool.query("SELECT sku, talle, precio, stock, activo, color_id AS \"colorId\" FROM tienda.variantes WHERE producto_id = $1 ORDER BY orden, id", [p.id]),
      pool.query<{ categoria_id: number }>("SELECT categoria_id FROM tienda.producto_categorias WHERE producto_id = $1", [p.id]),
    ]);
    const nColores = colores.rows.filter((c) => c.activo).length;
    return {
      producto: {
        id: p.id, slug: p.slug, nombre: p.nombre, nombreFijo: p.nombre_fijo, sku: p.stocker_padre, visible: p.visible, enStocker: p.en_stocker,
        descripcion: p.descripcion, descripcionStocker: p.stocker_descripcion, seoTitulo: p.seo_titulo, seoDescripcion: p.seo_descripcion,
        categoriaStocker: p.stocker_categoria, generoStocker: p.stocker_genero, categoriasFijas: p.categorias_fijas,
        destacado: p.destacado, destacadoOrden: p.destacado_orden, nuevo: p.nuevo, categorias: cats.rows.map((c) => c.categoria_id),
        guiaTallesId: p.guia_talles_id, parteOutfit: p.parte_outfit, parteOutfitSugerida: parteDe(p.stocker_categoria, p.nombre),
      },
      colores: colores.rows, fotos: fotos.rows, variantes: variantes.rows,
      // El tope del padre sale solo: 5 por cada color.
      topeFotos: nColores * 5,
    };
  });

  const CambiosProducto = z.object({
    nombre: z.string().trim().min(2).max(150).optional(),
    nombreFijo: z.boolean().optional(),
    descripcion: z.string().trim().max(5000).nullable().optional(),
    seoTitulo: z.string().trim().max(70).nullable().optional(),
    seoDescripcion: z.string().trim().max(160).nullable().optional(),
    visible: z.boolean().optional(),
    destacado: z.boolean().optional(),
    destacadoOrden: z.number().int().min(-1000).max(1000).optional(),
    nuevo: z.boolean().optional(),
    categorias: z.array(Id).max(20).optional(),
    guiaTallesId: Id.nullable().optional(),
    // null = automático (según la categoría).
    parteOutfit: z.enum(["arriba", "abajo", "abrigo", "ninguna"]).nullable().optional(),
  }).strict();

  async function aplicarCambios(cli: pg.PoolClient, ids: number[], c: z.infer<typeof CambiosProducto>) {
    const sets: string[] = [];
    const params: unknown[] = [ids];
    const poner = (col: string, v: unknown) => { params.push(v); sets.push(`${col} = $${params.length}`); };
    if (c.nombre !== undefined) { poner("nombre", c.nombre); sets.push("nombre_fijo = true"); }
    if (c.nombreFijo !== undefined && c.nombre === undefined) poner("nombre_fijo", c.nombreFijo);
    if (c.descripcion !== undefined) poner("descripcion", c.descripcion || null);
    if (c.seoTitulo !== undefined) poner("seo_titulo", c.seoTitulo || null);
    if (c.seoDescripcion !== undefined) poner("seo_descripcion", c.seoDescripcion || null);
    if (c.visible !== undefined) poner("visible", c.visible);
    if (c.destacado !== undefined) poner("destacado", c.destacado);
    if (c.destacadoOrden !== undefined) poner("destacado_orden", c.destacadoOrden);
    if (c.parteOutfit !== undefined) poner("parte_outfit", c.parteOutfit);
    if (c.guiaTallesId !== undefined) {
      if (c.guiaTallesId !== null && !(await cli.query("SELECT 1 FROM tienda.guias_talles WHERE id = $1", [c.guiaTallesId])).rowCount) throw new ErrorHttp(400, "guia", "Esa guía de talles no existe.");
      poner("guia_talles_id", c.guiaTallesId);
    }
    if (c.nuevo !== undefined) {
      poner("nuevo", c.nuevo);
      // La fecha en que se marcó: los recién marcados van primero en "Nuevos".
      sets.push(c.nuevo ? "nuevo_desde = CASE WHEN nuevo THEN nuevo_desde ELSE now() END" : "nuevo_desde = NULL");
    }
    if (sets.length) await cli.query(`UPDATE tienda.productos SET ${sets.join(", ")}, actualizado_en = now() WHERE id = ANY($1::int[])`, params);
    if (c.categorias) {
      const validas = (await cli.query<{ id: number }>("SELECT id FROM tienda.categorias WHERE id = ANY($1::int[])", [c.categorias])).rows.map((r) => r.id);
      if (validas.length !== new Set(c.categorias).size) throw new ErrorHttp(400, "categoria", "Alguna categoría no existe.");
      await cli.query("DELETE FROM tienda.producto_categorias WHERE producto_id = ANY($1::int[])", [ids]);
      if (validas.length) await cli.query("INSERT INTO tienda.producto_categorias SELECT p, c FROM unnest($1::int[]) p, unnest($2::int[]) c", [ids, validas]);
      // Corregidas a mano: la sincronización con Stocker no las vuelve a tocar.
      await cli.query("UPDATE tienda.productos SET categorias_fijas = true, categoria_id = $2 WHERE id = ANY($1::int[])", [ids, validas[0] ?? null]);
    }
  }

  api.patch("/v1/admin/productos/:id", { schema: { params: z.object({ id: Id }), body: CambiosProducto } }, async (req) => {
    const a = await exigir(pool, req, "operador");
    const cli = await pool.connect();
    try {
      await cli.query("BEGIN");
      const ex = await cli.query("SELECT 1 FROM tienda.productos WHERE id = $1 FOR UPDATE", [req.params.id]);
      if (!ex.rowCount) throw new ErrorHttp(404, "no_encontrado", "No existe ese producto.");
      await aplicarCambios(cli, [req.params.id], req.body);
      await auditar(cli, a, "editar_producto", "producto", req.params.id, req.body, ip(req));
      await cli.query("COMMIT");
    } catch (e) { await cli.query("ROLLBACK").catch(() => {}); throw e; } finally { cli.release(); }
    await invalidar(await slugsDe([req.params.id]));
    return { ok: true };
  });

  // Edición masiva: los mismos cambios a muchos productos a la vez (visible, destacado, nuevo, categorías).
  api.post("/v1/admin/productos/masivo", {
    schema: {
      body: z.object({
        ids: z.array(Id).min(1).max(500),
        cambios: CambiosProducto.pick({ visible: true, destacado: true, nuevo: true, categorias: true, guiaTallesId: true, parteOutfit: true }).extend({
          agregarCategoria: Id.optional(), quitarCategoria: Id.optional(),
        }).strict(),
      }).strict(),
    },
  }, async (req) => {
    const a = await exigir(pool, req, "operador");
    const ids = [...new Set(req.body.ids)];
    const { agregarCategoria, quitarCategoria, ...cambios } = req.body.cambios;
    const cli = await pool.connect();
    try {
      await cli.query("BEGIN");
      await aplicarCambios(cli, ids, cambios);
      if (agregarCategoria) {
        if (!(await cli.query("SELECT 1 FROM tienda.categorias WHERE id = $1", [agregarCategoria])).rowCount) throw new ErrorHttp(400, "categoria", "Esa categoría no existe.");
        await cli.query("INSERT INTO tienda.producto_categorias SELECT unnest($1::int[]), $2 ON CONFLICT DO NOTHING", [ids, agregarCategoria]);
        await cli.query("UPDATE tienda.productos SET categorias_fijas = true, categoria_id = COALESCE(categoria_id, $2) WHERE id = ANY($1::int[])", [ids, agregarCategoria]);
      }
      if (quitarCategoria) {
        await cli.query("DELETE FROM tienda.producto_categorias WHERE producto_id = ANY($1::int[]) AND categoria_id = $2", [ids, quitarCategoria]);
        await cli.query(`UPDATE tienda.productos p SET categorias_fijas = true,
          categoria_id = (SELECT min(categoria_id) FROM tienda.producto_categorias pc WHERE pc.producto_id = p.id) WHERE id = ANY($1::int[])`, [ids]);
      }
      await auditar(cli, a, "edicion_masiva", "producto", null, { ids, cambios: req.body.cambios }, ip(req));
      await cli.query("COMMIT");
    } catch (e) { await cli.query("ROLLBACK").catch(() => {}); throw e; } finally { cli.release(); }
    await invalidar(await slugsDe(ids));
    return { ok: true, productos: ids.length };
  });

  api.patch("/v1/admin/colores/:id", { schema: { params: z.object({ id: Id }), body: z.object({ hex: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable() }).strict() } }, async (req) => {
    const a = await exigir(pool, req, "operador");
    const { rows } = await pool.query<{ producto_id: number }>("UPDATE tienda.producto_colores SET hex = $2 WHERE id = $1 RETURNING producto_id", [req.params.id, req.body.hex]);
    if (!rows[0]) throw new ErrorHttp(404, "no_encontrado", "No existe ese color.");
    await auditar(pool, a, "color_hex", "color", req.params.id, req.body, ip(req));
    await invalidar(await slugsDe([rows[0].producto_id]));
    return { ok: true };
  });

  // ── Fotos ────────────────────────────────────────────────────────
  await app.register(async (sub) => {
    const TIPOS = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/avif"];
    sub.addContentTypeParser(TIPOS, { parseAs: "buffer", bodyLimit: 26 * 1024 * 1024 }, (_r, cuerpo, hecho) => hecho(null, cuerpo));
    sub.withTypeProvider<ZodTypeProvider>().post("/v1/admin/productos/:id/fotos", {
      bodyLimit: 26 * 1024 * 1024,
      schema: { params: z.object({ id: Id }), querystring: z.object({ tipo: z.enum(["color", "exhibicion"]), color: Id.optional(), alt: z.string().trim().max(160).optional() }).strict() },
    }, async (req, reply) => {
      const a = await exigir(pool, req, "operador");
      if (!deps.fotos) throw new ErrorHttp(503, "sin_almacen", "No hay almacén de fotos configurado (FOTOS_DIR o R2).");
      const { tipo, color, alt } = req.query;
      if (tipo === "color" && !color) throw new ErrorHttp(400, "color", "Una foto de color necesita el color.");
      let proc;
      try { proc = await procesarFoto(req.body as Buffer); } catch (e) {
        throw new ErrorHttp(400, "foto_invalida", e instanceof FotoInvalida ? e.message : "No se pudo procesar la imagen.");
      }
      const clave = `p/${req.params.id}/${randomBytes(8).toString("hex")}`;
      const cli = await pool.connect();
      let id: number;
      try {
        await cli.query("BEGIN");
        const p = await cli.query<{ nombre: string }>("SELECT nombre FROM tienda.productos WHERE id = $1", [req.params.id]);
        if (!p.rows[0]) throw new ErrorHttp(404, "no_encontrado", "No existe ese producto.");
        const orden = await cli.query<{ n: number }>(
          "SELECT COALESCE(max(orden) + 1, 0)::int AS n FROM tienda.fotos WHERE producto_id = $1 AND tipo = $2 AND color_id IS NOT DISTINCT FROM $3", [req.params.id, tipo, color ?? null]);
        // El trigger de la base aplica los topes (5 por color, 5 × colores por producto).
        id = (await cli.query<{ id: number }>(
          "INSERT INTO tienda.fotos (producto_id, tipo, color_id, orden, clave, ancho, alto, alt) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
          [req.params.id, tipo, color ?? null, orden.rows[0]!.n, clave, proc.ancho, proc.alto, (alt || p.rows[0].nombre).slice(0, 160)])).rows[0]!.id;
        for (const t of proc.tamanos) await deps.fotos.guardar(`${clave}-${t.ancho}.webp`, t.datos, "image/webp");
        await auditar(cli, a, "subir_foto", "producto", req.params.id, { foto: id, tipo, color }, ip(req));
        await cli.query("COMMIT");
      } catch (e) {
        await cli.query("ROLLBACK").catch(() => {});
        for (const w of [400, 800, 1200]) await deps.fotos.borrar(`${clave}-${w}.webp`).catch(() => {});
        const pg = e as { code?: string; message: string };
        if (pg.code === "23514") throw new ErrorHttp(409, "tope_fotos", pg.message);
        if (pg.code === "23503") throw new ErrorHttp(400, "color", "Ese color no es de este producto.");
        throw e;
      } finally { cli.release(); }
      await invalidar(await slugsDe([req.params.id]));
      return reply.code(201).send({ id, clave });
    });
  });

  api.delete("/v1/admin/fotos/:id", { schema: { params: z.object({ id: Id }) } }, async (req) => {
    const a = await exigir(pool, req, "operador");
    const { rows } = await pool.query<{ clave: string; producto_id: number }>("DELETE FROM tienda.fotos WHERE id = $1 RETURNING clave, producto_id", [req.params.id]);
    if (!rows[0]) throw new ErrorHttp(404, "no_encontrado", "No existe esa foto.");
    await auditar(pool, a, "borrar_foto", "producto", rows[0].producto_id, { foto: req.params.id }, ip(req));
    await invalidar(await slugsDe([rows[0].producto_id]));
    // Los archivos se borran después de regenerar las páginas (así nunca se ve una foto rota).
    setTimeout(() => { for (const w of [400, 800, 1200]) void deps.fotos?.borrar(`${rows[0]!.clave}-${w}.webp`).catch(() => {}); }, 60_000).unref();
    return { ok: true };
  });

  api.patch("/v1/admin/fotos/:id", { schema: { params: z.object({ id: Id }), body: z.object({ alt: z.string().trim().max(160).optional(), colorId: Id.nullable().optional() }).strict() } }, async (req) => {
    const a = await exigir(pool, req, "operador");
    const sets: string[] = []; const params: unknown[] = [req.params.id];
    if (req.body.alt !== undefined) { params.push(req.body.alt || null); sets.push(`alt = $${params.length}`); }
    if (req.body.colorId !== undefined) { params.push(req.body.colorId); sets.push(`color_id = $${params.length}`); }
    if (!sets.length) return { ok: true };
    let r;
    try { r = await pool.query<{ producto_id: number }>(`UPDATE tienda.fotos SET ${sets.join(", ")} WHERE id = $1 RETURNING producto_id`, params); } catch (e) {
      const pg = e as { code?: string; message: string };
      if (pg.code === "23514") throw new ErrorHttp(409, "tope_fotos", pg.message);
      if (pg.code === "23503") throw new ErrorHttp(400, "color", "Ese color no es de este producto.");
      throw e;
    }
    if (!r.rows[0]) throw new ErrorHttp(404, "no_encontrado", "No existe esa foto.");
    await auditar(pool, a, "editar_foto", "producto", r.rows[0].producto_id, { foto: req.params.id, ...req.body }, ip(req));
    await invalidar(await slugsDe([r.rows[0].producto_id]));
    return { ok: true };
  });

  api.post("/v1/admin/productos/:id/fotos/orden", { schema: { params: z.object({ id: Id }), body: z.object({ ids: z.array(Id).min(1).max(100) }).strict() } }, async (req) => {
    const a = await exigir(pool, req, "operador");
    const r = await pool.query(
      "UPDATE tienda.fotos f SET orden = x.o FROM unnest($2::int[]) WITH ORDINALITY AS x(id, o) WHERE f.id = x.id AND f.producto_id = $1", [req.params.id, req.body.ids]);
    await auditar(pool, a, "ordenar_fotos", "producto", req.params.id, { ids: req.body.ids }, ip(req));
    await invalidar(await slugsDe([req.params.id]));
    return { ok: true, ordenadas: r.rowCount };
  });

  // ── Categorías ───────────────────────────────────────────────────
  const Categoria = z.object({
    nombre: z.string().trim().min(2).max(60),
    slug: esquemaSlug,
    padreId: Id.nullable(),
    orden: z.number().int().min(0).max(1000).default(0),
    visible: z.boolean().default(true),
    seoTitulo: z.string().trim().max(70).nullable().optional(),
    seoDescripcion: z.string().trim().max(160).nullable().optional(),
  }).strict();
  const errorCategoria = (e: unknown) => {
    const pg = e as { code?: string; message: string };
    if (pg.code === "23505") return new ErrorHttp(409, "slug", "Ya hay una categoría con esa dirección en ese nivel.");
    if (pg.code === "23514") return new ErrorHttp(400, "niveles", pg.message);
    if (pg.code === "23503") return new ErrorHttp(400, "padre", "La categoría de arriba no existe.");
    return e;
  };
  api.get("/v1/admin/categorias", async (req) => {
    await exigir(pool, req);
    const { rows } = await pool.query(
      `SELECT c.id, c.nombre, c.slug, c.padre_id AS "padreId", c.orden, c.visible, c.seo_titulo AS "seoTitulo", c.seo_descripcion AS "seoDescripcion",
              (SELECT count(*)::int FROM tienda.producto_categorias pc WHERE pc.categoria_id = c.id) AS productos
         FROM tienda.categorias c ORDER BY c.padre_id NULLS FIRST, c.orden, c.nombre`);
    return { categorias: rows };
  });
  api.post("/v1/admin/categorias", { schema: { body: Categoria } }, async (req, reply) => {
    const a = await exigir(pool, req, "operador");
    const b = req.body;
    try {
      const { rows } = await pool.query<{ id: number }>(
        "INSERT INTO tienda.categorias (nombre, slug, padre_id, orden, visible, seo_titulo, seo_descripcion) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
        [b.nombre, b.slug, b.padreId, b.orden, b.visible, b.seoTitulo ?? null, b.seoDescripcion ?? null]);
      await auditar(pool, a, "crear_categoria", "categoria", rows[0]!.id, b, ip(req));
      await invalidar([]);
      return reply.code(201).send({ id: rows[0]!.id });
    } catch (e) { throw errorCategoria(e); }
  });
  api.patch("/v1/admin/categorias/:id", { schema: { params: z.object({ id: Id }), body: Categoria.partial() } }, async (req) => {
    const a = await exigir(pool, req, "operador");
    const mapa: Record<string, string> = { nombre: "nombre", slug: "slug", padreId: "padre_id", orden: "orden", visible: "visible", seoTitulo: "seo_titulo", seoDescripcion: "seo_descripcion" };
    const sets: string[] = []; const params: unknown[] = [req.params.id];
    for (const [k, v] of Object.entries(req.body)) { params.push(v ?? null); sets.push(`${mapa[k]} = $${params.length}`); }
    if (!sets.length) return { ok: true };
    try {
      const r = await pool.query(`UPDATE tienda.categorias SET ${sets.join(", ")} WHERE id = $1`, params);
      if (!r.rowCount) throw new ErrorHttp(404, "no_encontrado", "No existe esa categoría.");
    } catch (e) { throw errorCategoria(e); }
    await auditar(pool, a, "editar_categoria", "categoria", req.params.id, req.body, ip(req));
    await invalidar([]);
    return { ok: true };
  });
  api.delete("/v1/admin/categorias/:id", { schema: { params: z.object({ id: Id }) } }, async (req) => {
    const a = await exigir(pool, req, "operador");
    const uso = await pool.query<{ hijas: number; productos: number }>(
      "SELECT (SELECT count(*)::int FROM tienda.categorias WHERE padre_id = $1) AS hijas, (SELECT count(*)::int FROM tienda.producto_categorias WHERE categoria_id = $1) AS productos", [req.params.id]);
    const u = uso.rows[0]!;
    if (u.hijas || u.productos) throw new ErrorHttp(409, "en_uso", `No se puede borrar: tiene ${u.hijas} subcategorías y ${u.productos} productos. Movelos u ocultala.`);
    const r = await pool.query("DELETE FROM tienda.categorias WHERE id = $1", [req.params.id]);
    if (!r.rowCount) throw new ErrorHttp(404, "no_encontrado", "No existe esa categoría.");
    await auditar(pool, a, "borrar_categoria", "categoria", req.params.id, null, ip(req));
    await invalidar([]);
    return { ok: true };
  });

  // ── Descuentos masivos ───────────────────────────────────────────
  const Descuento = z.object({
    nombre: z.string().trim().min(2).max(80),
    porcentaje: z.number().int().min(1).max(90),
    alcance: z.enum(["todo", "categorias", "productos"]),
    categoriaIds: z.array(Id).max(100).default([]),
    productoIds: z.array(Id).max(2000).default([]),
    desde: z.iso.datetime({ offset: true }).nullable().default(null),
    hasta: z.iso.datetime({ offset: true }).nullable().default(null),
    activo: z.boolean().default(true),
  }).strict().refine((d) => d.alcance !== "categorias" || d.categoriaIds.length > 0, { message: "Elegí al menos una categoría", path: ["categoriaIds"] })
    .refine((d) => d.alcance !== "productos" || d.productoIds.length > 0, { message: "Elegí al menos un producto", path: ["productoIds"] })
    .refine((d) => !d.desde || !d.hasta || new Date(d.hasta) > new Date(d.desde), { message: "La fecha de fin tiene que ser posterior", path: ["hasta"] });
  const aFila = (d: z.infer<typeof Descuento>) => [d.nombre, d.porcentaje, d.alcance, d.alcance === "categorias" ? d.categoriaIds : [], d.alcance === "productos" ? d.productoIds : [], d.desde, d.hasta, d.activo];
  api.get("/v1/admin/descuentos", async (req) => {
    await exigir(pool, req);
    const { rows } = await pool.query(
      `SELECT id, nombre, porcentaje, alcance, categoria_ids AS "categoriaIds", producto_ids AS "productoIds", desde, hasta, activo, creado_por AS "creadoPor",
              (activo AND (desde IS NULL OR desde <= now()) AND (hasta IS NULL OR hasta > now())) AS vigente
         FROM tienda.descuentos ORDER BY activo DESC, id DESC`);
    return { descuentos: rows };
  });
  api.post("/v1/admin/descuentos", { schema: { body: Descuento } }, async (req, reply) => {
    const a = await exigir(pool, req, "operador");
    const { rows } = await pool.query<{ id: number }>(
      "INSERT INTO tienda.descuentos (nombre, porcentaje, alcance, categoria_ids, producto_ids, desde, hasta, activo, creado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id",
      [...aFila(req.body), a.email]);
    await auditar(pool, a, "crear_descuento", "descuento", rows[0]!.id, req.body, ip(req));
    await invalidar([]);
    return reply.code(201).send({ id: rows[0]!.id });
  });
  api.put("/v1/admin/descuentos/:id", { schema: { params: z.object({ id: Id }), body: Descuento } }, async (req) => {
    const a = await exigir(pool, req, "operador");
    const r = await pool.query(
      "UPDATE tienda.descuentos SET nombre=$2, porcentaje=$3, alcance=$4, categoria_ids=$5, producto_ids=$6, desde=$7, hasta=$8, activo=$9, actualizado_en=now() WHERE id = $1",
      [req.params.id, ...aFila(req.body)]);
    if (!r.rowCount) throw new ErrorHttp(404, "no_encontrado", "No existe ese descuento.");
    await auditar(pool, a, "editar_descuento", "descuento", req.params.id, req.body, ip(req));
    await invalidar([]);
    return { ok: true };
  });
  api.delete("/v1/admin/descuentos/:id", { schema: { params: z.object({ id: Id }) } }, async (req) => {
    const a = await exigir(pool, req, "operador");
    const r = await pool.query("DELETE FROM tienda.descuentos WHERE id = $1", [req.params.id]);
    if (!r.rowCount) throw new ErrorHttp(404, "no_encontrado", "No existe ese descuento.");
    await auditar(pool, a, "borrar_descuento", "descuento", req.params.id, null, ip(req));
    await invalidar([]);
    return { ok: true };
  });

  // ── Clientes ─────────────────────────────────────────────────────
  api.get("/v1/admin/clientes", { schema: { querystring: z.object({ q: z.string().trim().max(80).optional(), pagina: Pagina }).strict() } }, async (req) => {
    await exigir(pool, req);
    const params: unknown[] = [];
    let w = "true";
    if (req.query.q) { params.push(`%${req.query.q.replace(/[%_\\]/g, "\\$&")}%`); w = "(c.email ILIKE $1 OR (c.nombre || ' ' || COALESCE(c.apellido,'')) ILIKE $1 OR c.dni ILIKE $1 OR c.telefono ILIKE $1)"; }
    params.push(POR_PAGINA, (req.query.pagina - 1) * POR_PAGINA);
    const { rows } = await pool.query(
      `SELECT c.id, c.email, c.nombre, c.apellido, c.telefono, c.dni, c.hash IS NOT NULL AS "tieneCuenta", c.acepta_novedades AS "aceptaNovedades", c.creado_en AS "creadoEn",
              count(p.id) FILTER (WHERE p.estado IN ('pagado','enviado','entregado','listo_para_retirar','retirado'))::int AS compras,
              COALESCE(sum(p.total) FILTER (WHERE p.estado IN ('pagado','enviado','entregado','listo_para_retirar','retirado')), 0)::bigint AS gastado,
              max(p.creado_en) AS "ultimaCompra", count(*) OVER()::int AS "totalFilas"
         FROM tienda.clientes c LEFT JOIN tienda.pedidos p ON p.cliente_id = c.id
        WHERE ${w} GROUP BY c.id ORDER BY max(p.creado_en) DESC NULLS LAST, c.id DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return { clientes: rows.map(({ totalFilas: _t, ...r }) => ({ ...r, gastado: Number(r.gastado) })), total: rows[0]?.totalFilas ?? 0, porPagina: POR_PAGINA };
  });
  // Mandar a Stocker (con reintentos, por el worker). Uno o todos.
  api.post("/v1/admin/clientes/sincronizar", { schema: { body: z.object({ ids: z.array(Id).max(5000).optional() }).strict() } }, async (req) => {
    const a = await exigir(pool, req, req.body.ids ? "operador" : "dueno");
    const { rows } = await pool.query<{ id: number; email: string; nombre: string; apellido: string | null; telefono: string | null; dni: string | null }>(
      req.body.ids ? "SELECT id, email, nombre, apellido, telefono, dni FROM tienda.clientes WHERE id = ANY($1::int[])" : "SELECT id, email, nombre, apellido, telefono, dni FROM tienda.clientes",
      req.body.ids ? [req.body.ids] : []);
    for (const c of rows) await deps.colas.stocker("cliente", { email: c.email, nombre: c.nombre, apellido: c.apellido, telefono: c.telefono, dni: c.dni });
    await auditar(pool, a, "sincronizar_clientes", "cliente", null, { cantidad: rows.length }, ip(req));
    return { encolados: rows.length };
  });

  // ── Ajustes (sólo el dueño) ──────────────────────────────────────
  const Transferencia = z.object({
    titular: z.string().trim().max(100), cuit: z.string().trim().regex(/^$|^\d{2}-?\d{8}-?\d$/, "CUIT inválido"),
    banco: z.string().trim().max(60), cbu: z.string().trim().regex(/^$|^\d{22}$/, "El CBU/CVU tiene 22 números"),
    alias: z.string().trim().regex(/^$|^[A-Za-z0-9.-]{6,20}$/, "El alias tiene de 6 a 20 letras, números, puntos o guiones"),
  }).strict();
  const AJUSTES: Record<string, z.ZodType> = {
    ...Object.fromEntries(Object.entries(ConfigPublica.shape).filter(([k]) => !["mediosPago"].includes(k))),
    locales: z.array(Local).max(20),
    costoEnvio: z.number().int().min(0).max(100_000_000),
    horasPagoOnline: z.number().int().min(1).max(72),
    horasPagoFacil: z.number().int().min(24).max(240),
    horasTransferencia: z.number().int().min(2).max(240),
    horasPagoLocal: z.number().int().min(24).max(720),
    datosTransferencia: Transferencia,
    publicarNuevos: z.boolean(),
  };
  api.get("/v1/admin/ajustes", async (req) => {
    await exigir(pool, req, "dueno");
    const { rows } = await pool.query("SELECT clave, valor, actualizado_por AS \"actualizadoPor\", actualizado_en AS \"actualizadoEn\" FROM tienda.ajustes WHERE clave = ANY($1::text[])", [Object.keys(AJUSTES)]);
    return { ajustes: rows };
  });
  api.put("/v1/admin/ajustes", { schema: { body: z.record(z.string().regex(/^[a-zA-Z]{2,40}$/), z.unknown()) } }, async (req) => {
    const a = await exigir(pool, req, "dueno");
    const limpios: Array<[string, unknown]> = [];
    const errores: Array<{ campo: string; motivo: string }> = [];
    for (const [k, v] of Object.entries(req.body)) {
      const esquema = Object.hasOwn(AJUSTES, k) ? AJUSTES[k] : undefined;
      if (!esquema) { errores.push({ campo: k, motivo: "No es un ajuste editable" }); continue; }
      const r = esquema.safeParse(v);
      if (!r.success) errores.push({ campo: k, motivo: r.error.issues[0]?.message ?? "Valor inválido" });
      else limpios.push([k, r.data]);
    }
    if (errores.length) throw new ErrorHttp(400, "validacion", `Revisá: ${errores.map((e) => `${e.campo} (${e.motivo})`).join(", ")}`, { detalles: errores });
    const cli = await pool.connect();
    try {
      await cli.query("BEGIN");
      for (const [k, v] of limpios) {
        await cli.query(
          `INSERT INTO tienda.ajustes (clave, valor, actualizado_por, actualizado_en) VALUES ($1, $2, $3, now())
           ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_por = EXCLUDED.actualizado_por, actualizado_en = now()`,
          [k, JSON.stringify(v), a.email]);
      }
      // Los datos bancarios son sensibles: se audita que cambiaron, y cuáles, pero el detalle queda completo para rastrear fraudes.
      await auditar(cli, a, "ajustes", "ajuste", limpios.map(([k]) => k).join(",").slice(0, 60), Object.fromEntries(limpios), ip(req));
      await cli.query("COMMIT");
    } catch (e) { await cli.query("ROLLBACK").catch(() => {}); throw e; } finally { cli.release(); }
    await invalidar([]);
    return { ok: true, guardados: limpios.map(([k]) => k) };
  });

  // ── Usuarios del backoffice (sólo el dueño) ──────────────────────
  const claveProvisoria = () => randomBytes(12).toString("base64url");
  api.get("/v1/admin/usuarios", async (req) => {
    await exigir(pool, req, "dueno");
    const { rows } = await pool.query(
      `SELECT id, email, nombre, rol, activo, totp_activo AS "dobleFactor", debe_cambiar_clave AS "claveProvisoria", ultimo_ingreso AS "ultimoIngreso",
              bloqueado_hasta > now() AS bloqueado FROM tienda.admins ORDER BY id`);
    return { usuarios: rows };
  });
  api.post("/v1/admin/usuarios", { schema: { body: z.object({ email: z.string().trim().toLowerCase().email().max(150), nombre: z.string().trim().min(2).max(100), rol: z.enum(["dueno", "operador", "lectura"]) }).strict() } }, async (req, reply) => {
    const a = await exigir(pool, req, "dueno");
    const clave = claveProvisoria();
    try {
      const { rows } = await pool.query<{ id: number }>("INSERT INTO tienda.admins (email, nombre, hash, rol) VALUES ($1,$2,$3,$4) RETURNING id",
        [req.body.email, req.body.nombre, await hash(clave, ARGON_ADMIN), req.body.rol]);
      await auditar(pool, a, "crear_usuario", "admin", rows[0]!.id, { email: req.body.email, rol: req.body.rol }, ip(req));
      // La contraseña provisoria se muestra UNA vez; al entrar, la tiene que cambiar.
      return reply.code(201).send({ id: rows[0]!.id, claveProvisoria: clave });
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new ErrorHttp(409, "email", "Ya hay un usuario con ese email.");
      throw e;
    }
  });
  api.patch("/v1/admin/usuarios/:id", { schema: { params: z.object({ id: Id }), body: z.object({ rol: z.enum(["dueno", "operador", "lectura"]).optional(), activo: z.boolean().optional() }).strict() } }, async (req) => {
    const a = await exigir(pool, req, "dueno");
    if (req.params.id === a.id) throw new ErrorHttp(400, "propio", "No podés cambiar tu propio rol ni desactivarte.");
    await asegurarOtroDueno(pool, req.params.id, req.body);
    const r = await pool.query("UPDATE tienda.admins SET rol = COALESCE($2, rol), activo = COALESCE($3, activo) WHERE id = $1", [req.params.id, req.body.rol ?? null, req.body.activo ?? null]);
    if (!r.rowCount) throw new ErrorHttp(404, "no_encontrado", "No existe ese usuario.");
    if (req.body.activo === false || req.body.rol) await pool.query("DELETE FROM tienda.admin_sesiones WHERE admin_id = $1", [req.params.id]);
    await auditar(pool, a, "editar_usuario", "admin", req.params.id, req.body, ip(req));
    return { ok: true };
  });
  // Perdió el celular o la contraseña: nueva clave provisoria y doble factor de cero.
  api.post("/v1/admin/usuarios/:id/restablecer", { schema: { params: z.object({ id: Id }) } }, async (req) => {
    const a = await exigir(pool, req, "dueno");
    const clave = claveProvisoria();
    const r = await pool.query(
      "UPDATE tienda.admins SET hash = $2, debe_cambiar_clave = true, totp_activo = false, totp_cifrado = NULL, totp_ultimo = NULL, intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = $1",
      [req.params.id, await hash(clave, ARGON_ADMIN)]);
    if (!r.rowCount) throw new ErrorHttp(404, "no_encontrado", "No existe ese usuario.");
    await pool.query("DELETE FROM tienda.admin_sesiones WHERE admin_id = $1", [req.params.id]);
    await auditar(pool, a, "restablecer_usuario", "admin", req.params.id, null, ip(req));
    return { claveProvisoria: clave };
  });

  api.get("/v1/admin/auditoria", { schema: { querystring: z.object({ entidad: z.string().regex(/^[a-z_]{2,30}$/).optional(), pagina: Pagina }).strict() } }, async (req) => {
    await exigir(pool, req, "dueno");
    const params: unknown[] = [];
    let w = "true";
    if (req.query.entidad) { params.push(req.query.entidad); w = "entidad = $1"; }
    params.push(POR_PAGINA, (req.query.pagina - 1) * POR_PAGINA);
    const { rows } = await pool.query(
      `SELECT id, actor, accion, entidad, entidad_id AS "entidadId", detalle, host(ip) AS ip, creado_en AS "creadoEn" FROM tienda.auditoria
        WHERE ${w} ORDER BY id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return { registros: rows };
  });

  await rutasGuiasAdmin(app, { pool, ip, invalidar });

  // Sincronización con Stocker: pedir un catálogo completo ahora.
  api.post("/v1/admin/sincronizar-catalogo", async (req) => {
    const a = await exigir(pool, req, "operador");
    await deps.colas.stocker("catalogo", {}, `catalogo-manual-${Math.floor(Date.now() / 60_000)}`);
    await auditar(pool, a, "sincronizar_catalogo", "catalogo", null, null, ip(req));
    return { ok: true };
  });
}

/* Siempre tiene que quedar al menos un dueño activo. */
async function asegurarOtroDueno(pool: pg.Pool, id: number, cambio: { rol?: string; activo?: boolean }) {
  const deja = cambio.activo === false || (cambio.rol && cambio.rol !== "dueno");
  if (!deja) return;
  const { rows } = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM tienda.admins WHERE rol = 'dueno' AND activo AND id <> $1", [id]);
  if (rows[0]!.n === 0) throw new ErrorHttp(409, "ultimo_dueno", "Tiene que quedar al menos un dueño activo.");
}

export type { Admin };
