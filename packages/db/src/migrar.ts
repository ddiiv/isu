import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";

/*
 * Migraciones en SQL plano, aplicadas en orden y una sola vez.
 *
 * · Candado de sesión (pg_advisory_lock): si Railway levanta dos réplicas a la
 *   vez, la segunda espera a que termine la primera en vez de aplicar lo
 *   mismo dos veces.
 * · Cada archivo en su transacción: o entra entero o no entra.
 * · Checksum: si alguien edita una migración ya aplicada, se frena con un
 *   error en vez de dejar la base distinta de lo que dice el repo.
 * · Sólo toca el esquema `tienda`. El de Stocker no se lee ni se escribe.
 */

const CANDADO = 824_530_117; // número fijo y propio de la tienda
const DIR_POR_DEFECTO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migraciones");

export interface ResultadoMigracion {
  aplicadas: string[];
  yaEstaban: string[];
}

export async function migrar(pool: pg.Pool, dir = DIR_POR_DEFECTO): Promise<ResultadoMigracion> {
  // `dir` es la carpeta de migraciones del paquete (o la que pasa un test), nunca un dato de un usuario.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const archivos = (await readdir(dir)).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort();
  const cliente = await pool.connect();
  const resultado: ResultadoMigracion = { aplicadas: [], yaEstaban: [] };
  try {
    // Las migraciones pueden tardar más que el statement_timeout de la app.
    await cliente.query("SET statement_timeout = 0");
    await cliente.query("SELECT pg_advisory_lock($1)", [CANDADO]);
    /*
     * Se pregunta antes de crear: CREATE SCHEMA IF NOT EXISTS exige permiso
     * de creación sobre la BASE aunque el esquema ya exista, y el usuario
     * propio de la tienda (infra/sql/rol-tienda.sql) no lo tiene a propósito.
     */
    const { rowCount } = await cliente.query("SELECT 1 FROM pg_namespace WHERE nspname = 'tienda'");
    if (!rowCount) await cliente.query("CREATE SCHEMA tienda");
    await cliente.query(`
      CREATE TABLE IF NOT EXISTS tienda._migraciones (
        nombre      varchar(120) PRIMARY KEY,
        checksum    char(64) NOT NULL,
        aplicada_en timestamptz NOT NULL DEFAULT now()
      )`);
    const { rows } = await cliente.query<{ nombre: string; checksum: string }>(
      "SELECT nombre, checksum FROM tienda._migraciones",
    );
    const hechas = new Map(rows.map((r) => [r.nombre, r.checksum]));

    for (const archivo of archivos) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- nombre validado con /^\d{4}_[a-z0-9_]+\.sql$/
      const sql = await readFile(path.join(dir, archivo), "utf8");
      const suma = createHash("sha256").update(sql).digest("hex");
      const previa = hechas.get(archivo);
      if (previa) {
        if (previa !== suma) {
          throw new Error(
            `La migración ${archivo} cambió después de aplicada. No se editan migraciones: agregá una nueva.`,
          );
        }
        resultado.yaEstaban.push(archivo);
        continue;
      }
      await cliente.query("BEGIN");
      try {
        await cliente.query(sql);
        await cliente.query("INSERT INTO tienda._migraciones (nombre, checksum) VALUES ($1, $2)", [archivo, suma]);
        await cliente.query("COMMIT");
        resultado.aplicadas.push(archivo);
      } catch (err) {
        await cliente.query("ROLLBACK");
        throw new Error(`Falló ${archivo}: ${(err as Error).message}`, { cause: err });
      }
    }
    return resultado;
  } finally {
    await cliente.query("SELECT pg_advisory_unlock($1)", [CANDADO]).catch(() => {});
    cliente.release();
  }
}
