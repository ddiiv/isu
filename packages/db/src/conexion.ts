import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as esquema from "./esquema.js";

/*
 * Pool de conexiones a la base COMPARTIDA con Stocker.
 *
 * La tienda y Stocker usan el mismo servidor de Postgres. Para no pelearse
 * por conexiones —Postgres de Railway admite ~100— la tienda usa un pool
 * chico y con techo explícito. Si en un pico hace falta más, se escala con
 * réplicas de la API, no subiendo el pool: cada réplica suma su pool.
 */
export interface OpcionesConexion {
  url: string;
  ssl?: boolean;
  max?: number;
  nombreApp?: string;
}

export function crearPool({ url, ssl = false, max = 10, nombreApp = "isu-tienda" }: OpcionesConexion): pg.Pool {
  const pool = new pg.Pool({
    connectionString: url,
    ssl: ssl ? { rejectUnauthorized: false } : undefined,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Se ve en pg_stat_activity: distingue las conexiones de la tienda de las de Stocker.
    application_name: nombreApp,
    // Ninguna consulta de la tienda puede quedarse colgada y retener
    // bloqueos sobre la base de Stocker.
    statement_timeout: 10_000,
    idle_in_transaction_session_timeout: 15_000,
  });
  pool.on("error", (err) => {
    // Un cliente ocioso que se cayó no tiene que tumbar el proceso.
    console.error("[db] error en conexión ociosa:", err.message);
  });
  return pool;
}

export function crearDb(pool: pg.Pool) {
  return drizzle(pool, { schema: esquema });
}
export type Db = ReturnType<typeof crearDb>;
