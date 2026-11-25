import { randomInt } from "node:crypto";
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

const cuponesSinUsar = async (db: pg.Pool | pg.PoolClient, clienteId: number) =>
  (await db.query<{ codigo: string; nombre: string; hasta: Date | null; minimo: number }>(
    `SELECT codigo, nombre, hasta, minimo FROM tienda.cupones c
      WHERE c.cliente_id = $1 AND c.activo AND c.usos < c.usos_max AND (c.hasta IS NULL OR c.hasta > now())
        AND (c.evento_id IS NULL OR tienda.evento_vigente(c.evento_id)) ORDER BY c.id DESC`, [clienteId])).rows
    .map((r) => ({ codigo: r.codigo, nombre: r.nombre, hasta: r.hasta?.toISOString() ?? null, minimo: r.minimo }));

const ultimoGiro = async (db: pg.Pool | pg.PoolClient, clienteId: number) =>
  (await db.query<{ creado_en: Date }>("SELECT max(creado_en) AS creado_en FROM tienda.ruleta_giros WHERE cliente_id = $1", [clienteId])).rows[0]?.creado_en ?? null;

/** Lo que ve la cuenta de la sesión (nunca la de otra). */
export async function estadoRuleta(pool: pg.Pool, clienteId: number): Promise<RuletaEstado> {
  const [a, ultimo, premios, cupones] = await Promise.all([apertura(pool), ultimoGiro(pool, clienteId), premiosDelSorteo(pool), cuponesSinUsar(pool, clienteId)]);
  const proximo = ultimo ? new Date(ultimo.getTime() + a.config.cadaDias * DIA) : null;
  const esperando = !!proximo && proximo.getTime() > Date.now();
  const motivo = !a.abierta || !premios.length ? "apagada" as const : esperando ? "espera" as const : null;
  return {
    disponible: motivo === null, motivo, proximoGiro: esperando ? proximo!.toISOString() : null, evento: a.porEvento?.nombre ?? null,
    venceDias: a.config.venceDias, premios: premios.map((p) => ({ etiqueta: p.etiqueta, tipo: p.tipo })), cupones,
  };
}

const ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const codigoNuevo = () => `RULETA-${Array.from({ length: 8 }, () => ALFABETO[randomInt(ALFABETO.length)]).join("")}`;

/** Gira por la cuenta de la sesión: valida, sortea, guarda el giro y crea el cupón personal, todo junto. */
export async function girar(pool: pg.Pool, clienteId: number, azar?: (n: number) => number): Promise<RuletaResultado> {
  const cli = await pool.connect();
  try {
    await cli.query("BEGIN");
    // Un giro a la vez por cuenta: dos pedidos juntos no pueden pasar los dos.
    await cli.query("SELECT pg_advisory_xact_lock(hashtext('ruleta'), $1)", [clienteId]);
    const a = await apertura(cli);
    if (!a.abierta) throw new ErrorHttp(409, "ruleta_apagada", "La ruleta no está disponible por ahora.");
    const ultimo = await ultimoGiro(cli, clienteId);
    if (ultimo) {
      const proximo = new Date(ultimo.getTime() + a.config.cadaDias * DIA);
      if (proximo.getTime() > Date.now()) throw new ErrorHttp(409, "ruleta_espera", "Ya giraste esta semana. Volvé a probar más adelante.", { proximoGiro: proximo.toISOString() });
    }
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
            [codigo, nombre, premio.tipo, premio.valor, !(premio.tipo === "porcentaje" || premio.tipo === "segunda_unidad"), premio.minimo, vence, a.porEvento?.id ?? null, clienteId]);
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
      "INSERT INTO tienda.ruleta_giros (cliente_id, premio_id, etiqueta, tipo, cupon_id, evento_id) VALUES ($1, $2, $3, $4, $5, $6)",
      [clienteId, premio.id, premio.etiqueta, premio.tipo, cuponId, a.porEvento?.id ?? null]);
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
