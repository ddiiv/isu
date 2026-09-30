import type pg from "pg";
import { sha256, tokenNuevo } from "./cripto.js";

/*
 * Sesiones de clientes.
 *
 * El token viaja en una cookie httpOnly que pone el servidor de la tienda; la
 * API recibe el token en `x-isu-sesion` y guarda sólo su SHA-256. Se renueva
 * sola con el uso (hasta SESION_DIAS sin entrar) y se corta al cambiar la
 * contraseña.
 */
export interface Sesion { id: string; clienteId: number; email: string; nombre: string }

export async function crearSesion(pool: pg.Pool | pg.PoolClient, clienteId: number, dias: number, ip: string | null, agente: string | null) {
  const token = tokenNuevo();
  await pool.query(
    "INSERT INTO tienda.sesiones (id, cliente_id, expira_en, ip, agente) VALUES ($1, $2, now() + make_interval(days => $3), $4, $5)",
    [sha256(token), clienteId, dias, ip, agente?.slice(0, 200) ?? null],
  );
  return token;
}

const TOKEN = /^[A-Za-z0-9_-]{40,60}$/;

export async function leerSesion(pool: pg.Pool, token: string | undefined, dias: number): Promise<Sesion | null> {
  if (!token || !TOKEN.test(token)) return null;
  const id = sha256(token);
  const { rows } = await pool.query<{ cliente_id: number; email: string; nombre: string; renovar: boolean }>(
    `SELECT s.cliente_id, c.email, c.nombre, s.visto_en < now() - interval '1 hour' AS renovar
       FROM tienda.sesiones s JOIN tienda.clientes c ON c.id = s.cliente_id
      WHERE s.id = $1 AND s.expira_en > now()`,
    [id],
  );
  const r = rows[0];
  if (!r) return null;
  if (r.renovar) {
    await pool.query("UPDATE tienda.sesiones SET visto_en = now(), expira_en = now() + make_interval(days => $2) WHERE id = $1", [id, dias]).catch(() => {});
  }
  return { id, clienteId: r.cliente_id, email: r.email, nombre: r.nombre };
}

export const cerrarSesion = (pool: pg.Pool, id: string) => pool.query("DELETE FROM tienda.sesiones WHERE id = $1", [id]);
export const cerrarTodas = (pool: pg.Pool | pg.PoolClient, clienteId: number, salvo: string | null = null) =>
  pool.query("DELETE FROM tienda.sesiones WHERE cliente_id = $1 AND id IS DISTINCT FROM $2", [clienteId, salvo]);
