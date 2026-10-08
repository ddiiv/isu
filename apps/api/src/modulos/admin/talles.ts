import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type pg from "pg";
import { z } from "zod";
import { GuiaTalles, compararTalles, normalizarTalle, ordenarGuia, tallesDeTipo, type TipoGuia } from "@isu/shared";
import { ErrorHttp } from "../../lib/errores.js";
import { ErrorXlsx, escribirXlsx, leerXlsx, MAX_XLSX } from "../../lib/xlsx.js";
import { guiasAHojas, hojasAGuias, type GuiaExcel } from "./guias-excel.js";
import { auditar, exigir } from "./sesion.js";

/*
 * Editor de guías de talles. Una guía se arma una vez ("Remera regular
 * adulto") y se asocia a todos los productos que tienen ese molde. Para
 * asociar, se listan los productos con sus talles y se marca cuáles
 * "coinciden": todos sus talles están en la guía.
 */
const Id = z.coerce.number().int().positive().max(2_147_483_647);
const POR_PAGINA = 50;

interface Deps {
  pool: pg.Pool;
  ip: (req: FastifyRequest) => string;
  invalidar: (slugs: string[]) => Promise<void>;
}

/** ¿Todos los talles del producto están en la guía? (sin talles = no aplica) */
export function coincide(tipo: TipoGuia, tallesGuia: string[], tallesProducto: Array<string | null>): boolean {
  const reales = tallesProducto.filter((t): t is string => !!t && !!t.trim()).map(normalizarTalle);
  if (!reales.length) return false;
  const escala = new Set(tallesDeTipo(tipo));
  const guia = new Set(tallesGuia.map(normalizarTalle));
  // "otro" (talles propios): alcanza con que estén en la guía.
  return reales.every((t) => (tipo === "otro" || escala.has(t)) && guia.has(t));
}

export async function rutasGuiasAdmin(app: FastifyInstance, { pool, ip, invalidar }: Deps) {
  const api = app.withTypeProvider<ZodTypeProvider>();

  const slugsConGuia = async (id: number) =>
    (await pool.query<{ slug: string }>("SELECT slug FROM tienda.productos WHERE guia_talles_id = $1", [id])).rows.map((r) => r.slug);
  const leer = async (id: number) => {
    const { rows } = await pool.query<{ id: number; slug: string; nombre: string; tipo: TipoGuia; medidas: string[]; filas: Array<{ talle: string; valores: unknown[] }>; nota: string | null }>(
      "SELECT id, slug, nombre, tipo, medidas, filas, nota FROM tienda.guias_talles WHERE id = $1", [id]);
    if (!rows[0]) throw new ErrorHttp(404, "no_encontrado", "No existe esa guía.");
    return rows[0];
  };
  const errorNombre = (e: unknown) =>
    (e as { code?: string }).code === "23505" ? new ErrorHttp(409, "nombre", "Ya hay una guía con ese nombre.") : e;

  api.get("/v1/admin/guias-talles", async (req) => {
    await exigir(pool, req);
    const { rows } = await pool.query(
      `SELECT g.id, g.slug, g.nombre, g.tipo, g.medidas, jsonb_array_length(g.filas) AS talles, g.actualizado_en AS "actualizadoEn", g.actualizado_por AS "actualizadoPor",
              (SELECT count(*)::int FROM tienda.productos p WHERE p.guia_talles_id = g.id) AS productos
         FROM tienda.guias_talles g ORDER BY g.tipo, lower(g.nombre)`);
    return { guias: rows };
  });

  // El backoffice abre cada guía por su nombre en la dirección (/guias-talles/remera-regular-adulto), no por el id.
  api.get("/v1/admin/guias-talles/s/:slug", { schema: { params: z.object({ slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(80) }) } }, async (req) => {
    await exigir(pool, req);
    const r = await pool.query<{ id: number }>("SELECT id FROM tienda.guias_talles WHERE slug = $1", [req.params.slug]);
    if (!r.rows[0]) throw new ErrorHttp(404, "no_encontrado", "No existe esa guía.");
    return detalle(r.rows[0].id);
  });
  api.get("/v1/admin/guias-talles/:id", { schema: { params: z.object({ id: Id }) } }, async (req) => {
    await exigir(pool, req);
    return detalle(req.params.id);
  });
  async function detalle(id: number) {
    const leida = await leer(id);
    const g = { ...ordenarGuia(leida), id: leida.id, slug: leida.slug };
    const { rows } = await pool.query(
      `SELECT p.id, p.nombre, p.stocker_padre AS sku, p.slug, p.visible,
              COALESCE((SELECT array_agg(DISTINCT v.talle) FROM tienda.variantes v WHERE v.producto_id = p.id AND v.activo AND v.talle IS NOT NULL), '{}') AS talles
         FROM tienda.productos p WHERE p.guia_talles_id = $1 ORDER BY p.nombre`, [g.id]);
    const tallesGuia = g.filas.map((f) => f.talle);
    return {
      guia: g,
      productos: rows.map((p) => ({ ...p, talles: [...p.talles].sort(compararTalles), coincide: coincide(g.tipo, tallesGuia, p.talles) })),
    };
  }

  /*
   * Excel (etapa 10): exportar todas las guías (una hoja por guía) e
   * importar un archivo igual. Importar crea las guías nuevas y actualiza las
   * que ya existen con ese nombre (sus productos siguen asociados). Con
   * `?vista=1` sólo dice qué haría, sin guardar nada.
   */
  api.get("/v1/admin/guias-talles/excel", async (req, reply) => {
    const a = await exigir(pool, req);
    const { rows } = await pool.query<GuiaExcel>("SELECT nombre, tipo, medidas, filas, nota FROM tienda.guias_talles ORDER BY tipo, lower(nombre)");
    const archivo = escribirXlsx(rows.length ? guiasAHojas(rows) : [{ nombre: "Ejemplo", filas: [["Medida", "S", "M", "L"], ["Ancho hombro", 44.5, 46.5, 48], ["Largo prenda", 71, 74, "74,5"]] }]);
    await auditar(pool, a, "exportar_guias_talles", "guia_talles", null, { guias: rows.length }, ip(req));
    return reply
      .header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .header("content-disposition", `attachment; filename="guias-de-talles-${new Date().toISOString().slice(0, 10)}.xlsx"`)
      .send(Buffer.from(archivo));
  });
  await app.register(async (sub) => {
    const TIPOS = ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/octet-stream"];
    sub.addContentTypeParser(TIPOS, { parseAs: "buffer", bodyLimit: MAX_XLSX }, (_r, cuerpo, hecho) => hecho(null, cuerpo));
    sub.withTypeProvider<ZodTypeProvider>().post("/v1/admin/guias-talles/excel", {
      bodyLimit: MAX_XLSX,
      schema: { querystring: z.object({ vista: z.enum(["0", "1"]).default("0") }).strict() },
    }, async (req) => {
      const a = await exigir(pool, req, "operador");
      if (!Buffer.isBuffer(req.body)) throw new ErrorHttp(415, "tipo", "Subí un archivo de Excel (.xlsx).");
      let hojas;
      try { hojas = leerXlsx(new Uint8Array(req.body)); } catch (e) {
        if (e instanceof ErrorXlsx) throw new ErrorHttp(400, "excel", e.message);
        throw e;
      }
      const { guias, errores } = hojasAGuias(hojas);
      if (!guias.length && !errores.length) throw new ErrorHttp(400, "excel", "El archivo no tiene ninguna guía (una hoja por guía: Medida | S | M | L…).");
      const existentes = new Map((await pool.query<{ id: number; nombre: string }>("SELECT id, nombre FROM tienda.guias_talles")).rows.map((r) => [r.nombre.toLowerCase(), r.id]));
      const resumen = guias.map((g) => ({ nombre: g.nombre, tipo: g.tipo, talles: g.filas.map((f) => f.talle), medidas: g.medidas.length, accion: existentes.has(g.nombre.toLowerCase()) ? "actualizar" as const : "crear" as const }));
      if (req.query.vista === "1") return { vista: true, guias: resumen, errores };
      const cambiadas: number[] = [];
      const cli = await pool.connect();
      try {
        await cli.query("BEGIN");
        for (const g0 of guias) {
          const g = ordenarGuia(g0);
          const id = existentes.get(g.nombre.toLowerCase());
          const datos = [g.nombre, g.tipo, JSON.stringify(g.medidas), JSON.stringify(g.filas), g.nota, a.email];
          if (id) {
            await cli.query("UPDATE tienda.guias_talles SET nombre=$2, tipo=$3, medidas=$4, filas=$5, nota=COALESCE(nota, $6), actualizado_por=$7, actualizado_en=now() WHERE id = $1", [id, ...datos]);
            cambiadas.push(id);
          } else {
            await cli.query("INSERT INTO tienda.guias_talles (nombre, tipo, medidas, filas, nota, actualizado_por) VALUES ($1,$2,$3,$4,$5,$6)", datos);
          }
        }
        await auditar(cli, a, "importar_guias_talles", "guia_talles", null, { creadas: resumen.filter((r) => r.accion === "crear").length, actualizadas: cambiadas.length, conErrores: errores.length }, ip(req));
        await cli.query("COMMIT");
      } catch (e) { await cli.query("ROLLBACK").catch(() => {}); throw e; } finally { cli.release(); }
      // Las fichas de los productos de las guías que cambiaron.
      for (const id of cambiadas) await invalidar(await slugsConGuia(id));
      return { vista: false, guias: resumen, errores };
    });
  });

  api.post("/v1/admin/guias-talles", { schema: { body: GuiaTalles } }, async (req, reply) => {
    const a = await exigir(pool, req, "operador");
    const g = ordenarGuia(req.body);
    try {
      const { rows } = await pool.query<{ id: number; slug: string }>(
        "INSERT INTO tienda.guias_talles (nombre, tipo, medidas, filas, nota, actualizado_por) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, slug",
        [g.nombre, g.tipo, JSON.stringify(g.medidas), JSON.stringify(g.filas), g.nota, a.email]);
      await auditar(pool, a, "crear_guia_talles", "guia_talles", rows[0]!.id, { nombre: g.nombre, tipo: g.tipo }, ip(req));
      return reply.code(201).send({ id: rows[0]!.id, slug: rows[0]!.slug });
    } catch (e) { throw errorNombre(e); }
  });

  api.put("/v1/admin/guias-talles/:id", { schema: { params: z.object({ id: Id }), body: GuiaTalles } }, async (req) => {
    const a = await exigir(pool, req, "operador");
    const g = ordenarGuia(req.body);
    let slug: string;
    try {
      const r = await pool.query<{ slug: string }>(
        "UPDATE tienda.guias_talles SET nombre=$2, tipo=$3, medidas=$4, filas=$5, nota=$6, actualizado_por=$7, actualizado_en=now() WHERE id = $1 RETURNING slug",
        [req.params.id, g.nombre, g.tipo, JSON.stringify(g.medidas), JSON.stringify(g.filas), g.nota, a.email]);
      if (!r.rows[0]) throw new ErrorHttp(404, "no_encontrado", "No existe esa guía.");
      slug = r.rows[0].slug;
    } catch (e) { throw errorNombre(e); }
    await auditar(pool, a, "editar_guia_talles", "guia_talles", req.params.id, g, ip(req));
    await invalidar(await slugsConGuia(req.params.id));
    // Con otro nombre cambia la dirección en el backoffice.
    return { ok: true, slug };
  });

  api.delete("/v1/admin/guias-talles/:id", { schema: { params: z.object({ id: Id }) } }, async (req) => {
    const a = await exigir(pool, req, "operador");
    const slugs = await slugsConGuia(req.params.id);
    const r = await pool.query("DELETE FROM tienda.guias_talles WHERE id = $1", [req.params.id]);
    if (!r.rowCount) throw new ErrorHttp(404, "no_encontrado", "No existe esa guía.");
    await auditar(pool, a, "borrar_guia_talles", "guia_talles", req.params.id, { productos: slugs.length }, ip(req));
    await invalidar(slugs);
    return { ok: true, productosSinGuia: slugs.length };
  });

  /*
   * Productos para asociar: con sus talles, si coinciden con la guía y qué
   * guía tienen hoy. `solo=coinciden` filtra los que encajan (lo habitual).
   */
  api.get("/v1/admin/guias-talles/:id/candidatos", {
    schema: {
      params: z.object({ id: Id }),
      querystring: z.object({
        q: z.string().trim().max(80).optional(),
        categoria: Id.optional(),
        solo: z.enum(["coinciden", "todos", "sin_guia"]).default("coinciden"),
        pagina: z.coerce.number().int().min(1).max(10_000).default(1),
      }).strict(),
    },
  }, async (req) => {
    await exigir(pool, req);
    const g = ordenarGuia(await leer(req.params.id));
    const { q, categoria, solo, pagina } = req.query;
    const w = ["p.en_stocker"];
    const params: unknown[] = [];
    if (q) { params.push(`%${q.replace(/[%_\\]/g, "\\$&")}%`); w.push(`(p.nombre ILIKE $${params.length} OR p.stocker_padre ILIKE $${params.length})`); }
    if (categoria) { params.push(categoria); w.push(`EXISTS (SELECT 1 FROM tienda.producto_categorias pc JOIN tienda.categorias c ON c.id = pc.categoria_id WHERE pc.producto_id = p.id AND (c.id = $${params.length} OR c.padre_id = $${params.length}))`); }
    if (solo === "sin_guia") w.push("p.guia_talles_id IS NULL");
    // Se filtra por coincidencia en memoria (normalizar talles en SQL sería repetir la regla): se trae hasta 3000.
    const { rows } = await pool.query<{ id: number; nombre: string; sku: string; visible: boolean; guia_id: number | null; guia: string | null; talles: string[]; foto: string | null }>(
      `SELECT p.id, p.nombre, p.stocker_padre AS sku, p.visible, p.guia_talles_id AS guia_id, g.nombre AS guia,
              COALESCE((SELECT array_agg(DISTINCT v.talle) FROM tienda.variantes v WHERE v.producto_id = p.id AND v.activo AND v.talle IS NOT NULL), '{}') AS talles,
              (SELECT f.clave FROM tienda.fotos f WHERE f.producto_id = p.id ORDER BY (f.tipo = 'exhibicion') DESC, f.orden, f.id LIMIT 1) AS foto
         FROM tienda.productos p LEFT JOIN tienda.guias_talles g ON g.id = p.guia_talles_id
        WHERE ${w.join(" AND ")} ORDER BY p.nombre LIMIT 3000`, params);
    const tallesGuia = g.filas.map((f) => f.talle);
    const todos = rows.map((p) => ({
      id: p.id, nombre: p.nombre, sku: p.sku, visible: p.visible, foto: p.foto,
      talles: [...p.talles].sort(compararTalles),
      coincide: coincide(g.tipo, tallesGuia, p.talles),
      guiaActual: p.guia_id ? { id: p.guia_id, nombre: p.guia } : null,
    }));
    const lista = solo === "coinciden" ? todos.filter((p) => p.coincide) : todos;
    return { productos: lista.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA), total: lista.length, porPagina: POR_PAGINA };
  });

  api.post("/v1/admin/guias-talles/:id/productos", {
    schema: {
      params: z.object({ id: Id }),
      body: z.object({ agregar: z.array(Id).max(3000).default([]), quitar: z.array(Id).max(3000).default([]) }).strict()
        .refine((b) => b.agregar.length + b.quitar.length > 0, "No hay cambios"),
    },
  }, async (req) => {
    const a = await exigir(pool, req, "operador");
    await leer(req.params.id);
    const cli = await pool.connect();
    let slugs: string[];
    try {
      await cli.query("BEGIN");
      const ag = await cli.query<{ slug: string }>(
        "UPDATE tienda.productos SET guia_talles_id = $1, actualizado_en = now() WHERE id = ANY($2::int[]) RETURNING slug", [req.params.id, req.body.agregar]);
      const qu = await cli.query<{ slug: string }>(
        "UPDATE tienda.productos SET guia_talles_id = NULL, actualizado_en = now() WHERE id = ANY($2::int[]) AND guia_talles_id = $1 RETURNING slug", [req.params.id, req.body.quitar]);
      slugs = [...ag.rows, ...qu.rows].map((r) => r.slug);
      await auditar(cli, a, "asociar_guia_talles", "guia_talles", req.params.id, { agregados: ag.rowCount, quitados: qu.rowCount }, ip(req));
      await cli.query("COMMIT");
    } catch (e) { await cli.query("ROLLBACK").catch(() => {}); throw e; } finally { cli.release(); }
    await invalidar(slugs);
    return { ok: true, cambiados: slugs.length };
  });
}
