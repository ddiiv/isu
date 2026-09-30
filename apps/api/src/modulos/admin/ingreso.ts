import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type pg from "pg";
import type { Redis } from "ioredis";
import { z } from "zod";
import { hash, verify } from "@node-rs/argon2";
import type { Entorno } from "../../entorno.js";
import { ErrorHttp } from "../../lib/errores.js";
import { frenar } from "../../lib/frenos.js";
import { ipDe } from "../../lib/cliente.js";
import { sha256 } from "../../lib/cripto.js";
import { cifrar, descifrar, secretoNuevo, urlOtpauth, verificar } from "../../lib/totp.js";
import { auditar, crearSesionAdmin, exigir, leerAdmin } from "./sesion.js";

/*
 * Ingreso al backoffice: email + contraseña → código del doble factor.
 * Primera vez: se configura el doble factor (QR) y se cambia la contraseña
 * provisoria. Sin doble factor no se entra a ninguna pantalla.
 */
const ARGON = { algorithm: 2 as const, memoryCost: 19_456, timeCost: 2, parallelism: 1 };
let FICTICIO: Promise<string> | null = null;
const ficticio = () => (FICTICIO ??= hash("nadie-tiene-esta-clave", ARGON));
const MAX_FALLIDOS = 5;

interface FilaAdmin { id: number; email: string; nombre: string; hash: string; rol: string; totp_cifrado: string | null; totp_activo: boolean; totp_ultimo: string | null; activo: boolean; debe_cambiar_clave: boolean; bloqueado_hasta: Date | null }

export async function rutasIngresoAdmin(app: FastifyInstance, deps: { pool: pg.Pool; redis: Redis; env: Entorno }) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const ip = (req: FastifyRequest) => ipDe(req, deps.env.INTERNO_TOKEN);
  const agente = (req: FastifyRequest) => (typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null);
  const clave = () => {
    if (!deps.env.ADMIN_CLAVE_CIFRADO) throw new ErrorHttp(503, "sin_configurar", "Falta ADMIN_CLAVE_CIFRADO en la API.");
    return deps.env.ADMIN_CLAVE_CIFRADO;
  };
  const sinCache = { "cache-control": "no-store" };

  api.post("/v1/admin/ingresar", { schema: { body: z.object({ email: z.string().trim().toLowerCase().email().max(150), contrasena: z.string().min(1).max(128) }).strict() } }, async (req, reply) => {
    clave();
    await frenar(deps.redis, "admin-ip", ip(req), 20, 900);
    await frenar(deps.redis, "admin-email", sha256(req.body.email), 10, 900);
    const { rows } = await deps.pool.query<FilaAdmin>("SELECT * FROM tienda.admins WHERE email = $1", [req.body.email]);
    const a = rows[0];
    const mal = () => new ErrorHttp(401, "credenciales", "Email o contraseña incorrectos.");
    if (!a || !a.activo) { await verify(await ficticio(), req.body.contrasena).catch(() => false); throw mal(); }
    if (a.bloqueado_hasta && a.bloqueado_hasta > new Date()) throw new ErrorHttp(423, "bloqueado", "Usuario bloqueado 30 minutos por intentos fallidos.");
    if (!(await verify(a.hash, req.body.contrasena).catch(() => false))) {
      await deps.pool.query(
        `UPDATE tienda.admins SET intentos_fallidos = intentos_fallidos + 1,
           bloqueado_hasta = CASE WHEN intentos_fallidos + 1 >= $2 THEN now() + interval '30 minutes' ELSE bloqueado_hasta END WHERE id = $1`, [a.id, MAX_FALLIDOS]);
      await auditar(deps.pool, a, "ingreso_fallido", "admin", a.id, null, ip(req));
      throw mal();
    }
    await deps.pool.query("UPDATE tienda.admins SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = $1", [a.id]);
    const token = await crearSesionAdmin(deps.pool, a.id, false, ip(req), agente(req));
    reply.headers(sinCache);
    // Siempre falta el segundo paso: el código, o configurar el doble factor si todavía no lo tiene.
    return { token, siguiente: a.totp_activo ? "codigo" : "configurar_2fa" };
  });

  // Primera vez: el QR para la app de autenticación.
  api.post("/v1/admin/2fa/configurar", async (req, reply) => {
    const a = await leerAdmin(deps.pool, req);
    if (!a) throw new ErrorHttp(401, "sin_sesion", "Ingresá al backoffice.");
    if (a.totpActivo) throw new ErrorHttp(409, "ya_activo", "El doble factor ya está activo.");
    const secreto = secretoNuevo();
    await deps.pool.query("UPDATE tienda.admins SET totp_cifrado = $2 WHERE id = $1", [a.id, cifrar(secreto, clave())]);
    reply.headers(sinCache);
    return { secreto, url: urlOtpauth(secreto, a.email) };
  });

  // El código: activa el doble factor (primera vez) o completa el ingreso.
  api.post("/v1/admin/2fa", { schema: { body: z.object({ codigo: z.string().regex(/^\d{6}$/) }).strict() } }, async (req, reply) => {
    const a = await leerAdmin(deps.pool, req);
    if (!a) throw new ErrorHttp(401, "sin_sesion", "Ingresá al backoffice.");
    await frenar(deps.redis, "admin-2fa", String(a.id), 10, 900);
    const { rows } = await deps.pool.query<FilaAdmin>("SELECT * FROM tienda.admins WHERE id = $1", [a.id]);
    const f = rows[0]!;
    if (!f.totp_cifrado) throw new ErrorHttp(409, "sin_2fa", "Primero configurá el doble factor.");
    const paso = verificar(descifrar(f.totp_cifrado, clave()), req.body.codigo);
    // El mismo código (o uno anterior) no sirve dos veces: alguien que lo vio por encima del hombro no entra.
    if (paso === null || (f.totp_ultimo !== null && paso <= Number(f.totp_ultimo))) {
      await auditar(deps.pool, a, "2fa_fallido", "admin", a.id, null, ip(req));
      throw new ErrorHttp(401, "codigo", "Código incorrecto o vencido.");
    }
    await deps.pool.query("UPDATE tienda.admins SET totp_activo = true, totp_ultimo = $2, ultimo_ingreso = now() WHERE id = $1", [a.id, paso]);
    // Sesión nueva ya verificada; la del primer paso se descarta (no se «asciende» un token que ya viajó).
    await deps.pool.query("DELETE FROM tienda.admin_sesiones WHERE id = $1", [a.sesion]);
    const token = await crearSesionAdmin(deps.pool, a.id, true, ip(req), agente(req));
    await auditar(deps.pool, a, f.totp_activo ? "ingreso" : "2fa_activado", "admin", a.id, null, ip(req));
    reply.headers(sinCache);
    return { token, siguiente: f.debe_cambiar_clave ? "cambiar_clave" : "listo" };
  });

  api.post("/v1/admin/clave", { schema: { body: z.object({ actual: z.string().min(1).max(128), nueva: z.string().min(12, "Al menos 12 caracteres").max(128) }).strict() } }, async (req, reply) => {
    const a = await exigir(deps.pool, req, "lectura", { permitirClaveProvisoria: true });
    const { rows } = await deps.pool.query<FilaAdmin>("SELECT hash FROM tienda.admins WHERE id = $1", [a.id]);
    if (!(await verify(rows[0]!.hash, req.body.actual).catch(() => false))) throw new ErrorHttp(400, "clave_actual", "La contraseña actual no es correcta.");
    if (req.body.nueva === req.body.actual) throw new ErrorHttp(400, "misma_clave", "La contraseña nueva tiene que ser distinta.");
    await deps.pool.query("UPDATE tienda.admins SET hash = $2, debe_cambiar_clave = false WHERE id = $1", [a.id, await hash(req.body.nueva, ARGON)]);
    await deps.pool.query("DELETE FROM tienda.admin_sesiones WHERE admin_id = $1 AND id <> $2", [a.id, a.sesion]);
    await auditar(deps.pool, a, "cambio_clave", "admin", a.id, null, ip(req));
    return reply.code(204).send();
  });

  api.post("/v1/admin/salir", async (req, reply) => {
    const a = await leerAdmin(deps.pool, req);
    if (a) await deps.pool.query("DELETE FROM tienda.admin_sesiones WHERE id = $1", [a.sesion]);
    return reply.code(204).send();
  });

  api.get("/v1/admin/yo", async (req, reply) => {
    const a = await exigir(deps.pool, req, "lectura", { permitirClaveProvisoria: true });
    reply.headers(sinCache);
    return { email: a.email, nombre: a.nombre, rol: a.rol, debeCambiarClave: a.debeCambiarClave };
  });
}

export { ARGON as ARGON_ADMIN };
