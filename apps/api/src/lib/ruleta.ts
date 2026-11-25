import { createHash, createHmac, randomInt } from "node:crypto";
import type pg from "pg";
import { formatearPesos, type RuletaEstado, type RuletaResultado, type TipoPremio } from "@isu/shared";
import { ErrorHttp } from "./errores.js";

/*
 * Ruleta de descuentos (0037). TODO se decide acá, en el servidor:
 *   · si la ruleta está abierta (prendida a mano, o sola mientras haya un evento vigente);
 *   · si la cuenta ya giró hace menos de `cada_dias` días;
 *   · qué premio sale (sorteo ponderado con la fuente de azar del sistema, nunca la del navegador);
 *   · el cupón: PERSONAL (cupones.cliente_id), de un solo uso, que sólo vale para la cuenta que lo ganó.
 * Quien gira siempre es la cuenta de la sesión: ninguna ruta recibe un id de cliente de afuera.
 */
export interface Premio { id: number; etiqueta: string; tipo: TipoPremio; valor: number; minimo: number; peso: number }
interface Config { manual: boolean; conEventos: boolean; cadaDias: number; venceDias: number }
const DIA = 86_400_000;
/** Giros de invitados que se aceptan por conexión (IP) dentro de la ventana: localStorage se puede borrar, esto no. */
export const GIROS_POR_IP = 3;

/**
 * Quién gira: una cuenta (la de la sesión) o un invitado (el identificador al azar de su navegador + su conexión).
 * Nunca viene un id de cliente de afuera.
 */
export type Quien = { clienteId: number } | { dispositivo: string; ip: string; sal: string };
const hashDe = (t: string) => createHash("sha256").update(t).digest("hex");
const ipHash = (q: { ip: string; sal: string }) => createHmac("sha256", q.sal).update(q.ip).digest("hex");
const esInvitado = (q: Quien): q is Extract<Quien, { dispositivo: string }> => "dispositivo" in q;

const premiosDelSorteo = async (db: pg.Pool | pg.PoolClient): Promise<Premio[]> =>
  (await db.query<Premio>("SELECT id, etiqueta, tipo, valor, minimo, peso FROM tienda.ruleta_premios WHERE activo AND peso > 0 ORDER BY orden, id")).rows;

/** El premio sorteado: ponderado por el peso. `azar(n)` devuelve un entero de 0 a n-1 (en producción, criptográfico). */
export function elegirPremio(premios: Premio[], azar: (n: number) => number = (n) => randomInt(n)): { premio: Premio; indice: number } {
  const total = premios.reduce((s, p) => s + p.peso, 0);
  if (total <= 0) throw new ErrorHttp(409, "sin_premios", "La ruleta no tiene premios por ahora.");
  let x = azar(total);
  for (const [indice, premio] of premios.entries()) {
    if (x < premio.peso) return { premio, indice };
    x -= premio.peso;
  }
  throw new Error("sorteo fuera de rango");
}

async function apertura(db: pg.Pool | pg.PoolClient) {
  const c = (await db.query<{ manual: boolean; con_eventos: boolean; cada_dias: number; vence_dias: number }>("SELECT manual, con_eventos, cada_dias, vence_dias FROM tienda.ruleta WHERE id = 1")).rows[0]!;
  const config: Config = { manual: c.manual, conEventos: c.con_eventos, cadaDias: c.cada_dias, venceDias: c.vence_dias };
  const ev = (await db.query<{ id: number; nombre: string; hasta: Date | null }>("SELECT id, nombre, hasta FROM tienda.eventos WHERE tienda.evento_vigente(id) LIMIT 1")).rows[0] ?? null;
  // Abierta por un evento sólo si no está prendida a mano: a mano, el cupón no depende de ningún evento.
  const porEvento = !config.manual && config.conEventos ? ev : null;
  return { config, abierta: config.manual || !!porEvento, porEvento };
}

/** ¿Hay una ruleta abierta ahora (a mano o por un evento vigente)? Es público: no lleva datos de nadie. */
export async function ruletaAbierta(db: pg.Pool): Promise<{ abierta: boolean; evento: string | null; cadaDias: number; venceDias: number }> {
  const a = await apertura(db);
  const hayPremios = (await db.query("SELECT 1 FROM tienda.ruleta_premios WHERE activo AND peso > 0 LIMIT 1")).rowCount! > 0;
  return { abierta: a.abierta && hayPremios, evento: a.porEvento?.nombre ?? null, cadaDias: a.config.cadaDias, venceDias: a.config.venceDias };
}

export const cuponesDe = async (db: pg.Pool | pg.PoolClient, q: Quien) =>
  (await db.query<{ codigo: string; nombre: string; hasta: Date | null; minimo: number }>(
    `SELECT c.codigo, c.nombre, c.hasta, c.minimo FROM tienda.cupones c
      WHERE ${esInvitado(q) ? "c.id IN (SELECT cupon_id FROM tienda.ruleta_giros WHERE dispositivo = $1 AND cupon_id IS NOT NULL)" : "c.cliente_id = $1"}
        AND c.activo AND c.usos < c.usos_max AND (c.hasta IS NULL OR c.hasta > now())
        AND (c.evento_id IS NULL OR tienda.evento_vigente(c.evento_id)) ORDER BY c.id DESC`, [esInvitado(q) ? hashDe(q.dispositivo) : q.clienteId])).rows
    .map((r) => ({ codigo: r.codigo, nombre: r.nombre, hasta: r.hasta?.toISOString() ?? null, minimo: r.minimo }));

const ultimoGiro = async (db: pg.Pool | pg.PoolClient, q: Quien) =>
  (await db.query<{ creado_en: Date }>(
    `SELECT max(creado_en) AS creado_en FROM tienda.ruleta_giros WHERE ${esInvitado(q) ? "dispositivo = $1" : "cliente_id = $1"}`, [esInvitado(q) ? hashDe(q.dispositivo) : q.clienteId])).rows[0]?.creado_en ?? null;

/** Para un invitado: cuándo se libera su conexión, si ya se llegó al tope de giros por IP en la ventana (null = no hay tope). */
async function liberaIp(db: pg.Pool | pg.PoolClient, q: Quien, cadaDias: number): Promise<Date | null> {
  if (!esInvitado(q)) return null;
  const { rows } = await db.query<{ creado_en: Date }>(
    "SELECT creado_en FROM tienda.ruleta_giros WHERE ip_hash = $1 AND creado_en > now() - make_interval(days => $2) ORDER BY creado_en DESC LIMIT $3", [ipHash(q), cadaDias, GIROS_POR_IP]);
  return rows.length >= GIROS_POR_IP ? new Date(rows[rows.length - 1]!.creado_en.getTime() + cadaDias * DIA) : null;
}

/** Lo que ve quien consulta (su cuenta o su dispositivo; nunca los de otro). */
export async function estadoRuleta(pool: pg.Pool, q: Quien): Promise<RuletaEstado> {
  const [a, ultimo, premios, cupones] = await Promise.all([apertura(pool), ultimoGiro(pool, q), premiosDelSorteo(pool), cuponesDe(pool, q)]);
  const propio = ultimo ? new Date(ultimo.getTime() + a.config.cadaDias * DIA) : null;
  const ip = await liberaIp(pool, q, a.config.cadaDias);
  const proximo = [propio, ip].filter((d): d is Date => !!d && d.getTime() > Date.now()).sort((x, y) => y.getTime() - x.getTime())[0] ?? null;
  const motivo = !a.abierta || !premios.length ? "apagada" as const : proximo ? "espera" as const : null;
  return {
    disponible: motivo === null, motivo, proximoGiro: proximo?.toISOString() ?? null, evento: a.porEvento?.nombre ?? null,
    venceDias: a.config.venceDias, premios: premios.map((p) => ({ etiqueta: p.etiqueta, tipo: p.tipo })), cupones,
  };
}

const ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const codigoNuevo = () => `RULETA-${Array.from({ length: 8 }, () => ALFABETO[randomInt(ALFABETO.length)]).join("")}`;

/** Gira por la cuenta de la sesión: valida, sortea, guarda el giro y crea el cupón personal, todo junto. */
export async function girar(pool: pg.Pool, q: Quien, azar?: (n: number) => number): Promise<RuletaResultado> {
  const cli = await pool.connect();
  try {
    await cli.query("BEGIN");
    // Un giro a la vez por cuenta: dos pedidos juntos no pueden pasar los dos.
    await cli.query("SELECT pg_advisory_xact_lock(hashtext('ruleta'), $1)", [esInvitado(q) ? Number.parseInt(hashDe(q.dispositivo).slice(0, 7), 16) : q.clienteId]);
    const a = await apertura(cli);
    if (!a.abierta) throw new ErrorHttp(409, "ruleta_apagada", "La ruleta no está disponible por ahora.");
    const ultimo = await ultimoGiro(cli, q);
    if (ultimo) {
      const proximo = new Date(ultimo.getTime() + a.config.cadaDias * DIA);
      if (proximo.getTime() > Date.now()) throw new ErrorHttp(409, "ruleta_espera", "Ya giraste esta semana. Volvé a probar más adelante.", { proximoGiro: proximo.toISOString() });
    }
    const libera = await liberaIp(cli, q, a.config.cadaDias);
    if (libera && libera.getTime() > Date.now()) throw new ErrorHttp(409, "ruleta_espera", "Desde esta conexión ya se giró varias veces esta semana. Ingresá a tu cuenta para girar la tuya.", { proximoGiro: libera.toISOString() });
    const premios = await premiosDelSorteo(cli);
    const { premio, indice } = elegirPremio(premios, azar);

    let cupon: RuletaResultado["cupon"] = null;
    let cuponId: number | null = null;
    if (premio.tipo !== "nada") {
      // Vence a los `vence_dias`, y nunca después de que termine el evento que abrió la ruleta.
      let vence = new Date(Date.now() + a.config.venceDias * DIA);
      if (a.porEvento?.hasta && a.porEvento.hasta < vence) vence = a.porEvento.hasta;
      const nombre = `Ruleta: ${premio.etiqueta}`.slice(0, 80);
      for (let intento = 0; ; intento++) {
        const codigo = codigoNuevo();
        try {
          const r = await cli.query<{ id: number }>(
            `INSERT INTO tienda.cupones (codigo, nombre, automatico, tipo, valor, alcance, sobre_rebajas, acumula, minimo, hasta, usos_max, activo, creado_por, evento_id, cliente_id)
             VALUES ($1, $2, false, $3, $4, 'todo', true, $5, $6, $7, 1, true, 'ruleta', $8, $9) RETURNING id`,
            [codigo, nombre, premio.tipo, premio.valor, !(premio.tipo === "porcentaje" || premio.tipo === "segunda_unidad"), premio.minimo, vence, a.porEvento?.id ?? null, esInvitado(q) ? null : q.clienteId]);
          cuponId = r.rows[0]!.id;
          cupon = { codigo, nombre, hasta: vence.toISOString(), minimo: premio.minimo };
          break;
        } catch (e) {
          if ((e as { code?: string }).code !== "23505" || intento >= 4) throw e;
          // Se pisó con otro código (casi imposible): se prueba con otro.
          await cli.query("SELECT 1");
        }
      }
    }
    await cli.query(
      "INSERT INTO tienda.ruleta_giros (cliente_id, dispositivo, ip_hash, premio_id, etiqueta, tipo, cupon_id, evento_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [esInvitado(q) ? null : q.clienteId, esInvitado(q) ? hashDe(q.dispositivo) : null, esInvitado(q) ? ipHash(q) : null, premio.id, premio.etiqueta, premio.tipo, cuponId, a.porEvento?.id ?? null]);
    await cli.query("COMMIT");
    return {
      indice, premio: { etiqueta: premio.etiqueta, tipo: premio.tipo }, cupon,
      proximoGiro: new Date(Date.now() + a.config.cadaDias * DIA).toISOString(),
    };
  } catch (e) {
    await cli.query("ROLLBACK").catch(() => {});
    throw e;
  } finally { cli.release(); }
}

/** Cómo se lee el premio en el backoffice. */
export const detallePremio = (p: { tipo: TipoPremio; valor: number; minimo: number }) =>
  `${p.tipo === "porcentaje" ? `${p.valor}% OFF` : p.tipo === "monto" ? `${formatearPesos(p.valor)} OFF` : p.tipo === "envio_gratis" ? "Envío gratis" : p.tipo === "segunda_unidad" ? `2da unidad al ${p.valor}%` : "Sin premio"}${p.minimo > 0 ? ` desde ${formatearPesos(p.minimo)}` : ""}`;
