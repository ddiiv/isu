/*
 * La tienda entera en UN servicio de Railway (infra/railway/todo.json).
 *
 * Arranca las cuatro partes en el mismo contenedor y las cuida:
 *
 *   api      :4000  (también pública: el aviso de pagos de Mercado Pago llega acá)
 *   worker          (sin puerto: sincroniza Stocker, mails, colas)
 *   web      :$PORT (la tienda; es la que mira el healthcheck de Railway)
 *   admin    :3001  (el backoffice; a demanda, ver scripts/admin-perezoso.mjs)
 *
 * Entre ellas se hablan por 127.0.0.1, así que API_URL y WEB_INTERNAL_URL
 * se fijan acá (lo que diga la variable del servicio se ignora). Si una
 * parte se cae, se vuelve a levantar sola (esperando cada vez un poco más);
 * las demás siguen andando. Al apagar el servicio se apagan todas.
 *
 * Primero la api (aplica las migraciones al arrancar) y, cuando contesta,
 * el resto.
 *
 * Memoria (Railway cobra la RAM que el contenedor tiene ocupada): cada parte arranca con su propio tope
 * de heap, pasado como flag del proceso hijo. NO va en NODE_OPTIONS del servicio: Railway usa las variables
 * también en el build, y un tope chico dejó sin memoria a TypeScript (se abortó con 190 MB).
 */
import { spawn } from "node:child_process";
import net from "node:net";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { informe, revisar } from "./revisar-variables.mjs";
import { crearAdminPerezoso } from "./admin-perezoso.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUERTO_WEB = Number(process.env.PORT || 3000);
const PUERTO_API = Number(process.env.API_PUERTO || 4000);
const PUERTO_ADMIN = Number(process.env.ADMIN_PUERTO || 3001);
// Donde escucha el admin de verdad (sólo en 127.0.0.1); el puerto público lo atiende el portero a demanda.
const PUERTO_ADMIN_INTERNO = Number(process.env.ADMIN_PUERTO_INTERNO || 3101);
const decir = (t) => process.stdout.write(`[todo-en-uno] ${t}\n`);

if (new Set([PUERTO_WEB, PUERTO_API, PUERTO_ADMIN, PUERTO_ADMIN_INTERNO]).size !== 4) {
  console.error(`✗ Los puertos tienen que ser distintos: web ${PUERTO_WEB} (PORT), api ${PUERTO_API} (API_PUERTO), admin ${PUERTO_ADMIN} (ADMIN_PUERTO), admin interno ${PUERTO_ADMIN_INTERNO} (ADMIN_PUERTO_INTERNO).\n  Poné PORT=3000 en el servicio.`);
  process.exit(1);
}

// Antes de arrancar nada: las variables. Mejor un error claro acá que cuatro partes cayéndose en el log.
{
  const r = revisar();
  const texto = informe(r);
  if (texto) process.stdout.write(`${texto}\n`);
  if (r.errores.length) process.exit(1);
}

const API_LOCAL = `http://127.0.0.1:${PUERTO_API}`;
for (const [k, v] of [["API_URL", API_LOCAL], ["WEB_INTERNAL_URL", `http://127.0.0.1:${PUERTO_WEB}`]]) {
  if (process.env[k] && process.env[k] !== v) decir(`${k}=${process.env[k]} no se usa en este modo (todo está en el mismo servicio): va ${v}. Podés borrar la variable.`);
}
const comun = { API_URL: API_LOCAL, WEB_INTERNAL_URL: `http://127.0.0.1:${PUERTO_WEB}` };

// "::" escucha en IPv4 e IPv6 (Railway llega por la red pública y por la privada). Donde no hay
// IPv6, escuchar ahí falla (EAFNOSUPPORT): entonces todas las direcciones IPv4.
const TODAS = await new Promise((listo) => {
  const prueba = net.createServer();
  prueba.once("error", () => listo("0.0.0.0"));
  prueba.listen(0, "::", () => prueba.close(() => listo("::")));
});

/*
 * Tope del heap de V8 (--max-old-space-size, en MB) por parte. Es lo que Node puede juntar en objetos de
 * JS antes de dejar de acumular y recolectar basura; el RSS del proceso es más (buffers, sharp, código).
 * Sin tope, Node acumula "porque hay lugar" y el contenedor cobra esa memoria. Los valores salen de lo que
 * cada parte usa en reposo con holgura de 2 a 3 veces (ver entregas/RAILWAY-MEMORIA.md): al acercarse al
 * tope V8 recolecta más seguido (más lento) antes de abortar, así que un pico no tira el proceso de golpe.
 * Si el dueño ya fijó --max-old-space-size en NODE_OPTIONS, se respeta eso y no se agrega nada.
 */
const TOPE_HEAP_MB = { api: 256, worker: 192, web: 320, admin: 256 };
const topeDelDueno = /--max-old-space-size/.test(process.env.NODE_OPTIONS ?? "");
if (topeDelDueno) decir(`aviso: NODE_OPTIONS="${process.env.NODE_OPTIONS}" fija el tope de heap de las cuatro partes (se hereda) y manda sobre los de acá. Si no lo pusiste a propósito, borrá la variable en Railway: también la usa el build y TypeScript se queda sin memoria.`);

const PARTES = {
  api: { dir: "apps/api", archivo: "dist/servidor.js", env: { PORT: String(PUERTO_API), HOST: TODAS } },
  worker: { dir: "apps/worker", archivo: "dist/index.js", env: {} },
  web: { dir: "apps/web", archivo: ".next/standalone/apps/web/server.js", env: { PORT: String(PUERTO_WEB), HOSTNAME: TODAS } },
  admin: { dir: "apps/admin", archivo: ".next/standalone/apps/admin/server.js", env: { PORT: String(PUERTO_ADMIN_INTERNO), HOSTNAME: "127.0.0.1" } },
};

const sinCompilar = Object.entries(PARTES).filter(([, p]) => !existsSync(path.join(RAIZ, p.dir, p.archivo))).map(([n]) => n);
if (sinCompilar.length) {
  console.error(`✗ Falta compilar: ${sinCompilar.join(", ")}. El build tiene que ser  pnpm install --frozen-lockfile && pnpm build\n  (lo hace solo railway.json en la raíz del repo; si en Settings → Build hay un comando propio, borralo).`);
  process.exit(1);
}

let apagando = false;
const vivos = new Map();

function crearHijo(nombre) {
  const p = PARTES[nombre];
  const hijo = spawn(process.execPath, [...(topeDelDueno ? [] : [`--max-old-space-size=${TOPE_HEAP_MB[nombre]}`]), p.archivo], {
    cwd: path.join(RAIZ, p.dir),
    env: { ...process.env, ...comun, ...p.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  vivos.set(nombre, hijo);
  for (const flujo of [hijo.stdout, hijo.stderr]) {
    createInterface({ input: flujo }).on("line", (l) => process.stdout.write(`[${nombre}] ${l}\n`));
  }
  // Si ya hay otro del mismo nombre (un admin nuevo mientras el viejo se iba), no se lo borra.
  hijo.on("exit", () => { if (vivos.get(nombre) === hijo) vivos.delete(nombre); });
  return hijo;
}

function levantar(nombre, intento = 0) {
  if (apagando) return;
  const hijo = crearHijo(nombre);
  const desde = Date.now();
  hijo.on("exit", (codigo, senal) => {
    if (apagando) return;
    // Si anduvo un buen rato, el contador vuelve a cero; si se cae al arrancar, cada vez se espera más (hasta 30 s).
    const siguiente = Date.now() - desde > 60_000 ? 0 : intento + 1;
    const espera = Math.min(30_000, 1000 * 2 ** Math.min(siguiente, 5));
    decir(`${nombre} se detuvo (${senal ?? `código ${codigo}`}): lo vuelvo a levantar en ${espera / 1000} s`);
    setTimeout(() => levantar(nombre, siguiente), espera);
  });
}

async function esperarApi(segundos) {
  for (let i = 0; i < segundos; i++) {
    try { if ((await fetch(`${API_LOCAL}/healthz`, { signal: AbortSignal.timeout(1000) })).ok) return true; } catch { /* todavía no */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

function apagar(senal) {
  if (apagando) return;
  apagando = true;
  decir(`${senal}: apagando todo…`);
  admin.cerrar();
  for (const h of vivos.values()) h.kill("SIGTERM");
  const fin = setTimeout(() => { for (const h of vivos.values()) h.kill("SIGKILL"); process.exit(0); }, 10_000);
  const revisar = setInterval(() => { if (!vivos.size) { clearTimeout(fin); clearInterval(revisar); process.exit(0); } }, 200);
}
// El admin no se levanta ni se reinicia solo: lo arranca el primer pedido al puerto público y se apaga sin uso.
const admin = crearAdminPerezoso({
  puertoInterno: PUERTO_ADMIN_INTERNO,
  decir,
  arrancar: () => {
    if (apagando) throw new Error("apagando");
    decir("admin: primer pedido, lo levanto");
    return crearHijo("admin");
  },
});
admin.servidor.listen(PUERTO_ADMIN, TODAS);
process.on("SIGTERM", () => apagar("SIGTERM"));
process.on("SIGINT", () => apagar("SIGINT"));

decir(`web :${PUERTO_WEB} · api :${PUERTO_API} · admin :${PUERTO_ADMIN} a demanda, interno :${PUERTO_ADMIN_INTERNO} (escuchando en ${TODAS})`);
levantar("api");
// La tienda arranca ya (si la API tarda, muestra los valores de respaldo); el worker y el backoffice, cuando la API contesta.
levantar("web");
if (!(await esperarApi(90))) decir("la api no contesta todavía (¿DATABASE_URL o REDIS_URL?): arranco el resto igual; mirá las líneas [api] de arriba");
levantar("worker");
