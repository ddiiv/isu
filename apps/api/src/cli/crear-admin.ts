import { randomBytes } from "node:crypto";
import { hash } from "@node-rs/argon2";
import { crearPool, migrar } from "@isu/db";
import { ARGON_ADMIN } from "../modulos/admin/ingreso.js";

/*
 * Primer usuario del backoffice (los demás los crea el dueño desde la pantalla):
 *
 *   pnpm admin:crear dueno@isuwaya.com "Nombre Apellido" [dueno|operador|lectura]
 *   (sin pnpm, ya compilado: node --env-file=.env apps/api/dist/cli/crear-admin.js …)
 *
 * Imprime una contraseña provisoria, UNA vez. Al entrar pide configurar el
 * doble factor y cambiarla. Si el email ya existe, le restablece la
 * contraseña y el doble factor (sirve si el único dueño perdió el celular).
 */
const [email, nombre, rol = "dueno"] = process.argv.slice(2);
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !nombre || !["dueno", "operador", "lectura"].includes(rol)) {
  console.error('Uso: pnpm admin:crear <email> "<nombre>" [dueno|operador|lectura]');
  process.exit(2);
}
if (!process.env.DATABASE_URL) { console.error("Falta DATABASE_URL"); process.exit(2); }

const pool = crearPool({ url: process.env.DATABASE_URL, max: 1 });
pool.on("error", () => {});
try {
  await pool.query("SELECT 1").catch((e: Error & { code?: string }) => {
    console.error(`No me pude conectar a la base (${e.code ?? e.message}). ¿Está levantado Postgres y es correcta DATABASE_URL en el .env?`);
    console.error("En local: docker compose -f infra/docker-compose.yml up -d");
    process.exit(1);
  });
  await migrar(pool);
  const clave = randomBytes(12).toString("base64url");
  const h = await hash(clave, ARGON_ADMIN);
  const { rows } = await pool.query<{ nuevo: boolean }>(
    `INSERT INTO tienda.admins (email, nombre, hash, rol) VALUES (lower($1), $2, $3, $4)
     ON CONFLICT (email) DO UPDATE SET hash = EXCLUDED.hash, debe_cambiar_clave = true, totp_activo = false, totp_cifrado = NULL,
       totp_ultimo = NULL, intentos_fallidos = 0, bloqueado_hasta = NULL, activo = true
     RETURNING (xmax = 0) AS nuevo`, [email, nombre, h, rol]);
  await pool.query("DELETE FROM tienda.admin_sesiones WHERE admin_id = (SELECT id FROM tienda.admins WHERE email = lower($1))", [email]);
  await pool.query("INSERT INTO tienda.auditoria (actor, accion, entidad, entidad_id) VALUES ('consola', $1, 'admin', lower($2))", [rows[0]!.nuevo ? "crear_usuario" : "restablecer_usuario", email]);
  console.warn(`${rows[0]!.nuevo ? "Usuario creado" : "Usuario restablecido"}: ${email.toLowerCase()} (${rol})`);
  console.warn(`Contraseña provisoria: ${clave}`);
  console.warn("Al entrar se pide configurar el doble factor y cambiar la contraseña.");
} finally {
  await pool.end();
}
