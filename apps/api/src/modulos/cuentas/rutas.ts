import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type pg from "pg";
import type { Redis } from "ioredis";
import { z } from "zod";
import { hash, verify } from "@node-rs/argon2";
import { ClientePublico, Contrasena, DatosCuenta, Email, Ingreso, Registro } from "@isu/shared";
import type { Entorno } from "../../entorno.js";
import type { Colas } from "../../lib/colas.js";
import { ErrorHttp, noAutorizado } from "../../lib/errores.js";
import { frenar } from "../../lib/frenos.js";
import { ipDe } from "../../lib/cliente.js";
import { sha256, tokenNuevo } from "../../lib/cripto.js";
import { cerrarSesion, cerrarTodas, crearSesion, leerSesion, type Sesion } from "../../lib/sesiones.js";

/*
 * Cuentas de clientes.
 *
 *   · Contraseñas con argon2id (parámetros de OWASP), nunca en el log.
 *   · Mismo mensaje y mismo tiempo para "no existe ese email" y "contraseña
 *     equivocada": no se le dice a nadie qué emails tienen cuenta.
 *   · 10 intentos fallidos seguidos → cuenta bloqueada 15 minutos. Además,
 *     freno por IP y por email en Redis.
 *   · Quien compró sin registrarse ya existe como cliente pero sin
 *     contraseña: para ponerle una tiene que demostrar que el email es suyo
 *     (le llega un enlace). Si no, cualquiera vería sus pedidos.
 */
// algorithm 2 = Argon2id (el enum de la librería es "const enum" y no se puede importar con verbatimModuleSyntax).
const ARGON = { algorithm: 2 as const, memoryCost: 19_456, timeCost: 2, parallelism: 1 };
const MAX_FALLIDOS = 10;
// Para que "email inexistente" tarde lo mismo que "contraseña equivocada".
let HASH_FICTICIO: Promise<string> | null = null;
const ficticio = () => (HASH_FICTICIO ??= hash("contraseña-que-nadie-tiene", ARGON));

interface FilaCliente {
  id: number; email: string; hash: string | null; nombre: string; apellido: string | null; telefono: string | null;
  dni: string | null; acepta_novedades: boolean; bloqueado_hasta: Date | null; intentos_fallidos: number;
}
const publico = (c: FilaCliente): ClientePublico => ({
  email: c.email, nombre: c.nombre, apellido: c.apellido, telefono: c.telefono, dni: c.dni, aceptaNovedades: c.acepta_novedades,
});
const Respuesta = z.object({ cliente: ClientePublico, token: z.string() });

export interface DepsCuentas { pool: pg.Pool; redis: Redis; env: Entorno; colas: Colas }

export async function sesionDe(req: FastifyRequest, deps: { pool: pg.Pool; env: Entorno }): Promise<Sesion | null> {
  const h = req.headers["x-isu-sesion"];
  return leerSesion(deps.pool, typeof h === "string" ? h : undefined, deps.env.SESION_DIAS);
}

export async function rutasCuentas(app: FastifyInstance, deps: DepsCuentas) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const ip = (req: FastifyRequest) => ipDe(req, deps.env.INTERNO_TOKEN);
  const agente = (req: FastifyRequest) => (typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null);
  const noCache = { "cache-control": "no-store" };

  api.post("/v1/cuenta/registro", { schema: { body: Registro, response: { 201: Respuesta } } }, async (req, reply) => {
    await frenar(deps.redis, "registro", ip(req), 5, 3600);
    const b = req.body;
    const existente = await deps.pool.query<FilaCliente>("SELECT * FROM tienda.clientes WHERE email = $1", [b.email]);
    const e = existente.rows[0];
    if (e?.hash) throw new ErrorHttp(409, "email_registrado", "Ya hay una cuenta con ese email. Ingresá o pedí una contraseña nueva.");
    if (e) {
      // Compró sin registrarse: que demuestre que el email es suyo.
      await enviarRestablecer(deps, e.id, e.email, e.nombre, "crear");
      throw new ErrorHttp(409, "confirmar_email", "Ya compraste con este email. Te mandamos un enlace para que crees tu contraseña.");
    }
    const h = await hash(b.contrasena, ARGON);
    const { rows } = await deps.pool.query<FilaCliente>(
      `INSERT INTO tienda.clientes (email, hash, nombre, apellido, acepta_novedades) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO NOTHING RETURNING *`,
      [b.email, h, b.nombre, b.apellido, b.aceptaNovedades],
    );
    const c = rows[0];
    if (!c) throw new ErrorHttp(409, "email_registrado", "Ya hay una cuenta con ese email. Ingresá o pedí una contraseña nueva.");
    const token = await crearSesion(deps.pool, c.id, deps.env.SESION_DIAS, ip(req), agente(req));
    await deps.colas.email("bienvenida", c.email, { nombre: c.nombre });
    await deps.colas.stocker("cliente", { email: c.email, nombre: c.nombre, apellido: c.apellido }, `cliente-${c.id}-alta`);
    reply.code(201).headers(noCache);
    return { cliente: publico(c), token };
  });

  api.post("/v1/cuenta/ingresar", { schema: { body: Ingreso, response: { 200: Respuesta } } }, async (req, reply) => {
    const { email, contrasena } = req.body;
    await frenar(deps.redis, "ingresar-ip", ip(req), 30, 900);
    await frenar(deps.redis, "ingresar-email", sha256(email), 15, 900);
    const { rows } = await deps.pool.query<FilaCliente>("SELECT * FROM tienda.clientes WHERE email = $1", [email]);
    const c = rows[0];
    const mal = () => new ErrorHttp(401, "credenciales", "Email o contraseña incorrectos.");
    if (!c || !c.hash) { await verify(await ficticio(), contrasena).catch(() => false); throw mal(); }
    if (c.bloqueado_hasta && c.bloqueado_hasta > new Date()) {
      throw new ErrorHttp(423, "bloqueada", "Por seguridad, la cuenta quedó bloqueada unos minutos por demasiados intentos. Probá más tarde o pedí una contraseña nueva.");
    }
    const ok = await verify(c.hash, contrasena).catch(() => false);
    if (!ok) {
      await deps.pool.query(
        `UPDATE tienda.clientes SET intentos_fallidos = intentos_fallidos + 1,
           bloqueado_hasta = CASE WHEN intentos_fallidos + 1 >= $2 THEN now() + interval '15 minutes' ELSE bloqueado_hasta END
         WHERE id = $1`, [c.id, MAX_FALLIDOS]);
      throw mal();
    }
    await deps.pool.query("UPDATE tienda.clientes SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = $1", [c.id]);
    const token = await crearSesion(deps.pool, c.id, deps.env.SESION_DIAS, ip(req), agente(req));
    reply.headers(noCache);
    return { cliente: publico(c), token };
  });

  api.post("/v1/cuenta/salir", async (req, reply) => {
    const s = await sesionDe(req, deps);
    if (s) await cerrarSesion(deps.pool, s.id);
    return reply.code(204).send();
  });

  api.get("/v1/cuenta", { schema: { response: { 200: z.object({ cliente: ClientePublico, pedidos: z.array(z.object({ numero: z.string(), estado: z.string(), total: z.number().int(), creadoEn: z.string(), articulos: z.number().int() })) }) } } }, async (req, reply) => {
    const s = await sesionDe(req, deps);
    if (!s) throw noAutorizado();
    const [c, p] = await Promise.all([
      deps.pool.query<FilaCliente>("SELECT * FROM tienda.clientes WHERE id = $1", [s.clienteId]),
      deps.pool.query<{ numero: string; estado: string; total: number; creado_en: Date; articulos: number }>(
        `SELECT p.numero, p.estado, p.total, p.creado_en, COALESCE(sum(i.cantidad), 0)::int AS articulos
           FROM tienda.pedidos p LEFT JOIN tienda.pedido_items i ON i.pedido_id = p.id
          WHERE p.cliente_id = $1 AND p.estado NOT IN ('reservando', 'error_reserva')
          GROUP BY p.id ORDER BY p.creado_en DESC LIMIT 50`, [s.clienteId]),
    ]);
    reply.headers(noCache);
    return { cliente: publico(c.rows[0]!), pedidos: p.rows.map((r) => ({ numero: r.numero, estado: r.estado, total: r.total, creadoEn: r.creado_en.toISOString(), articulos: r.articulos })) };
  });

  api.patch("/v1/cuenta", { schema: { body: DatosCuenta, response: { 200: z.object({ cliente: ClientePublico }) } } }, async (req, reply) => {
    const s = await sesionDe(req, deps);
    if (!s) throw noAutorizado();
    const b = req.body;
    const { rows } = await deps.pool.query<FilaCliente>(
      `UPDATE tienda.clientes SET nombre = $2, apellido = $3, telefono = COALESCE(NULLIF($4, ''), telefono),
          dni = COALESCE(NULLIF($5, ''), dni), acepta_novedades = COALESCE($6, acepta_novedades), actualizado_en = now()
        WHERE id = $1 RETURNING *`,
      [s.clienteId, b.nombre, b.apellido, b.telefono ?? null, b.dni ?? null, b.aceptaNovedades ?? null],
    );
    const c = rows[0]!;
    await deps.colas.stocker("cliente", { email: c.email, nombre: c.nombre, apellido: c.apellido, telefono: c.telefono, dni: c.dni });
    reply.headers(noCache);
    return { cliente: publico(c) };
  });

  api.post("/v1/cuenta/contrasena", { schema: { body: z.object({ actual: z.string().min(1).max(128), nueva: Contrasena }).strict() } }, async (req, reply) => {
    const s = await sesionDe(req, deps);
    if (!s) throw noAutorizado();
    await frenar(deps.redis, "contrasena", String(s.clienteId), 10, 900);
    const { rows } = await deps.pool.query<FilaCliente>("SELECT * FROM tienda.clientes WHERE id = $1", [s.clienteId]);
    if (!rows[0]?.hash || !(await verify(rows[0].hash, req.body.actual).catch(() => false))) {
      throw new ErrorHttp(400, "contrasena_actual", "La contraseña actual no es correcta.");
    }
    await deps.pool.query("UPDATE tienda.clientes SET hash = $2, actualizado_en = now() WHERE id = $1", [s.clienteId, await hash(req.body.nueva, ARGON)]);
    // Las otras sesiones (otro celular, una compu prestada) se cierran.
    await cerrarTodas(deps.pool, s.clienteId, s.id);
    return reply.code(204).send();
  });

  // Siempre la misma respuesta, exista o no el email.
  api.post("/v1/cuenta/olvide", { schema: { body: z.object({ email: Email }).strict() } }, async (req, reply) => {
    await frenar(deps.redis, "olvide-ip", ip(req), 10, 3600);
    await frenar(deps.redis, "olvide-email", sha256(req.body.email), 3, 3600);
    const { rows } = await deps.pool.query<FilaCliente>("SELECT * FROM tienda.clientes WHERE email = $1", [req.body.email]);
    if (rows[0]) await enviarRestablecer(deps, rows[0].id, rows[0].email, rows[0].nombre, rows[0].hash ? "cambiar" : "crear");
    return reply.code(202).send({ mensaje: "Si hay una cuenta con ese email, te llega un enlace para crear una contraseña nueva." });
  });

  api.post("/v1/cuenta/restablecer", { schema: { body: z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{40,60}$/), contrasena: Contrasena }).strict(), response: { 200: Respuesta } } }, async (req, reply) => {
    await frenar(deps.redis, "restablecer", ip(req), 20, 3600);
    const cli = await deps.pool.connect();
    try {
      await cli.query("BEGIN");
      const { rows } = await cli.query<{ cliente_id: number }>(
        `UPDATE tienda.restablecimientos SET usado_en = now()
          WHERE id = $1 AND usado_en IS NULL AND expira_en > now() RETURNING cliente_id`,
        [sha256(req.body.token)],
      );
      if (!rows[0]) throw new ErrorHttp(400, "enlace_vencido", "El enlace ya se usó o venció. Pedí uno nuevo.");
      const id = rows[0].cliente_id;
      const c = (await cli.query<FilaCliente>(
        "UPDATE tienda.clientes SET hash = $2, intentos_fallidos = 0, bloqueado_hasta = NULL, actualizado_en = now() WHERE id = $1 RETURNING *",
        [id, await hash(req.body.contrasena, ARGON)],
      )).rows[0]!;
      // Contraseña nueva: afuera todas las sesiones anteriores y los demás enlaces pendientes.
      await cerrarTodas(cli, id);
      await cli.query("UPDATE tienda.restablecimientos SET usado_en = now() WHERE cliente_id = $1 AND usado_en IS NULL", [id]);
      const token = await crearSesion(cli, id, deps.env.SESION_DIAS, ip(req), agente(req));
      await cli.query("COMMIT");
      reply.headers(noCache);
      return { cliente: publico(c), token };
    } catch (e) {
      await cli.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      cli.release();
    }
  });
}

async function enviarRestablecer(deps: DepsCuentas, clienteId: number, email: string, nombre: string, modo: "crear" | "cambiar") {
  const token = tokenNuevo();
  await deps.pool.query(
    "INSERT INTO tienda.restablecimientos (id, cliente_id, expira_en) VALUES ($1, $2, now() + interval '1 hour')",
    [sha256(token), clienteId],
  );
  await deps.colas.email("restablecer", email, {
    nombre, modo, enlace: `${deps.env.SITIO_URL.replace(/\/+$/, "")}/cuenta/restablecer#t=${token}`,
  });
}
