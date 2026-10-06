import { randomInt } from "node:crypto";
import type pg from "pg";
import type { FastifyBaseLogger } from "fastify";
import { ESTADOS_PENDIENTES, formatearPesos, formatearPesosExactos } from "@isu/shared";
import { ErrorMp, type MercadoPago, type PagoMp } from "../../lib/mercadopago.js";
import { ErrorTalo, resumirPagoTalo, type PagoTalo, type Talo } from "../../lib/talo.js";
import { ErrorHttp } from "../../lib/errores.js";

/*
 * Transferencias que se confirman solas (migración 0014).
 *
 * Al crear un pedido por transferencia se decide a dónde transfiere:
 *   1. Talo prendido y configurado → un CVU y alias propios del pedido.
 *   2. Si no (o si Talo no responde) y Mercado Pago prendido → los datos de
 *      Ajustes (la cuenta de MP de la tienda) con un monto de centavos únicos.
 *   3. Si no, los datos de Ajustes y se confirma a mano (como siempre).
 *
 * La plata que entra se busca de tres maneras, todas idempotentes:
 *   · el aviso de Talo / de Mercado Pago (al instante),
 *   · la página del pedido abierta (cada 20 s como mucho),
 *   · el worker cada 2 minutos (por si se perdió un aviso).
 * Nunca se cree un aviso: se le pregunta a Talo o a Mercado Pago con la
 * credencial de la tienda.
 */
export interface AjusteTransferenciasAuto { talo: boolean; mercadoPago: boolean }

export interface PedidoParaTransferir {
  id: number; numero: string; total: number; estado: string; nombre: string; apellido: string; email: string; dni: string;
}

type Pagar = (numero: string, pago: { proveedor: "transferencia"; externo: string; monto: number; detalle?: object; quien: string }) =>
  Promise<{ numero: string; estado: string; repetido: boolean; insuficiente: boolean }>;
type Evento = (db: pg.Pool | pg.PoolClient, pedidoId: number, estado: string, actor: string, detalle?: string) => Promise<void>;

/** Estados en los que el pedido todavía espera la transferencia. */
const ESPERANDO = ["esperando_transferencia", "transferencia_informada"];
/** Lo que entra a la cuenta de MP y nunca es una transferencia de un cliente (ventas con QR/Point del local, suscripciones…). */
const NO_SON_TRANSFERENCIAS = new Set(["pos_payment", "recurring_payment", "cellphone_recharge", "investment", "payment_addition", "card_validation"]);
const MEDIOS_TRANSFERENCIA = new Set(["account_money", "bank_transfer"]);

export async function leerAjusteTransferencias(pool: pg.Pool): Promise<AjusteTransferenciasAuto> {
  const v = (await pool.query<{ valor: Partial<AjusteTransferenciasAuto> | null }>("SELECT valor FROM tienda.ajustes WHERE clave = 'transferenciasAuto'")).rows[0]?.valor;
  return { talo: v?.talo === true, mercadoPago: v?.mercadoPago === true };
}

export function crearTransferencias(deps: {
  pool: pg.Pool; mp: MercadoPago | null; talo: Talo | null; log: FastifyBaseLogger; apiPublica: string; pagar: Pagar; evento: Evento;
}) {
  const { pool, log } = deps;

  /** Elige a dónde transfiere este pedido y lo anota. Nunca falla por Talo o MP: en el peor caso, a mano. */
  async function asignar(p: PedidoParaTransferir): Promise<void> {
    const a = await leerAjusteTransferencias(pool);
    if (a.talo && deps.talo) {
      try {
        const t = await deps.talo.crearPago({
          numero: p.numero, monto: p.total, motivo: `Isuwaya · pedido ${p.numero}`,
          aviso: `${deps.apiPublica.replace(/\/+$/, "")}/v1/pagos/talo/aviso`,
          cliente: { nombre: p.nombre, apellido: p.apellido, email: p.email, dni: p.dni },
        });
        await pool.query(
          `UPDATE tienda.pedidos SET transferencia_via = 'talo', transferencia_monto = $2, talo_pago = $3, talo_cvu = $4, talo_alias = $5, actualizado_en = now()
            WHERE id = $1`, [p.id, p.total, t.id, t.cvu, t.alias]);
        return;
      } catch (e) {
        log.error({ err: (e as Error).message, pedido: p.numero }, "Talo no pudo crear el cobro: se dan los datos de Ajustes");
        await deps.evento(pool, p.id, p.estado, "talo", "Talo no respondió: se dieron los datos para transferir de Ajustes").catch(() => {});
      }
    }
    if (a.mercadoPago && deps.mp) {
      for (let intento = 0; intento < 8; intento++) {
        const monto = await montoUnico(p.total);
        if (monto === null) break;
        try {
          await pool.query("UPDATE tienda.pedidos SET transferencia_via = 'mercadopago', transferencia_monto = $2, actualizado_en = now() WHERE id = $1", [p.id, monto]);
          return;
        } catch (e) {
          // Otro pedido tomó el mismo monto en el mismo instante: se elige otro.
          if ((e as { code?: string }).code !== "23505") throw e;
        }
      }
      log.warn({ pedido: p.numero }, "no quedan montos únicos libres para este total: se confirma a mano");
    }
    await pool.query("UPDATE tienda.pedidos SET transferencia_via = 'cuenta', transferencia_monto = $2, actualizado_en = now() WHERE id = $1", [p.id, p.total]);
  }

  /**
   * El total más unos centavos que ningún otro pedido esperando (o vencido
   * hace poco) tiene: $45.000,00 → $45.000,37. Primero de 1 a 99 centavos y,
   * si se agotaran, hasta $9,99.
   */
  async function montoUnico(total: number): Promise<number | null> {
    const { rows } = await pool.query<{ m: number }>(
      `SELECT transferencia_monto AS m FROM tienda.pedidos
        WHERE transferencia_via = 'mercadopago' AND transferencia_monto BETWEEN $1 AND $2
          AND (estado = ANY($3::text[]) OR (estado IN ('vencido', 'cancelado') AND actualizado_en > now() - interval '3 days'))`,
      [total + 1, total + 999, ESPERANDO]);
    const usados = new Set(rows.map((r) => r.m));
    for (const [desde, hasta] of [[1, 99], [100, 999]] as const) {
      const libres: number[] = [];
      for (let c = desde; c <= hasta; c++) if (!usados.has(total + c)) libres.push(total + c);
      if (libres.length) return libres[randomInt(libres.length)]!;
    }
    return null;
  }

  // ── Talo ──────────────────────────────────────────────────────────

  /** Pregunta a Talo por el cobro de un pedido (o de todos los que esperan) y aplica lo que llegó. */
  async function conciliarTalo(pedidoId?: number) {
    if (!deps.talo) return { revisados: 0, pagados: 0 };
    const { rows } = await pool.query<{ id: number; numero: string; total: number; estado: string; talo_pago: string }>(
      `SELECT id, numero, total, estado, talo_pago FROM tienda.pedidos
        WHERE transferencia_via = 'talo' AND talo_pago IS NOT NULL ${pedidoId ? "AND id = $2" : ""}
          AND (estado = ANY($1::text[]) OR (estado = 'vencido' AND actualizado_en > now() - interval '2 days'))
        ORDER BY creado_en LIMIT 100`, pedidoId ? [ESPERANDO, pedidoId] : [ESPERANDO]);
    let pagados = 0;
    for (const r of rows) {
      try {
        const pago = await deps.talo.pago(r.talo_pago);
        if (await aplicarTalo(r, pago)) pagados++;
      } catch (e) {
        log.warn({ err: (e as Error).message, pedido: r.numero }, "no se pudo consultar el cobro en Talo; se reintenta");
        if (!(e instanceof ErrorTalo)) throw e;
      }
    }
    return { revisados: rows.length, pagados };
  }

  async function aplicarTalo(r: { id: number; numero: string; total: number; estado: string; talo_pago: string }, pago: PagoTalo): Promise<boolean> {
    // Que sea de verdad el cobro de ESE pedido.
    if (pago.id !== r.talo_pago || (pago.external_id && pago.external_id !== r.numero)) {
      log.warn({ pedido: r.numero, talo: pago.id }, "Talo devolvió un pago que no es el de este pedido: se ignora");
      return false;
    }
    const t = resumirPagoTalo(pago);
    const completo = t.estado === "SUCCESS" || t.estado === "OVERPAID";
    let nuevas = 0;
    for (const x of t.transferencias) {
      const ins = await pool.query(
        `INSERT INTO tienda.transferencias_recibidas (via, externo, monto, pagador, pagador_cuit, recibida_en, pedido_id, estado)
         VALUES ('talo', $1, $2, $3, $4, COALESCE($5::timestamptz, now()), $6, $7)
         ON CONFLICT (via, externo) DO UPDATE SET estado = EXCLUDED.estado
           WHERE tienda.transferencias_recibidas.estado = 'monto_distinto' AND EXCLUDED.estado = 'aplicada'
         RETURNING (xmax = 0) AS nueva`,
        [x.id.slice(0, 120), x.monto, x.pagador?.slice(0, 150) ?? null, soloCuit(x.cuit), fechaValida(x.fecha), r.id, completo ? "aplicada" : "monto_distinto"]);
      if (ins.rows[0]?.nueva) nuevas++;
    }
    if (completo) {
      const res = await deps.pagar(r.numero, {
        proveedor: "transferencia", externo: `talo:${pago.id}`.slice(0, 80), monto: t.recibido || r.total,
        detalle: { via: "talo", estado: t.estado, transferencias: t.transferencias }, quien: "talo",
      });
      return !res.repetido && !res.insuficiente;
    }
    if (t.estado === "UNDERPAID" && nuevas > 0) {
      await deps.evento(pool, r.id, r.estado, "talo", `Llegó ${formatearPesos(t.recibido)} de ${formatearPesos(r.total)}: falta ${formatearPesos(r.total - t.recibido)}. Revisar en Transferencias.`);
    }
    return false;
  }

  // ── Mercado Pago (transferencias al alias de la cuenta) ───────────

  /**
   * ¿Hay pedidos que pidieron transferir a la cuenta de MP y todavía esperan (o vencieron hace poco)?
   * No depende del ajuste: apagarlo cambia los pedidos nuevos, pero los que ya pidieron centavos se siguen confirmando.
   */
  async function hayEsperandoMp() {
    const r = await pool.query(
      `SELECT 1 FROM tienda.pedidos WHERE transferencia_via = 'mercadopago'
          AND (estado = ANY($1::text[]) OR (estado = 'vencido' AND actualizado_en > now() - interval '2 days')) LIMIT 1`, [ESPERANDO]);
    return !!r.rowCount;
  }

  /** Repasa lo que entró a la cuenta de MP, sólo si hay pedidos esperando una transferencia ahí. */
  async function conciliarMp() {
    if (!deps.mp || !(await hayEsperandoMp())) return { revisados: 0, pagados: 0 };
    let pagos: PagoMp[];
    try {
      pagos = await deps.mp.ingresosRecientes(3);
    } catch (e) {
      if (e instanceof ErrorMp) { log.warn({ err: e.message }, "no se pudo leer lo que entró a Mercado Pago; se reintenta"); return { revisados: 0, pagados: 0 }; }
      throw e;
    }
    let pagados = 0;
    for (const pago of pagos) {
      const r = await aplicarIngresoMp(pago, "mercadopago (cuenta)").catch((e) => { log.warn({ err: (e as Error).message, pago: pago.id }, "ingreso de MP no aplicado"); return null; });
      if (r?.aplicado) pagados++;
    }
    return { revisados: pagos.length, pagados };
  }

  /** Una plata que entró a la cuenta de MP sin número de pedido: ¿es la transferencia de algún pedido? */
  async function aplicarIngresoMp(pago: PagoMp, quien: string): Promise<{ aplicado: boolean; motivo: string | null }> {
    if (pago.status !== "approved" || pago.currency_id !== "ARS") return { aplicado: false, motivo: "no_aprobado" };
    // Sin pedidos esperando una transferencia a la cuenta, lo que entra no es asunto de la tienda (ni se anota).
    if (!(await hayEsperandoMp())) return { aplicado: false, motivo: "nadie_espera" };
    // Los cobros del checkout traen el número de pedido: esos los aplica aplicarPagoMp.
    if (pago.external_reference) return { aplicado: false, motivo: "con_referencia" };
    if (pago.operation_type && NO_SON_TRANSFERENCIAS.has(pago.operation_type)) return { aplicado: false, motivo: "no_es_transferencia" };
    if (pago.payment_type_id && !MEDIOS_TRANSFERENCIA.has(pago.payment_type_id)) return { aplicado: false, motivo: "no_es_transferencia" };
    const monto = Math.round(pago.transaction_amount * 100);
    if (monto <= 0) return { aplicado: false, motivo: "monto" };
    const fecha = fechaValida(pago.date_approved ?? pago.date_created ?? null) ?? new Date().toISOString();

    // Un pedido esperando ese monto exacto, creado antes de la transferencia. Si no, uno vencido hace poco (se pagó tarde).
    const buscar = (estados: string) => pool.query<{ id: number; numero: string }>(
      `SELECT id, numero FROM tienda.pedidos
        WHERE transferencia_via = 'mercadopago' AND transferencia_monto = $1 AND creado_en <= $2::timestamptz + interval '5 minutes' AND ${estados}
        LIMIT 2`, [monto, fecha]);
    let c = (await buscar(`estado IN ('esperando_transferencia', 'transferencia_informada')`)).rows;
    if (!c.length) c = (await buscar(`estado = 'vencido' AND actualizado_en > now() - interval '3 days'`)).rows;
    const pedido = c.length === 1 ? c[0]! : null;

    const pagador = [pago.payer?.first_name, pago.payer?.last_name].filter(Boolean).join(" ").trim() || null;
    const ins = await pool.query(
      `INSERT INTO tienda.transferencias_recibidas (via, externo, monto, pagador, pagador_cuit, recibida_en, pedido_id, estado)
       VALUES ('mercadopago', $1, $2, $3, $4, $5, $6, $7) ON CONFLICT (via, externo) DO NOTHING RETURNING id`,
      [pago.id, monto, pagador?.slice(0, 150) ?? null, soloCuit(pago.payer?.identification?.number), fecha, pedido?.id ?? null, pedido ? "aplicada" : "sin_pedido"]);
    // Ya vista (otro aviso o la vuelta anterior): nada más que hacer.
    if (!ins.rowCount) return { aplicado: false, motivo: "ya_vista" };
    if (!pedido) return { aplicado: false, motivo: "sin_pedido" };
    const r = await deps.pagar(pedido.numero, {
      proveedor: "transferencia", externo: `mp:${pago.id}`, monto, quien,
      detalle: { via: "mercadopago", pago: pago.id, pagador, tipo: pago.operation_type ?? null },
    });
    return { aplicado: !r.repetido && !r.insuficiente, motivo: null };
  }

  // ── Backoffice: lo que no se pudo asignar solo ────────────────────

  /** Asigna a mano una transferencia recibida a un pedido (la persona vio que es de ese cliente). */
  async function asignarAMano(id: number, numero: string, quien: string) {
    const t = (await pool.query<{ id: number; via: string; externo: string; monto: number; estado: string }>(
      "SELECT id, via, externo, monto, estado FROM tienda.transferencias_recibidas WHERE id = $1", [id])).rows[0];
    if (!t) throw new ErrorHttp(404, "no_encontrado", "No existe esa transferencia.");
    if (!["sin_pedido", "monto_distinto"].includes(t.estado)) throw new ErrorHttp(409, "ya_resuelta", "Esa transferencia ya está resuelta.");
    const p = (await pool.query<{ id: number; total: number; estado: string }>("SELECT id, total, estado FROM tienda.pedidos WHERE numero = $1", [numero])).rows[0];
    if (!p) throw new ErrorHttp(404, "no_encontrado", "No existe ese pedido.");
    // A uno ya cobrado, no: sería cobrarlo dos veces.
    if (!([...ESTADOS_PENDIENTES, "vencido", "cancelado"] as string[]).includes(p.estado)) {
      throw new ErrorHttp(409, "ya_pagado", `El pedido ${numero} ya no está esperando un pago (está «${p.estado}»).`);
    }
    const r = await deps.pagar(numero, {
      proveedor: "transferencia", externo: `${t.via === "talo" ? "talo-trx" : "mp"}:${t.externo}`.slice(0, 80), monto: t.monto, quien,
      detalle: { via: t.via, asignadaAMano: true },
    });
    if (r.insuficiente) {
      throw new ErrorHttp(409, "no_alcanza", `Esa transferencia es de ${formatearPesosExactos(t.monto)} y el pedido es de ${formatearPesos(p.total)}. Quedó anotada en el pedido; registrá el resto desde el pedido cuando llegue.`);
    }
    await pool.query(
      "UPDATE tienda.transferencias_recibidas SET estado = 'aplicada', pedido_id = $2, resuelta_por = $3, resuelta_en = now() WHERE id = $1",
      [id, p.id, quien.slice(0, 150)]);
    return { ...r, transferencia: id };
  }

  async function descartar(id: number, nota: string | null, quien: string) {
    const r = await pool.query(
      `UPDATE tienda.transferencias_recibidas SET estado = 'descartada', nota = $2, resuelta_por = $3, resuelta_en = now()
        WHERE id = $1 AND estado IN ('sin_pedido', 'monto_distinto') RETURNING id`, [id, nota, quien.slice(0, 150)]);
    if (!r.rowCount) throw new ErrorHttp(404, "no_encontrado", "No existe esa transferencia o ya está resuelta.");
    return { ok: true };
  }

  /** La vuelta del worker (cada 2 minutos). */
  async function conciliar() {
    const [talo, mp] = await Promise.all([conciliarTalo(), conciliarMp()]);
    return { talo, mercadoPago: mp };
  }

  return { asignar, conciliar, conciliarTalo, conciliarMp, aplicarIngresoMp, asignarAMano, descartar, taloActivo: !!deps.talo };
}
export type Transferencias = ReturnType<typeof crearTransferencias>;

/** Sólo el número del CUIT/CUIL/DNI (lo demás no se guarda). */
function soloCuit(v: string | null | undefined): string | null {
  const d = (v ?? "").replace(/\D/g, "");
  return d.length >= 7 && d.length <= 11 ? d : null;
}

function fechaValida(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
