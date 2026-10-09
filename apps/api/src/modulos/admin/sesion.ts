import type { FastifyRequest } from "fastify";
import type pg from "pg";
import type { Redis } from "ioredis";
import { ErrorHttp } from "../../lib/errores.js";
import { sha256, tokenNuevo } from "../../lib/cripto.js";

/*
 * Sesiones del backoffice.
 *
 *   · 12 horas como máximo y 30 minutos sin uso: una compu del local que
 *     queda abierta no sigue logueada toda la noche.
 *   · Dos pasos: la sesión nace sin verificar y sólo sirve para completar el
 *     doble factor. Hasta entonces, ninguna otra ruta la acepta.
 *   · Con la contraseña provisoria (usuario recién creado o reseteado) sólo
 *     se puede cambiar la contraseña.
 */
export type Rol = "dueno" | "operador" | "lectura";
const NIVEL: Record<Rol, number> = { lectura: 1, operador: 2, dueno: 3 };
export const HORAS_MAX = 12;
export const MINUTOS_INACTIVO = 30;

export interface Admin { id: number; email: string; nombre: string; rol: Rol; sesion: string; totpActivo: boolean; debeCambiarClave: boolean; verificada: boolean }

export async function crearSesionAdmin(db: pg.Pool | pg.PoolClient, adminId: number, verificada: boolean, ip: string, agente: string | null) {
  const token = tokenNuevo();
  await db.query(
    `INSERT INTO tienda.admin_sesiones (id, admin_id, verificada, expira_en, ip, agente)
     VALUES ($1, $2, $3, now() + make_interval(hours => $4), $5, $6)`,
    [sha256(token), adminId, verificada, HORAS_MAX, ip, agente?.slice(0, 200) ?? null],
  );
  return token;
}

const TOKEN = /^[A-Za-z0-9_-]{40,60}$/;

export async function leerAdmin(pool: pg.Pool, req: FastifyRequest): Promise<Admin | null> {
  const h = req.headers["x-isu-admin"];
  if (typeof h !== "string" || !TOKEN.test(h)) return null;
  const id = sha256(h);
  const { rows } = await pool.query<{ admin_id: number; email: string; nombre: string; rol: Rol; verificada: boolean; totp_activo: boolean; debe_cambiar_clave: boolean }>(
    `UPDATE tienda.admin_sesiones s SET visto_en = now()
       FROM tienda.admins a
      WHERE s.id = $1 AND a.id = s.admin_id AND a.activo
        AND s.expira_en > now() AND s.visto_en > now() - make_interval(mins => $2)
      RETURNING s.admin_id, a.email, a.nombre, a.rol, s.verificada, a.totp_activo, a.debe_cambiar_clave`,
    [id, MINUTOS_INACTIVO],
  );
  const r = rows[0];
  if (!r) return null;
  return { id: r.admin_id, email: r.email, nombre: r.nombre, rol: r.rol, sesion: id, totpActivo: r.totp_activo, debeCambiarClave: r.debe_cambiar_clave, verificada: r.verificada };
}

/** Exige sesión completa (con doble factor) y un rol mínimo. */
export async function exigir(pool: pg.Pool, req: FastifyRequest, rol: Rol = "lectura", opciones: { permitirClaveProvisoria?: boolean } = {}): Promise<Admin> {
  const a = await leerAdmin(pool, req);
  if (!a || !a.verificada) throw new ErrorHttp(401, "sin_sesion", "Ingresá al backoffice.");
  if (a.debeCambiarClave && !opciones.permitirClaveProvisoria) throw new ErrorHttp(403, "cambiar_clave", "Antes de seguir, cambiá la contraseña provisoria.");
  if (NIVEL[a.rol] < NIVEL[rol]) throw new ErrorHttp(403, "sin_permiso", "No tenés permiso para esto.");
  return a;
}

/** Deja constancia de un cambio. La tabla no se puede editar ni borrar. */
/**
 * Datos de clientes (etapa 15): sólo los ve el cliente (su sesión o el enlace
 * de su pedido) o alguien del backoffice identificado (usuario, contraseña y
 * doble factor). Cada vez que alguien del backoffice los abre queda en
 * Auditoría quién, qué y desde dónde: uno por persona, dato y hora (recargar
 * la página no llena la auditoría).
 */
export async function registrarAcceso(db: pg.Pool, redis: Redis, a: Pick<Admin, "id" | "email">, que: string, id: string | number | null, ip: string, detalle: unknown = null) {
  const nuevo = await redis.set(`isu:acceso:${a.id}:${que}:${id ?? "-"}`, "1", "EX", 3600, "NX").catch(() => "OK");
  // En Auditoría, todos juntos bajo «datos cliente» (para ver de un vistazo quién los miró).
  if (nuevo === "OK") await auditar(db, a, "ver_datos_cliente", "datos_cliente", `${que}${id === null ? "" : ` ${id}`}`, detalle, ip);
}

export async function auditar(db: pg.Pool | pg.PoolClient, a: Pick<Admin, "email">, accion: string, entidad: string, entidadId: string | number | null, detalle: unknown, ip: string) {
  await db.query(
    "INSERT INTO tienda.auditoria (actor, accion, entidad, entidad_id, detalle, ip) VALUES ($1, $2, $3, $4, $5, $6)",
    [a.email, accion.slice(0, 60), entidad.slice(0, 60), entidadId === null ? null : String(entidadId).slice(0, 60), detalle === undefined ? null : JSON.stringify(detalle), ip],
  );
}
