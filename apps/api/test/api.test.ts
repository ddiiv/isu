import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import { crearPool, migrar } from "@isu/db";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { construirApp } from "../src/app.js";
import { leerEntorno } from "../src/entorno.js";

/*
 * La API real (misma función que usa el servidor) contra Postgres y Redis
 * reales. La base es la de prueba de Stocker: la tienda vive en su esquema.
 */
const DB = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:5433/stocker_test";
const REDIS = process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6380/5";
const TIENDA = "https://www.isuwaya.com.ar";

const env = (extra: Record<string, string> = {}) =>
  leerEntorno({
    NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: DB, REDIS_URL: REDIS,
    ORIGENES_PERMITIDOS: `${TIENDA},https://admin.isuwaya.com.ar`, CACHE_SEGUNDOS: "0", ...extra,
  });

const pool = crearPool({ url: DB, max: 5 });
const redis = new Redis(REDIS, { maxRetriesPerRequest: 1 });
let app: Awaited<ReturnType<typeof construirApp>>;

beforeAll(async () => {
  await migrar(pool);
  await redis.flushdb();
  app = await construirApp({ env: env(), pool, redis });
  // Ruta que explota a propósito, para ver qué sale en un 500.
  app.get("/__explota", async () => {
    throw new Error('relation "tienda.secreta" does not exist at /app/src/x.ts:12 password=hunter2');
  });
  // Ruta POST de prueba con esquema estricto, para probar cuerpos contra una ruta real.
  app.withTypeProvider<ZodTypeProvider>().post(
    "/__eco",
    { schema: { body: z.object({ nombre: z.string().max(50) }).strict() } },
    async (req) => ({ recibido: req.body.nombre }),
  );
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await redis.quit();
  await pool.end();
});

describe("salud", () => {
  it("healthz y readyz responden", async () => {
    expect((await app.inject("/healthz")).json()).toEqual({ ok: true });
    const r = await app.inject("/readyz");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true, db: true, redis: true });
  });

  it("readyz da 503 si Redis no responde (y healthz sigue en 200)", async () => {
    const caido = new Redis("redis://127.0.0.1:1/0", { lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 0, retryStrategy: () => null });
    caido.on("error", () => {});
    const otra = await construirApp({ env: env(), pool, redis: caido });
    await otra.ready();
    const r = await otra.inject("/readyz");
    expect(r.statusCode).toBe(503);
    expect(r.json()).toMatchObject({ ok: false, db: true, redis: false });
    expect((await otra.inject("/healthz")).statusCode).toBe(200);
    // Y con Redis caído la API sigue atendiendo (el límite de pedidos se saltea).
    expect((await otra.inject("/v1/config")).statusCode).toBe(200);
    await otra.close();
    caido.disconnect();
  });
});

describe("config pública", () => {
  it("devuelve los ajustes validados, sin campos internos", async () => {
    const r = await app.inject("/v1/config");
    expect(r.statusCode).toBe(200);
    const c = r.json();
    expect(c.whatsapp).toBe("5491168515444");
    expect(c.descuentoTransferencia).toBe(20);
    expect(c.email).toBe("isu.isuwaya@gmail.com");
    expect(c.locales.length).toBe(3);
    expect(JSON.stringify(c)).not.toMatch(/actualizado_por|actualizadoPor|migracion/);
    expect(r.headers["cache-control"]).toMatch(/s-maxage=300/);
  });

  it("un ajuste roto en la base no tumba la tienda: usa el valor por defecto", async () => {
    await pool.query(`UPDATE tienda.ajustes SET valor = '"no-es-numero"' WHERE clave = 'cuotasSinInteres'`);
    const r = await app.inject("/v1/config");
    expect(r.statusCode).toBe(200);
    expect(r.json().cuotasSinInteres).toBe(3);
    await pool.query(`UPDATE tienda.ajustes SET valor = '3' WHERE clave = 'cuotasSinInteres'`);
  });
});

describe("categorías", () => {
  it("árbol de dos niveles, sólo visibles", async () => {
    await pool.query("UPDATE tienda.categorias SET visible = false WHERE slug = 'shorts' ");
    const r = await app.inject("/v1/categorias");
    const arbol = r.json();
    expect(arbol.map((c: { slug: string }) => c.slug)).toEqual(["hombre", "mujer", "ninos"]);
    expect(arbol[2].hijas.map((c: { slug: string }) => c.slug)).not.toContain("shorts");
    await pool.query("UPDATE tienda.categorias SET visible = true WHERE slug = 'shorts'");
  });

  it("una categoría por slug", async () => {
    const r = await app.inject("/v1/categorias/mujer");
    expect(r.statusCode).toBe(200);
    expect(r.json().hijas.length).toBe(4);
    expect((await app.inject("/v1/categorias/no-existe")).statusCode).toBe(404);
  });

  it("inyección en el slug: rechazada antes de llegar a la base", async () => {
    for (const malo of ["x' OR '1'='1", "hombre;DROP TABLE tienda.categorias", "../../etc/passwd", "%00", "<script>"]) {
      const r = await app.inject(`/v1/categorias/${encodeURIComponent(malo)}`);
      expect([400, 404]).toContain(r.statusCode);
      expect(r.body).not.toMatch(/syntax|SQL|stack|pg_/i);
    }
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM tienda.categorias");
    expect(rows[0].n).toBeGreaterThan(10);
  });
});

describe("cabeceras de seguridad (en todas las respuestas, también en errores)", () => {
  for (const ruta of ["/v1/config", "/no-existe", "/__explota"]) {
    it(ruta, async () => {
      const h = (await app.inject(ruta)).headers;
      expect(h["content-security-policy"]).toMatch(/default-src 'none'/);
      expect(h["content-security-policy"]).toMatch(/frame-ancestors 'none'/);
      expect(h["x-content-type-options"]).toBe("nosniff");
      expect(h["referrer-policy"]).toBe("no-referrer");
      expect(h["x-powered-by"]).toBeUndefined();
      expect(h["x-request-id"]).toBeTruthy();
    });
  }
});

describe("CORS", () => {
  it("la tienda puede, un sitio ajeno no", async () => {
    const propio = await app.inject({ url: "/v1/config", headers: { origin: TIENDA } });
    expect(propio.headers["access-control-allow-origin"]).toBe(TIENDA);
    expect(propio.headers["access-control-allow-credentials"]).toBe("true");
    const ajeno = await app.inject({ url: "/v1/config", headers: { origin: "https://evil.example" } });
    expect(ajeno.headers["access-control-allow-origin"]).toBeUndefined();
  });
  it("preflight de un sitio ajeno no recibe permiso", async () => {
    const r = await app.inject({
      method: "OPTIONS", url: "/v1/config",
      headers: { origin: "https://evil.example", "access-control-request-method": "POST" },
    });
    expect(r.headers["access-control-allow-origin"]).toBeUndefined();
  });
  it("un subdominio parecido no pasa", async () => {
    const r = await app.inject({ url: "/v1/config", headers: { origin: "https://www.isuwaya.com.ar.evil.example" } });
    expect(r.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("errores", () => {
  it("un 500 no filtra el mensaje interno, el SQL ni el stack; trae idPedido", async () => {
    const r = await app.inject("/__explota");
    expect(r.statusCode).toBe(500);
    const b = r.json();
    expect(b.error).toBe("interno");
    expect(b.idPedido).toBe(r.headers["x-request-id"]);
    expect(r.body).not.toMatch(/relation|tienda\.secreta|hunter2|\/app\/src|stack/);
  });
  it("404 con la forma estándar", async () => {
    const r = await app.inject("/v1/nada");
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ error: "no_encontrado", mensaje: "No existe." });
  });
  it("un x-request-id raro no se refleja (sin inyección de cabeceras)", async () => {
    const r = await app.inject({ url: "/healthz", headers: { "x-request-id": "abc\r\nSet-Cookie: x=1" } });
    expect(r.headers["x-request-id"]).not.toMatch(/Set-Cookie/);
    expect(r.headers["set-cookie"]).toBeUndefined();
  });
});

describe("cuerpos", () => {
  it("más de 64 KB → 413", async () => {
    const r = await app.inject({ method: "POST", url: "/__eco", headers: { "content-type": "application/json" }, payload: JSON.stringify({ nombre: "a".repeat(70_000) }) });
    expect(r.statusCode).toBe(413);
  });
  it("otro content-type → 415", async () => {
    const r = await app.inject({ method: "POST", url: "/__eco", headers: { "content-type": "application/xml" }, payload: "<a/>" });
    expect(r.statusCode).toBe(415);
  });
  it("__proto__ en el JSON → 400 (prototype poisoning)", async () => {
    const r = await app.inject({ method: "POST", url: "/__eco", headers: { "content-type": "application/json" }, payload: '{"nombre":"x","__proto__":{"admin":true}}' });
    expect(r.statusCode).toBe(400);
    expect(({} as Record<string, unknown>).admin).toBeUndefined();
  });
  it("JSON roto → 400 sin detalles del parser", async () => {
    const r = await app.inject({ method: "POST", url: "/__eco", headers: { "content-type": "application/json" }, payload: '{"a":' });
    expect(r.statusCode).toBe(400);
    expect(r.body).not.toMatch(/Unexpected|position/);
  });
});

describe("validación de entrada", () => {
  it("un cuerpo válido pasa", async () => {
    const r = await app.inject({ method: "POST", url: "/__eco", payload: { nombre: "Ana" } });
    expect(r.json()).toEqual({ recibido: "Ana" });
  });
  it("campos de más o de tipo equivocado → 400 con detalle del campo, sin eco del valor", async () => {
    const r = await app.inject({ method: "POST", url: "/__eco", payload: { nombre: 123, esAdmin: true } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("validacion");
  });
});

describe("límite de pedidos", () => {
  it("pasado el límite → 429 con Retry-After; otra IP sigue pudiendo", async () => {
    await redis.flushdb();
    const lim = await construirApp({ env: env({ LIMITE_PEDIDOS_POR_MINUTO: "5" }), pool, redis });
    await lim.ready();
    const pedir = (ip: string) => lim.inject({ url: "/v1/config", remoteAddress: ip });
    for (let i = 0; i < 5; i++) expect((await pedir("10.0.0.1")).statusCode).toBe(200);
    const bloqueado = await pedir("10.0.0.1");
    expect(bloqueado.statusCode).toBe(429);
    expect(bloqueado.headers["retry-after"]).toBeTruthy();
    expect(bloqueado.json().error).toBe("demasiados_pedidos");
    expect((await pedir("10.0.0.2")).statusCode).toBe(200);
    // Los chequeos de salud no cuentan.
    expect((await lim.inject({ url: "/healthz", remoteAddress: "10.0.0.1" })).statusCode).toBe(200);
    await lim.close();
  });

  it("sin proxies de confianza, un X-Forwarded-For inventado no cambia la IP", async () => {
    await redis.flushdb();
    const lim = await construirApp({ env: env({ LIMITE_PEDIDOS_POR_MINUTO: "3" }), pool, redis });
    await lim.ready();
    let ultimo = 0;
    for (let i = 0; i < 5; i++) {
      ultimo = (await lim.inject({ url: "/v1/config", remoteAddress: "10.0.0.9", headers: { "x-forwarded-for": `1.2.3.${i}` } })).statusCode;
    }
    expect(ultimo).toBe(429);
    await lim.close();
  });

  it("con 2 proxies de confianza toma la IP real del cliente", async () => {
    await redis.flushdb();
    const lim = await construirApp({ env: env({ LIMITE_PEDIDOS_POR_MINUTO: "2", PROXIES_DE_CONFIANZA: "2" }), pool, redis });
    await lim.ready();
    // cliente → Cloudflare (172.70.0.1) → borde Railway (10.1.0.1) → API
    const pedir = (cliente: string) => lim.inject({ url: "/v1/config", remoteAddress: "10.1.0.1", headers: { "x-forwarded-for": `${cliente}, 172.70.0.1` } });
    await pedir("200.1.1.1"); await pedir("200.1.1.1");
    expect((await pedir("200.1.1.1")).statusCode).toBe(429);
    expect((await pedir("200.2.2.2")).statusCode).toBe(200);
    await lim.close();
  });
});
