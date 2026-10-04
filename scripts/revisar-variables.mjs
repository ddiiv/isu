/*
 * Revisa las variables del servicio ANTES de arrancar la tienda y dice, en
 * castellano, cuál está mal y qué poner. Lo usa scripts/todo-en-uno.mjs; se
 * puede correr solo para probar unas variables:
 *
 *   railway run node scripts/revisar-variables.mjs
 *
 * Nunca muestra valores (pueden tener claves): sólo el nombre de la variable
 * y el problema.
 */
import { fileURLToPath } from "node:url";

// Restos de la guía o referencias de Railway que no se resolvieron.
const RELLENO = /[<>`«»|]|\$\{\{|^\s|\s$/;
const LOCAL = /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?|0\.0\.0\.0)$/i;

function url(v) {
  try { return new URL(v); } catch { return null; }
}

/** @returns {{ errores: string[], avisos: string[] }} */
export function revisar(env = process.env) {
  const errores = [], avisos = [];
  const mal = (k, t) => errores.push(`${k}: ${t}`);
  const ojo = (k, t) => avisos.push(`${k}: ${t}`);
  const produccion = env.NODE_ENV === "production" || !!(env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_PROJECT_ID);

  const VARIABLES = ["DATABASE_URL", "REDIS_URL", "NEXT_PUBLIC_SITE_URL", "SITIO_URL", "ADMIN_URL", "API_PUBLICA_URL", "ORIGENES_PERMITIDOS",
    "STOCKER_API_URL", "STOCKER_TOKEN", "INTERNO_TOKEN", "REVALIDAR_TOKEN", "PAGOS_TOKEN", "ADMIN_CLAVE_CIFRADO", "NEXT_PUBLIC_CDN_IMAGENES",
    "MP_ACCESS_TOKEN", "MP_WEBHOOK_SECRET", "SMTP_URL", "MAYORISTA_URL", "R2_CUENTA", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"];
  const conRelleno = new Set();
  for (const k of VARIABLES) {
    const v = env[k];
    if (v === undefined || v === "") continue;
    if (RELLENO.test(v)) {
      conRelleno.add(k);
      mal(k, v.includes("${{")
        ? "tiene una referencia de Railway (${{…}}) que no se resolvió: el nombre del servicio no coincide con el de tu proyecto. Copiá la referencia desde el autocompletado de Railway (escribí ${{ y elegí el servicio)."
        : "tiene texto de ejemplo de la guía (<…>, «…», `, | o espacios al principio/final). Poné el valor real.");
    }
  }
  const valida = (k) => env[k] && !conRelleno.has(k);

  // ── Obligatorias ──
  for (const k of ["DATABASE_URL", "REDIS_URL", "NEXT_PUBLIC_SITE_URL", "INTERNO_TOKEN"]) if (!env[k]) mal(k, "falta (es obligatoria).");

  const conProtocolo = (k, protocolos, ejemplo) => {
    if (!valida(k)) return null;
    const u = url(env[k]);
    if (!u || !protocolos.includes(u.protocol)) { mal(k, `no es una dirección válida: tiene que empezar con ${protocolos.map((p) => `${p}//`).join(" o ")} (por ejemplo ${ejemplo}).`); return null; }
    if (produccion && LOCAL.test(u.hostname) && k !== "NEXT_PUBLIC_SITE_URL") mal(k, "apunta a esta misma máquina (localhost / 127.0.0.1): en Railway eso no existe. Usá la referencia ${{Servicio.…}} o la dirección interna *.railway.internal.");
    return u;
  };
  conProtocolo("DATABASE_URL", ["postgres:", "postgresql:"], "postgres://tienda_app:CLAVE@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}");
  const redis = conProtocolo("REDIS_URL", ["redis:", "rediss:"], "${{Redis.REDIS_URL}}/1");
  if (redis) {
    const base = redis.pathname.replace(/^\//, "");
    if (base === "") ojo("REDIS_URL", "sin número de base: la tienda usa la 0. En el Redis compartido le toca la 1: agregá /1 al final (docs/redis-compartido.md).");
    else if (!/^(\d|1[0-5])$/.test(base)) mal("REDIS_URL", "el número de base al final tiene que ser /0 a /15 (la tienda: /1).");
  }
  const sitio = conProtocolo("NEXT_PUBLIC_SITE_URL", ["https:", "http:"], "https://isu-production.up.railway.app");
  const sitioMails = conProtocolo("SITIO_URL", ["https:", "http:"], "https://isu-production.up.railway.app");
  const admin = conProtocolo("ADMIN_URL", ["https:", "http:"], "la dirección del backoffice de la tienda (puerto 3001)");
  const apiPublica = conProtocolo("API_PUBLICA_URL", ["https:", "http:"], "https://<dirección de la API, puerto 4000>");
  conProtocolo("STOCKER_API_URL", ["http:", "https:"], "http://${{<servicio del backend de Stocker>.RAILWAY_PRIVATE_DOMAIN}}:<su puerto>");
  conProtocolo("MAYORISTA_URL", ["https:", "http:"], "https://isumayoristapedidos-production.up.railway.app");
  if (valida("NEXT_PUBLIC_CDN_IMAGENES")) {
    const primero = env.NEXT_PUBLIC_CDN_IMAGENES.split(",")[0].trim();
    if (!primero.startsWith("/") && !url(primero)) mal("NEXT_PUBLIC_CDN_IMAGENES", "tiene que ser la dirección pública del bucket de fotos (https://fotos.<dominio>).");
  }

  // ── Orígenes permitidos: direcciones completas, separadas por coma, sin barra final ──
  const origenes = [];
  if (valida("ORIGENES_PERMITIDOS")) {
    for (const o of env.ORIGENES_PERMITIDOS.split(",").map((s) => s.trim()).filter(Boolean)) {
      const u = url(o);
      if (!u || !/^https?:$/.test(u.protocol) || u.origin !== o.replace(/\/$/, "")) mal("ORIGENES_PERMITIDOS", "cada dirección va completa (https://…), sin camino ni comillas ni llaves, y separadas por coma. Ej.: https://isu-production.up.railway.app,https://<backoffice>");
      else origenes.push(u.origin);
    }
    if (!origenes.length && !errores.some((e) => e.startsWith("ORIGENES_PERMITIDOS"))) mal("ORIGENES_PERMITIDOS", "está vacía.");
  } else if (produccion && !env.ORIGENES_PERMITIDOS) mal("ORIGENES_PERMITIDOS", "falta: la dirección de la tienda y la del backoffice, separadas por coma.");

  // ── Coherencia entre direcciones ──
  if (sitio && sitioMails && sitio.origin !== sitioMails.origin) {
    ojo("SITIO_URL", "no coincide con NEXT_PUBLIC_SITE_URL. Los mails, la vuelta de Mercado Pago y el seguimiento van a SITIO_URL: mientras la tienda no esté en ese dominio, los clientes llegan a otro lado. Poné la misma dirección en las dos (y cambialas juntas el día del cambio de dominio).");
  }
  if (produccion && !env.SITIO_URL) ojo("SITIO_URL", "falta: poné la misma dirección que NEXT_PUBLIC_SITE_URL (los mails y Mercado Pago la usan).");
  if (sitio && admin && sitio.origin === admin.origin) mal("ADMIN_URL", "es la misma dirección que la tienda. El backoffice tiene su propia dirección (en Railway, una dirección del servicio apuntada al puerto 3001).");
  if (admin && origenes.length && !origenes.includes(admin.origin)) mal("ORIGENES_PERMITIDOS", "no incluye la dirección de ADMIN_URL: el backoffice no va a poder guardar nada.");
  if (sitio && origenes.length && !origenes.includes(sitio.origin)) ojo("ORIGENES_PERMITIDOS", "no incluye la dirección de la tienda (NEXT_PUBLIC_SITE_URL).");
  if (produccion && !env.ADMIN_URL) ojo("ADMIN_URL", "falta: sin ella el backoffice rechaza los cambios. Es la dirección del servicio apuntada al puerto 3001.");
  if (produccion && !env.API_PUBLICA_URL) ojo("API_PUBLICA_URL", "falta: Mercado Pago no va a poder avisar los pagos. Es la dirección del servicio apuntada al puerto 4000.");
  if (apiPublica && sitio && apiPublica.origin === sitio.origin) mal("API_PUBLICA_URL", "es la misma dirección que la tienda: la API tiene la suya (puerto 4000).");

  // ── Credenciales ──
  if (valida("ADMIN_CLAVE_CIFRADO") && Buffer.from(env.ADMIN_CLAVE_CIFRADO, "base64").length !== 32) mal("ADMIN_CLAVE_CIFRADO", "tienen que ser 32 bytes en base64: generala con  openssl rand -base64 32");
  if (produccion && !env.ADMIN_CLAVE_CIFRADO) mal("ADMIN_CLAVE_CIFRADO", "falta (el doble factor del backoffice la necesita): openssl rand -base64 32");
  for (const k of ["INTERNO_TOKEN", "REVALIDAR_TOKEN", "PAGOS_TOKEN"]) {
    if (valida(k) && env[k].length < 32) ojo(k, "es corta: generá una con  openssl rand -hex 32");
  }
  if (!env.REVALIDAR_TOKEN) ojo("REVALIDAR_TOKEN", "falta: los cambios de stock tardan hasta 5 minutos en verse en la tienda. openssl rand -hex 32");
  if (!env.STOCKER_API_URL || !env.STOCKER_TOKEN) ojo("STOCKER_API_URL / STOCKER_TOKEN", "faltan: la tienda arranca, pero sin productos (no puede traer el catálogo ni mandar pedidos a Stocker).");
  else if (valida("STOCKER_TOKEN") && env.STOCKER_TOKEN.length < 20) mal("STOCKER_TOKEN", "es muy corta para ser una credencial de Stocker: copiala del backoffice de Stocker (origen «Tienda online minorista»).");
  if (!env.R2_BUCKET && !env.FOTOS_DIR) ojo("R2_*", "faltan: no hay dónde guardar fotos (ni la importación del mayorista ni el backoffice pueden subirlas).");
  return { errores: [...new Set(errores)], avisos: [...new Set(avisos)] };
}

export function informe({ errores, avisos }) {
  const l = [];
  if (errores.length) l.push("✗ Variables del servicio con problemas (la tienda no arranca hasta corregirlas):", ...errores.map((e) => `   · ${e}`));
  if (avisos.length) l.push(errores.length ? "" : "", "! Para revisar (la tienda arranca igual):", ...avisos.map((a) => `   · ${a}`));
  if (errores.length) l.push("", "  Se cambian en Railway → servicio isu → Variables. Guía: docs/un-servicio.md § 4.");
  return l.join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = revisar();
  process.stdout.write(`${informe(r) || "✓ Variables en orden."}\n`);
  process.exitCode = r.errores.length ? 1 : 0;
}
