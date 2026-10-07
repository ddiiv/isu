import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { crearPool, migrar } from "@isu/db";
import { provinciaDelCheckout } from "@isu/shared";
import { construirApp } from "../src/app.js";
import { leerEntorno } from "../src/entorno.js";
import { calleNormal, cpDelCheckout, crearGeoref, crearGoogle, evaluarGeoref, lugarDeComponentes } from "../src/lib/direcciones.js";
import type { Colas } from "../src/lib/colas.js";

/*
 * Direcciones del checkout (etapa 11): Google Places para sugerir y completar,
 * Georef para revisar calle y altura. Los dos son simuladores en este proceso.
 */
const DB = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:5433/stocker_test";
const REDIS = process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6380/6";
const CLAVE = "clave-google-de-prueba-0123456789";

// ── Funciones ─────────────────────────────────────────────────────
describe("direcciones · de Google y Georef al checkout", () => {
  it("código postal: el CPA completo se queda; si no, los 4 números", () => {
    expect(cpDelCheckout("C1043AAZ")).toBe("C1043AAZ");
    expect(cpDelCheckout("c1043aaz")).toBe("C1043AAZ");
    expect(cpDelCheckout("C1414")).toBe("1414");
    expect(cpDelCheckout("B1642")).toBe("1642");
    expect(cpDelCheckout("5000")).toBe("5000");
    expect(cpDelCheckout(undefined)).toBe("");
    expect(cpDelCheckout("sin código")).toBe("");
  });

  it("provincia: los nombres de Google y Georef a los del checkout", () => {
    expect(provinciaDelCheckout("Ciudad Autónoma de Buenos Aires")).toBe("CABA");
    expect(provinciaDelCheckout("Capital Federal")).toBe("CABA");
    expect(provinciaDelCheckout("Provincia de Buenos Aires")).toBe("Buenos Aires");
    expect(provinciaDelCheckout("Buenos Aires")).toBe("Buenos Aires");
    expect(provinciaDelCheckout("Tierra del Fuego, Antártida e Islas del Atlántico Sur")).toBe("Tierra del Fuego");
    expect(provinciaDelCheckout("cordoba")).toBe("Córdoba");
    expect(provinciaDelCheckout("Montevideo")).toBeNull();
    expect(provinciaDelCheckout("")).toBeNull();
  });

  const comp = (longText: string, ...types: string[]) => ({ longText, shortText: longText, types });
  it("lugar en CABA: el barrio como localidad (nunca «Comuna 14»)", () => {
    expect(lugarDeComponentes([
      comp("1500", "street_number"), comp("Thames", "route"), comp("Palermo", "neighborhood", "political"),
      comp("Comuna 14", "sublocality_level_1", "sublocality"), comp("Buenos Aires", "locality"),
      comp("Ciudad Autónoma de Buenos Aires", "administrative_area_level_1"), comp("C1414", "postal_code"),
    ])).toEqual({ calle: "Thames", numero: "1500", cp: "1414", localidad: "Palermo", provincia: "CABA" });
    // Sin barrio: "CABA" (no la comuna).
    expect(lugarDeComponentes([comp("Thames", "route"), comp("Comuna 14", "sublocality_level_1"), comp("Ciudad Autónoma de Buenos Aires", "administrative_area_level_1")]).localidad).toBe("CABA");
  });

  it("lugar en provincia: la localidad; sin altura, número vacío; sin provincia conocida, null", () => {
    expect(lugarDeComponentes([
      comp("Belgrano", "route"), comp("Quilmes", "locality"), comp("Quilmes", "administrative_area_level_2"),
      comp("Buenos Aires", "administrative_area_level_1"), comp("B1878ABC", "postal_code"),
    ])).toEqual({ calle: "Belgrano", numero: "", cp: "B1878ABC", localidad: "Quilmes", provincia: "Buenos Aires" });
    expect(lugarDeComponentes([]).provincia).toBeNull();
    // Textos largos se cortan (no rompen el formulario).
    expect(lugarDeComponentes([comp("x".repeat(500), "route")]).calle).toHaveLength(100);
  });

  it("calleNormal: mismas calles escritas distinto", () => {
    expect(calleNormal("AV. CORRIENTES")).toBe(calleNormal("Avenida Corrientes"));
    expect(calleNormal("Av Corrientes")).toBe("corrientes");
    expect(calleNormal("GRAL. PAZ")).toBe(calleNormal("General Paz"));
    expect(calleNormal("Pte. Perón")).toBe("presidente peron");
    expect(calleNormal("Calle Thames")).toBe("thames");
    expect(calleNormal("Thames")).not.toBe(calleNormal("Corrientes"));
  });

  const georef = (calle: string, opciones: { lat?: number | null; localidad?: string; provincia?: string } = {}) => ({
    calle: { nombre: calle }, altura: { valor: 1234 }, localidad: { nombre: opciones.localidad ?? null }, localidad_censal: { nombre: opciones.localidad ?? null },
    departamento: { nombre: null }, provincia: { nombre: opciones.provincia ?? "Ciudad Autónoma de Buenos Aires" },
    ubicacion: { lat: opciones.lat === undefined ? -34.6 : opciones.lat, lon: -58.4 },
  });
  const pedido = (calle: string, provincia = "CABA", localidad = "") => ({ calle, numero: "1234", localidad, provincia });

  it("evaluarGeoref: ok, altura, no encontrada", () => {
    expect(evaluarGeoref(pedido("Av. Corrientes"), [georef("AV. CORRIENTES")])).toEqual({ estado: "ok", sugerencia: null });
    expect(evaluarGeoref(pedido("Av. Corrientes"), [georef("AV. CORRIENTES", { lat: null })])).toEqual({ estado: "altura", sugerencia: null });
    expect(evaluarGeoref(pedido("Calle Inventada"), [])).toEqual({ estado: "no_encontrada", sugerencia: null });
  });

  it("evaluarGeoref: mal escrita → propone la oficial, con el número de la persona", () => {
    const r = evaluarGeoref(pedido("Corientes"), [georef("AV. CORRIENTES")]);
    expect(r.estado).toBe("sugerencia");
    expect(r.sugerencia).toEqual({ calle: "Av. Corrientes", numero: "1234", localidad: "", provincia: "CABA", texto: "Av. Corrientes 1234, CABA" });
  });

  it("evaluarGeoref: en provincia, prefiere la de su localidad y si no coincide la propone", () => {
    const rs = [georef("BELGRANO", { localidad: "Avellaneda", provincia: "Buenos Aires" }), georef("BELGRANO", { localidad: "Quilmes", provincia: "Buenos Aires" })];
    expect(evaluarGeoref(pedido("Belgrano", "Buenos Aires", "Quilmes"), rs).estado).toBe("ok");
    const otra = evaluarGeoref(pedido("Belgrano", "Buenos Aires", "Bernal Oeste"), [rs[1]!]);
    expect(otra.estado).toBe("sugerencia");
    expect(otra.sugerencia?.texto).toBe("Belgrano 1234, Quilmes, Buenos Aires");
    // Sin localidad escrita, alcanza con la calle.
    expect(evaluarGeoref(pedido("Belgrano", "Buenos Aires"), rs).estado).toBe("ok");
  });
});

// ── Clientes de Google y Georef ───────────────────────────────────
const servidores: http.Server[] = [];
async function levantar(h: http.RequestListener) {
  const s = http.createServer(h);
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  servidores.push(s);
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}
const leerCuerpo = async (req: http.IncomingMessage) => { let b = ""; for await (const c of req) b += c; return b ? JSON.parse(b) : {}; };
const json = (res: http.ServerResponse, status: number, cuerpo: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(cuerpo)); };

// Lo que recibió cada simulador.
const google = { sugerencias: [] as Array<Record<string, unknown>>, lugares: [] as Array<{ id: string; sesion: string | null; mascara: string | undefined }>, lento: false, caido: false };
const georefSim = { pedidos: [] as URLSearchParams[], caido: false };
let urlGoogle = "", urlGeoref = "";

beforeAll(async () => {
  urlGoogle = await levantar(async (req, res) => {
    if (req.headers["x-goog-api-key"] !== CLAVE) return json(res, 403, { error: { status: "PERMISSION_DENIED" } });
    if (google.caido) return json(res, 500, {});
    if (google.lento) await new Promise((r) => setTimeout(r, 1500));
    const u = new URL(req.url!, "http://x");
    if (u.pathname === "/v1/places:autocomplete" && req.method === "POST") {
      const b = await leerCuerpo(req);
      google.sugerencias.push(b);
      return json(res, 200, { suggestions: [
        { placePrediction: { placeId: "ChIJ_thames_1500_abc", text: { text: "Thames 1500, Palermo, CABA" }, structuredFormat: { mainText: { text: "Thames 1500" }, secondaryText: { text: "Palermo, CABA, Argentina" } } } },
        // Un id raro (no va en la URL) o sin texto: se descarta.
        { placePrediction: { placeId: "../../etc/passwd", structuredFormat: { mainText: { text: "Mala" } } } },
        { placePrediction: { placeId: "ChIJ_sin_texto_00000" } },
        { queryPrediction: { text: { text: "thames" } } },
      ] });
    }
    const m = /^\/v1\/places\/([^/]+)$/.exec(u.pathname);
    if (m && req.method === "GET") {
      google.lugares.push({ id: decodeURIComponent(m[1]!), sesion: u.searchParams.get("sessionToken"), mascara: req.headers["x-goog-fieldmask"] as string | undefined });
      return json(res, 200, { addressComponents: [
        { longText: "1500", types: ["street_number"] }, { longText: "Thames", types: ["route"] }, { longText: "Palermo", types: ["neighborhood"] },
        { longText: "Ciudad Autónoma de Buenos Aires", types: ["administrative_area_level_1"] }, { longText: "C1414", types: ["postal_code"] },
      ] });
    }
    json(res, 404, {});
  });
  urlGeoref = await levantar((req, res) => {
    const u = new URL(req.url!, "http://x");
    if (georefSim.caido) return json(res, 502, {});
    if (u.pathname !== "/v2.0/direcciones") return json(res, 404, {});
    georefSim.pedidos.push(u.searchParams);
    const d = u.searchParams.get("direccion") ?? "";
    const altura = Number(/(\d+)$/.exec(d)?.[1] ?? 0);
    const calle = /corr?ientes/i.test(d) ? "AV. CORRIENTES" : /thames/i.test(d) ? "THAMES" : null;
    if (!calle) return json(res, 200, { direcciones: [] });
    json(res, 200, { direcciones: [{ calle: { nombre: calle }, altura: { valor: altura }, provincia: { nombre: "Ciudad Autónoma de Buenos Aires" }, localidad: { nombre: null }, ubicacion: altura <= 6000 ? { lat: -34.6, lon: -58.4 } : { lat: null, lon: null } }] });
  });
});
afterAll(async () => { for (const s of servidores) s.close(); });
beforeEach(() => { google.sugerencias.length = 0; google.lugares.length = 0; google.lento = false; google.caido = false; georefSim.pedidos.length = 0; georefSim.caido = false; });

describe("direcciones · clientes de Google y Georef", () => {
  it("Google: sólo direcciones de Argentina, con la sesión, y descarta lo que no sirve", async () => {
    const g = crearGoogle({ url: urlGoogle, clave: CLAVE });
    const sesion = randomUUID();
    expect(await g.sugerencias("thames 15", sesion)).toEqual([{ id: "ChIJ_thames_1500_abc", principal: "Thames 1500", secundario: "Palermo, CABA, Argentina" }]);
    expect(google.sugerencias[0]).toMatchObject({ input: "thames 15", sessionToken: sesion, includedRegionCodes: ["ar"] });
    expect(google.sugerencias[0]!.includedPrimaryTypes).toContain("street_address");
  });

  it("Google: los datos piden sólo addressComponents (lo más barato) y cierran la sesión", async () => {
    const g = crearGoogle({ url: urlGoogle, clave: CLAVE });
    const sesion = randomUUID();
    expect(await g.lugar("ChIJ_thames_1500_abc", sesion)).toEqual({ calle: "Thames", numero: "1500", cp: "1414", localidad: "Palermo", provincia: "CABA" });
    expect(google.lugares[0]).toEqual({ id: "ChIJ_thames_1500_abc", sesion, mascara: "addressComponents" });
  });

  it("Google: clave mala, caído o lento → error (la ruta lo convierte en «sin ayuda»)", async () => {
    await expect(crearGoogle({ url: urlGoogle, clave: "otra-clave-que-no-es-0000" }).sugerencias("thames", randomUUID())).rejects.toThrow(/403/);
    google.caido = true;
    await expect(crearGoogle({ url: urlGoogle, clave: CLAVE }).lugar("ChIJ_thames_1500_abc", randomUUID())).rejects.toThrow(/500/);
    google.caido = false; google.lento = true;
    await expect(crearGoogle({ url: urlGoogle, clave: CLAVE, tiempoMs: 200 }).sugerencias("thames", randomUUID())).rejects.toThrow(/no responde/);
    await expect(crearGoogle({ url: "http://127.0.0.1:1", clave: CLAVE }).sugerencias("thames", randomUUID())).rejects.toThrow(/no responde/);
  });

  it("Georef: manda la provincia por su código oficial", async () => {
    const g = crearGeoref({ url: urlGeoref });
    expect((await g.revisar({ calle: "Av. Corrientes", numero: "1234", localidad: "", provincia: "CABA" })).estado).toBe("ok");
    expect(georefSim.pedidos[0]!.get("provincia")).toBe("02");
    expect(georefSim.pedidos[0]!.get("direccion")).toBe("Av. Corrientes 1234");
    expect((await g.revisar({ calle: "Corrientes", numero: "1", localidad: "", provincia: "Córdoba" })).estado).toBe("ok");
    expect(georefSim.pedidos[1]!.get("provincia")).toBe("14");
    // Una provincia que no es del checkout no se consulta.
    expect(await g.revisar({ calle: "Corrientes", numero: "1", localidad: "", provincia: "Narnia" })).toEqual({ estado: "sin_servicio", sugerencia: null });
    expect(georefSim.pedidos).toHaveLength(2);
  });
});

// ── Rutas ─────────────────────────────────────────────────────────
describe("direcciones · rutas de la API", () => {
  const pool = crearPool({ url: DB, max: 4 });
  const redis = new Redis(REDIS, { maxRetriesPerRequest: 1 });
  const colas: Colas = { async email() {}, async stocker() {}, async envios() {}, async cerrar() {} };
  let app: Awaited<ReturnType<typeof construirApp>>;
  const ajuste = (v: Record<string, unknown>) => pool.query("UPDATE tienda.ajustes SET valor = $1 WHERE clave = 'direcciones'", [JSON.stringify({ google: true, georef: true, topeSugerencias: 300, topeLugares: 300, ...v })]);
  const post = (ruta: string, payload: unknown) => app.inject({ method: "POST", url: `/v1/direcciones/${ruta}`, payload: payload as Record<string, unknown> });

  beforeAll(async () => {
    await migrar(pool);
    await redis.flushdb();
    app = await construirApp({
      env: leerEntorno({
        NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: DB, REDIS_URL: REDIS, CACHE_SEGUNDOS: "0",
        INTERNO_TOKEN: "i".repeat(40), SITIO_URL: "https://www.isuwaya.test", API_PUBLICA_URL: "https://api.isuwaya.test",
        GOOGLE_MAPS_API_KEY: CLAVE, GOOGLE_PLACES_URL: urlGoogle, GEOREF_URL: urlGeoref,
      }),
      pool, redis, colas,
    });
    await app.ready();
  });
  beforeEach(async () => { await ajuste({}); await redis.flushdb(); });
  afterAll(async () => { await ajuste({}); await app.close(); await pool.end(); redis.disconnect(); });

  it("la configuración pública dice qué ayudas hay (y nunca la clave)", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/config" });
    expect(r.json().direcciones).toEqual({ sugerencias: true, revisar: true });
    expect(r.body).not.toContain(CLAVE);
    await ajuste({ google: false });
    expect((await app.inject({ method: "GET", url: "/v1/config" })).json().direcciones).toEqual({ sugerencias: false, revisar: true });
  });

  it("sugerencias y datos de la elegida, con la misma sesión; la clave no sale", async () => {
    const sesion = randomUUID();
    const s = await post("sugerencias", { texto: "thames 15", sesion });
    expect(s.statusCode).toBe(200);
    expect(s.headers["cache-control"]).toBe("no-store");
    expect(s.json().sugerencias).toEqual([{ id: "ChIJ_thames_1500_abc", principal: "Thames 1500", secundario: "Palermo, CABA, Argentina" }]);
    const l = await post("lugar", { id: "ChIJ_thames_1500_abc", sesion });
    expect(l.json()).toEqual({ calle: "Thames", numero: "1500", cp: "1414", localidad: "Palermo", provincia: "CABA" });
    expect(google.sugerencias[0]!.sessionToken).toBe(sesion);
    expect(google.lugares[0]!.sesion).toBe(sesion);
    expect(s.body + l.body).not.toContain(CLAVE);
  });

  it("valida lo que llega: texto, sesión e id (el id va en la URL de Google)", async () => {
    const sesion = randomUUID();
    expect((await post("sugerencias", { texto: "ab", sesion })).statusCode).toBe(400);
    expect((await post("sugerencias", { texto: "x".repeat(121), sesion })).statusCode).toBe(400);
    expect((await post("sugerencias", { texto: "thames", sesion: "no-es-un-uuid" })).statusCode).toBe(400);
    expect((await post("sugerencias", { texto: "thames", sesion, clave: "otra" })).statusCode).toBe(400);
    for (const id of ["../../v1/otra", "ChIJ?fields=*", "ChIJ%2F..%2Fx0000", "corto", "ChIJ abc def ghi"]) {
      expect((await post("lugar", { id, sesion })).statusCode).toBe(400);
    }
    expect((await post("revisar", { calle: "x", numero: "1", provincia: "CABA" })).statusCode).toBe(400);
    expect((await post("revisar", { calle: "Thames", numero: "12345678901", provincia: "CABA" })).statusCode).toBe(400);
    expect(google.sugerencias).toHaveLength(0);
    expect(google.lugares).toHaveLength(0);
    expect(georefSim.pedidos).toHaveLength(0);
  });

  it("apagado en Ajustes: sin sugerencias, sin datos, sin revisar (y sin llamar a nadie)", async () => {
    await ajuste({ google: false, georef: false });
    const sesion = randomUUID();
    expect((await post("sugerencias", { texto: "thames 15", sesion })).json()).toEqual({ sugerencias: [] });
    const l = await post("lugar", { id: "ChIJ_thames_1500_abc", sesion });
    expect(l.statusCode).toBe(503);
    expect(l.body).toContain("sin_servicio");
    expect((await post("revisar", { calle: "Thames", numero: "1500", provincia: "CABA" })).json()).toEqual({ estado: "sin_servicio", sugerencia: null });
    expect(google.sugerencias.length + google.lugares.length + georefSim.pedidos.length).toBe(0);
  });

  it("tope del día: pasado el tope, sin ayuda hasta mañana (Google no se entera)", async () => {
    await ajuste({ topeSugerencias: 2, topeLugares: 1 });
    const sesion = randomUUID();
    for (let i = 0; i < 2; i++) expect((await post("sugerencias", { texto: "thames 15", sesion })).json().sugerencias).toHaveLength(1);
    expect((await post("sugerencias", { texto: "thames 15", sesion })).json()).toEqual({ sugerencias: [] });
    expect(google.sugerencias).toHaveLength(2);
    expect((await post("lugar", { id: "ChIJ_thames_1500_abc", sesion })).statusCode).toBe(200);
    expect((await post("lugar", { id: "ChIJ_thames_1500_abc", sesion })).statusCode).toBe(503);
    expect(google.lugares).toHaveLength(1);
    // Tope 0 = apagado.
    await ajuste({ topeSugerencias: 0 });
    expect((await post("sugerencias", { texto: "thames 15", sesion })).json()).toEqual({ sugerencias: [] });
    expect(google.sugerencias).toHaveLength(2);
  });

  it("Google caído: sugerencias vacías y «escribila a mano», nunca un 500", async () => {
    google.caido = true;
    const sesion = randomUUID();
    const s = await post("sugerencias", { texto: "thames 15", sesion });
    expect(s.statusCode).toBe(200);
    expect(s.json()).toEqual({ sugerencias: [] });
    const l = await post("lugar", { id: "ChIJ_thames_1500_abc", sesion });
    expect(l.statusCode).toBe(503);
    expect(l.body).toContain("escribila a mano");
  });

  it("revisar: ok, sugerencia, altura y no encontrada; la misma dirección no se consulta dos veces", async () => {
    const revisar = async (calle: string, numero: string) => (await post("revisar", { calle, numero, provincia: "CABA" })).json();
    expect(await revisar("Av. Corrientes", "1234")).toEqual({ estado: "ok", sugerencia: null });
    expect(await revisar("Corientes", "1234")).toEqual({ estado: "sugerencia", sugerencia: { calle: "Av. Corrientes", numero: "1234", localidad: "", provincia: "CABA", texto: "Av. Corrientes 1234, CABA" } });
    expect((await revisar("Av. Corrientes", "99999")).estado).toBe("altura");
    expect((await revisar("Calle Inventada", "100")).estado).toBe("no_encontrada");
    const antes = georefSim.pedidos.length;
    expect((await revisar("av. corrientes", "1234")).estado).toBe("ok");
    expect((await revisar("Av. Córrientes", "1234")).estado).toBe("ok");
    expect(georefSim.pedidos.length).toBe(antes);
  });

  it("Georef caído: sin_servicio (el checkout no dice nada)", async () => {
    georefSim.caido = true;
    expect((await post("revisar", { calle: "Thames", numero: "777", provincia: "CABA" })).json()).toEqual({ estado: "sin_servicio", sugerencia: null });
  });

  it("estado para el backoffice: sólo con sesión del dueño", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/admin/direcciones" })).statusCode).toBe(401);
  });
});
