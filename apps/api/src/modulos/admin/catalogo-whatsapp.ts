import type { FastifyInstance } from "fastify";
import type pg from "pg";
import type { Entorno } from "../../entorno.js";
import { ErrorHttp } from "../../lib/errores.js";
import { ipDe } from "../../lib/cliente.js";
import { auditar, exigir } from "./sesion.js";

/*
 * «Actualizar catálogo de WhatsApp» (Productos): le pide a Meta que traiga ya
 * /feed/whatsapp.xml, sin esperar a la carga programada de Commerce Manager
 * (POST /{feed}/uploads con la url). Reemplaza el catálogo como la programada;
 * si el feed contesta 503, Meta no carga nada y queda el anterior.
 * Necesita META_CATALOGO_TOKEN (usuario del sistema con catalog_management) y
 * META_CATALOGO_FEED_ID (el id de la fuente de datos).
 */
const ESPERA_MINUTOS = 10;

export async function rutasCatalogoWhatsapp(app: FastifyInstance, deps: { pool: pg.Pool; env: Entorno }) {
  const { pool, env } = deps;
  const feed = `${env.META_GRAPH_URL.replace(/\/+$/, "")}/${env.META_API_VERSION}/${encodeURIComponent(env.META_CATALOGO_FEED_ID ?? "")}`;
  const meta = async <T>(ruta: string, init: RequestInit = {}) => {
    let r: Response;
    try {
      r = await fetch(`${feed}${ruta}`, { ...init, headers: { authorization: `Bearer ${env.META_CATALOGO_TOKEN}`, ...init.headers }, signal: AbortSignal.timeout(15_000), redirect: "error" });
    } catch {
      throw new ErrorHttp(502, "meta", "Meta no contestó. Probá de nuevo en un rato.");
    }
    const j = await r.json().catch(() => ({})) as T & { error?: { message?: string } };
    if (!r.ok) throw new ErrorHttp(502, "meta", `Meta no lo aceptó: ${String(j.error?.message ?? r.status).slice(0, 200)}`);
    return j;
  };
  const configurado = () => Boolean(env.META_CATALOGO_TOKEN && env.META_CATALOGO_FEED_ID);

  // La última carga que hizo Meta (programada o pedida desde acá).
  app.get("/v1/admin/catalogo-whatsapp", async (req) => {
    await exigir(pool, req);
    if (!configurado()) return { configurado: false, ultima: null };
    const j = await meta<{ data?: Array<{ start_time?: string; end_time?: string }> }>("/uploads?fields=start_time,end_time&limit=1").catch(() => null);
    const u = j?.data?.[0];
    return { configurado: true, ultima: u ? { inicio: u.start_time ?? null, fin: u.end_time ?? null } : null };
  });

  app.post("/v1/admin/catalogo-whatsapp/actualizar", async (req) => {
    const a = await exigir(pool, req, "operador");
    if (!configurado()) throw new ErrorHttp(409, "sin_configurar", "Falta configurar META_CATALOGO_TOKEN y META_CATALOGO_FEED_ID en la API.");
    // Meta procesa una carga por vez: un doble clic o dos personas no la piden dos veces.
    const reciente = await pool.query(
      `SELECT 1 FROM tienda.auditoria WHERE accion = 'actualizar_catalogo_whatsapp' AND creado_en > now() - make_interval(mins => $1) LIMIT 1`, [ESPERA_MINUTOS]);
    if (reciente.rowCount) throw new ErrorHttp(429, "reciente", `Ya se pidió hace menos de ${ESPERA_MINUTOS} minutos: Meta lo está cargando.`);
    const j = await meta<{ id?: string }>("/uploads", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ url: `${env.SITIO_URL.replace(/\/+$/, "")}/feed/whatsapp.xml` }).toString(),
    });
    await auditar(pool, a, "actualizar_catalogo_whatsapp", "catalogo", null, { carga: j.id ?? null }, ipDe(req, env.INTERNO_TOKEN));
    return { ok: true };
  });
}
