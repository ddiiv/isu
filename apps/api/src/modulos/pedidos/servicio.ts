import type pg from "pg";
import type { FastifyBaseLogger } from "fastify";
import { ErrorStocker, type ClienteStocker } from "@isu/stocker";
import { ESTADOS_PENDIENTES, formatearPesos, type MedioPago, type PedidoNuevo, type PedidoPublico } from "@isu/shared";
import { ErrorHttp } from "../../lib/errores.js";
import { sha256, tokenNuevo } from "../../lib/cripto.js";
import type { Colas } from "../../lib/colas.js";
import { ErrorMp, type MercadoPago, type PagoMp } from "../../lib/mercadopago.js";
import { cotizar, leerAjustes, type Ajustes } from "./cotizar.js";
import type { Descuentos } from "../../lib/descuentos.js";

/*
 * Pedidos: de "Confirmar compra" a "pagado".
 *
 *   1. Se recalcula el carrito (precio, stock, descuento, envío, mínimo).
 *   2. Se guarda el pedido como `reservando` (queda registro aunque falle lo que sigue).
 *   3. Stocker aparta la mercadería por su cola de ventas online (la misma de
 *      ML y Jumpseller). Si otro canal vendió antes, el pedido queda `sin_stock`
 *      y el cliente ve qué faltó. Sin reserva NO se cobra.
 *   4. Según el medio de pago: link de Mercado Pago, datos para transferir,
 *      o "pagás al retirar". Con un vencimiento: si no paga a tiempo, se
 *      devuelve lo apartado (`vencer`).
 *   5. Cuando se cobra (aviso de MP, registro de transferencia o cobro en el
 *      local), `pagar` lo marca y le avisa a Stocker, que recién ahí deja
 *      despachar.
 */
export interface DepsPedidos {
  pool: pg.Pool;
  stocker: ClienteStocker | null;
  mp: MercadoPago | null;
  colas: Colas;
  sitio: string;
  apiPublica: string;
  log: FastifyBaseLogger;
  descuentos?: Descuentos;
}

const ESTADO_INICIAL: Record<MedioPago, string> = {
  mercadopago: "esperando_pago",
  pagofacil: "esperando_pago",
  transferencia: "esperando_transferencia",
  local: "a_pagar_en_local",
};
const HORAS: Record<MedioPago, keyof Ajustes> = {
  mercadopago: "horasPagoOnline", pagofacil: "horasPagoFacil", transferencia: "horasTransferencia", local: "horasPagoLocal",
};
const NOMBRE_MEDIO: Record<MedioPago, string> = {
  mercadopago: "Mercado Pago", pagofacil: "Pago Fácil / Rapipago", transferencia: "Transferencia", local: "Pago en el local",
};
const pesos = (c: number) => Math.round(c) / 100;
const vence = (d: Date) => d.toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

interface FilaPedido {
  id: number; numero: string; acceso_hash: string; cliente_id: number | null; email: string; nombre: string; apellido: string;
  telefono: string; dni: string; entrega: "envio" | "retiro"; direccion: PedidoPublico["direccion"]; local_retiro: string | null;
  medio_pago: MedioPago; subtotal: number; descuento: number; envio: number; total: number; estado: string;
  vence_en: Date | null; pagado_en: Date | null; mp_preferencia: string | null; creado_en: Date;
}

async function evento(db: pg.Pool | pg.PoolClient, pedidoId: number, estado: string, actor: string, detalle?: string) {
  await db.query("INSERT INTO tienda.pedido_eventos (pedido_id, estado, detalle, actor) VALUES ($1, $2, $3, $4)", [pedidoId, estado, detalle?.slice(0, 500) ?? null, actor.slice(0, 150)]);
}

export function crearServicioPedidos(deps: DepsPedidos) {
  const { pool } = deps;
  const urlPedido = (numero: string, acceso: string) => `${deps.sitio.replace(/\/+$/, "")}/pedido/${numero}#c=${acceso}`;

  async function stockerOError(): Promise<ClienteStocker> {
    if (!deps.stocker) throw new ErrorHttp(503, "sin_stocker", "La tienda no puede confirmar el stock en este momento. Probá en unos minutos.");
    return deps.stocker;
  }

  /** Link de pago de Mercado Pago (tarjeta) o de Pago Fácil / Rapipago (efectivo). */
  async function linkDePago(p: FilaPedido, _acceso: string | null): Promise<string | null> {
    if (!["mercadopago", "pagofacil"].includes(p.medio_pago)) return null;
    if (!deps.mp) throw new ErrorHttp(503, "sin_mercadopago", "El pago online no está disponible en este momento. Elegí transferencia o escribinos por WhatsApp.");
    const items = await pool.query<{ sku: string; nombre: string; color: string | null; talle: string | null; precio: number; cantidad: number }>(
      "SELECT sku, nombre, color, talle, precio, cantidad FROM tienda.pedido_items WHERE pedido_id = $1 ORDER BY id", [p.id],
    );
    const lineas = items.rows.map((i) => ({
      id: i.sku, title: [i.nombre, i.color, i.talle].filter(Boolean).join(" · ").slice(0, 250),
      quantity: i.cantidad, unit_price: pesos(i.precio), currency_id: "ARS" as const,
    }));
    if (p.envio > 0) lineas.push({ id: "ENVIO", title: "Envío a domicilio", quantity: 1, unit_price: pesos(p.envio), currency_id: "ARS" });
    const pref = await deps.mp.crearPreferencia({
      numero: p.numero, items: lineas, email: p.email, nombre: p.nombre, apellido: p.apellido,
      // La vuelta de Mercado Pago NO lleva el token de acceso al pedido: no tiene por qué
      // conocerlo un tercero. El navegador lo guardó al crear el pedido.
      vuelta: `${deps.sitio.replace(/\/+$/, "")}/pedido/${p.numero}`,
      aviso: `${deps.apiPublica.replace(/\/+$/, "")}/v1/pagos/mercadopago/aviso`,
      vence: p.vence_en ?? new Date(Date.now() + 2 * 3600_000),
      soloEfectivo: p.medio_pago === "pagofacil",
    });
    await pool.query("UPDATE tienda.pedidos SET mp_preferencia = $2, actualizado_en = now() WHERE id = $1", [p.id, pref.id]);
    return pref.url;
  }

  async function crear(datos: PedidoNuevo, ctx: { clienteId: number | null; ip: string }) {
    const a = await leerAjustes(pool);
    const { entrega, medioPago, contacto } = datos;
    if (medioPago === "local" && entrega.tipo !== "retiro") throw new ErrorHttp(400, "validacion", "El pago en el local es sólo para retirar en el local.");
    if (entrega.tipo === "retiro" && !a.locales.some((l) => l.retiro && l.nombre === entrega.local)) {
      throw new ErrorHttp(400, "validacion", "Elegí un local de retiro de la lista.");
    }
    if (medioPago === "transferencia" && !a.datosTransferencia.cbu && !a.datosTransferencia.alias) {
      throw new ErrorHttp(400, "sin_transferencia", "La transferencia todavía no está disponible. Elegí otro medio de pago.");
    }
    const c = await cotizar(pool, datos.items, { entrega: entrega.tipo, medioPago, ajustes: a, descuentos: deps.descuentos });
    if (c.problemas.length) {
      throw new ErrorHttp(409, "carrito_cambio", c.problemas[0]!.mensaje, { problemas: c.problemas });
    }
    const stocker = await stockerOError();

    // El cliente queda registrado aunque no tenga cuenta: así sus pedidos aparecen si después se registra.
    const clienteId = ctx.clienteId ?? (await pool.query<{ id: number }>(
      `INSERT INTO tienda.clientes (email, nombre, apellido, telefono, dni) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO UPDATE SET telefono = COALESCE(tienda.clientes.telefono, EXCLUDED.telefono),
         dni = COALESCE(tienda.clientes.dni, EXCLUDED.dni) RETURNING id`,
      [contacto.email, contacto.nombre, contacto.apellido, contacto.telefono, contacto.dni],
    )).rows[0]!.id;

    const acceso = tokenNuevo(24);
    const cli = await pool.connect();
    let p: FilaPedido;
    try {
      await cli.query("BEGIN");
      p = (await cli.query<FilaPedido>(
        `INSERT INTO tienda.pedidos (acceso_hash, cliente_id, email, nombre, apellido, telefono, dni, entrega, direccion, local_retiro,
                                     medio_pago, subtotal, descuento, envio, total, estado, notas, ip)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'reservando',$16,$17) RETURNING *`,
        [sha256(acceso), clienteId, contacto.email, contacto.nombre, contacto.apellido, contacto.telefono, contacto.dni,
          entrega.tipo, entrega.tipo === "envio" ? JSON.stringify(entrega.direccion) : null, entrega.tipo === "retiro" ? entrega.local : null,
          medioPago, c.subtotal, c.descuento, c.envio, c.total, datos.notas ?? null, ctx.ip],
      )).rows[0]!;
      for (const l of c.lineas) {
        await cli.query(
          "INSERT INTO tienda.pedido_items (pedido_id, sku, producto_id, nombre, color, talle, precio, precio_lista, cantidad) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [p.id, l.sku, c.filas.get(l.sku)?.producto_id ?? null, l.nombre, l.color, l.talle, l.precio, l.precioLista, l.cantidad],
        );
      }
      await evento(cli, p.id, "reservando", "tienda", `${NOMBRE_MEDIO[medioPago]} · ${formatearPesos(c.total)}`);
      await cli.query("COMMIT");
    } catch (e) {
      await cli.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      cli.release();
    }

    // ── Reserva en Stocker ──
    const horas = a[HORAS[medioPago]] as number;
    const venceEn = new Date(Date.now() + horas * 3600_000);
    let r;
    try {
      r = await stocker.crearPedido({
        pedido: p.numero,
        items: c.lineas.map((l) => ({ sku: l.sku, cantidad: l.cantidad, precioUnitario: pesos(l.precio) })),
        comprador: { nombre: `${contacto.nombre} ${contacto.apellido}`, email: contacto.email, documento: contacto.dni },
        total: pesos(c.total),
        pagoPendiente: true,
        pagoDetalle: `${NOMBRE_MEDIO[medioPago]} · vence ${vence(venceEn)}`,
      });
    } catch (e) {
      // No se sabe si Stocker llegó a apartar: el vencimiento lo cancela del otro lado (es idempotente).
      await pool.query("UPDATE tienda.pedidos SET estado = 'error_reserva', vence_en = now(), actualizado_en = now() WHERE id = $1", [p.id]);
      await evento(pool, p.id, "error_reserva", "tienda", (e as Error).message);
      deps.log.error({ err: (e as Error).message, pedido: p.numero }, "Stocker no pudo apartar el pedido");
      throw new ErrorHttp(503, "sin_stocker", "No pudimos confirmar el stock en este momento. No se te cobró nada: probá de nuevo en unos minutos.");
    }

    if (!["aceptado"].includes(r.estado)) {
      await pool.query("UPDATE tienda.pedidos SET estado = 'sin_stock', stocker_estado = $2, actualizado_en = now() WHERE id = $1", [p.id, r.estado]);
      await evento(pool, p.id, "sin_stock", "stocker", r.motivo ?? undefined);
      // Que la tienda deje de ofrecer lo que ya no hay.
      await deps.colas.stocker("stock", { skus: c.lineas.map((l) => l.sku) });
      const nombres = new Map(c.lineas.map((l) => [l.sku, `${l.nombre}${l.talle ? ` (${l.talle})` : ""}`]));
      const faltantes = (r.faltantes ?? []).map((f) => ({ sku: f.sku, hay: f.hay, nombre: nombres.get(f.sku) ?? f.sku }));
      throw new ErrorHttp(409, "sin_stock", faltantes.length
        ? `Justo se vendió: ${faltantes.map((f) => f.hay ? `${f.nombre}, quedan ${f.hay}` : `${f.nombre}, se agotó`).join("; ")}.`
        : "Justo se vendió algo de tu carrito. Revisalo y probá de nuevo.", { faltantes });
    }

    const estado = ESTADO_INICIAL[medioPago];
    p = (await pool.query<FilaPedido>(
      "UPDATE tienda.pedidos SET estado = $2, vence_en = $3, stocker_estado = $4, actualizado_en = now() WHERE id = $1 RETURNING *",
      [p.id, estado, venceEn, r.estado],
    )).rows[0]!;
    await evento(pool, p.id, estado, "tienda", `Mercadería apartada en Stocker hasta ${vence(venceEn)}`);
    await deps.colas.stocker("cliente", { email: contacto.email, nombre: contacto.nombre, apellido: contacto.apellido, telefono: contacto.telefono, dni: contacto.dni });

    let redirigir: string | null = null;
    try {
      redirigir = await linkDePago(p, acceso);
    } catch (e) {
      // La reserva quedó: el cliente puede reintentar el pago desde la página del pedido.
      deps.log.error({ err: (e as Error).message, pedido: p.numero }, "no se pudo crear el link de pago");
    }
    await deps.colas.email("pedido_recibido", p.email, await datosMail(p, acceso, a));
    return { numero: p.numero, acceso, estado: p.estado, redirigir };
  }

  async function datosMail(p: FilaPedido, acceso: string | null, a?: Ajustes) {
    const ajustes = a ?? await leerAjustes(pool);
    const items = (await pool.query("SELECT nombre, color, talle, precio, cantidad FROM tienda.pedido_items WHERE pedido_id = $1 ORDER BY id", [p.id])).rows;
    return {
      numero: p.numero, nombre: p.nombre, estado: p.estado, medioPago: p.medio_pago, total: p.total, subtotal: p.subtotal,
      descuento: p.descuento, envio: p.envio, entrega: p.entrega, local: p.local_retiro, direccion: p.direccion,
      venceEn: p.vence_en?.toISOString() ?? null, items,
      enlace: acceso ? urlPedido(p.numero, acceso) : `${deps.sitio.replace(/\/+$/, "")}/cuenta`,
      transferencia: p.medio_pago === "transferencia" ? ajustes.datosTransferencia : null,
    };
  }

  /** Busca un pedido por número si quien pregunta es su dueño (sesión) o tiene el enlace (token de acceso). */
  async function delDueno(numero: string, quien: { clienteId: number | null; acceso: string | null }): Promise<FilaPedido> {
    const { rows } = await pool.query<FilaPedido>("SELECT * FROM tienda.pedidos WHERE numero = $1", [numero]);
    const p = rows[0];
    const esSuyo = p && ((quien.clienteId !== null && p.cliente_id === quien.clienteId) || (quien.acceso !== null && sha256(quien.acceso) === p.acceso_hash));
    // Mismo 404 exista o no: no se confirma qué números de pedido existen.
    if (!p || !esSuyo || ["reservando"].includes(p.estado)) throw new ErrorHttp(404, "no_encontrado", "No encontramos ese pedido.");
    return p;
  }

  async function publico(p: FilaPedido): Promise<PedidoPublico> {
    const a = await leerAjustes(pool);
    const [items, comp] = await Promise.all([
      pool.query("SELECT sku, nombre, color, talle, precio, cantidad FROM tienda.pedido_items WHERE pedido_id = $1 ORDER BY id", [p.id]),
      pool.query("SELECT 1 FROM tienda.comprobantes WHERE pedido_id = $1 LIMIT 1", [p.id]),
    ]);
    return {
      numero: p.numero, estado: p.estado, creadoEn: p.creado_en.toISOString(), venceEn: p.vence_en?.toISOString() ?? null,
      pagadoEn: p.pagado_en?.toISOString() ?? null, medioPago: p.medio_pago, entrega: p.entrega, direccion: p.direccion,
      local: p.local_retiro, contacto: { email: p.email, nombre: p.nombre, apellido: p.apellido, telefono: p.telefono },
      items: items.rows, subtotal: p.subtotal, descuento: p.descuento, envio: p.envio, total: p.total,
      pago: {
        url: null,
        transferencia: p.medio_pago === "transferencia" && ESTADOS_PENDIENTES.includes(p.estado as never) ? a.datosTransferencia : null,
        comprobanteSubido: (comp.rowCount ?? 0) > 0,
      },
    };
  }

  /*
   * Cobrado. Idempotente: el mismo pago avisado dos veces no hace nada la
   * segunda. Si llega un pago de un pedido que ya venció (se pagó tarde), no
   * se pierde: queda `pagado_tarde` para que una persona lo resuelva.
   */
  async function pagar(numero: string, pago: { proveedor: "mercadopago" | "transferencia" | "local"; externo: string; monto: number; detalle?: object; quien: string }) {
    const cli = await pool.connect();
    let p: FilaPedido;
    let cambio = false;
    try {
      await cli.query("BEGIN");
      const r = await cli.query<FilaPedido>("SELECT * FROM tienda.pedidos WHERE numero = $1 FOR UPDATE", [numero]);
      p = r.rows[0]!;
      if (!p) throw new ErrorHttp(404, "no_encontrado", "No existe ese pedido.");
      const alcanza = pago.monto >= p.total;
      const ins = await cli.query(
        `INSERT INTO tienda.pagos (pedido_id, proveedor, externo, estado, monto, detalle, registrado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (proveedor, externo) DO UPDATE SET estado = EXCLUDED.estado, monto = EXCLUDED.monto, detalle = EXCLUDED.detalle, actualizado_en = now()
           WHERE tienda.pagos.estado NOT IN ('aprobado', 'insuficiente')
         RETURNING id`,
        [p.id, pago.proveedor, pago.externo, alcanza ? "aprobado" : "insuficiente", pago.monto, pago.detalle ? JSON.stringify(pago.detalle) : null, pago.quien.slice(0, 150)],
      );
      if (ins.rowCount === 0) { await cli.query("ROLLBACK"); return { numero, estado: p.estado, repetido: true, insuficiente: false }; }
      if (!alcanza) {
        await evento(cli, p.id, p.estado, pago.quien, `Pago de ${formatearPesos(pago.monto)} menor al total (${formatearPesos(p.total)}): a revisar`);
        await cli.query("COMMIT");
        return { numero, estado: p.estado, repetido: false, insuficiente: true };
      }
      if ((ESTADOS_PENDIENTES as readonly string[]).includes(p.estado)) {
        p = (await cli.query<FilaPedido>("UPDATE tienda.pedidos SET estado = 'pagado', pagado_en = now(), actualizado_en = now() WHERE id = $1 RETURNING *", [p.id])).rows[0]!;
        await evento(cli, p.id, "pagado", pago.quien, `${pago.proveedor} ${pago.externo} · ${formatearPesos(pago.monto)}`);
        cambio = true;
      } else if (["vencido", "cancelado", "sin_stock", "error_reserva"].includes(p.estado)) {
        p = (await cli.query<FilaPedido>("UPDATE tienda.pedidos SET estado = 'pagado_tarde', actualizado_en = now() WHERE id = $1 RETURNING *", [p.id])).rows[0]!;
        await evento(cli, p.id, "pagado_tarde", pago.quien, "Se cobró un pedido que ya no tenía la mercadería apartada: revisar stock o devolver el dinero");
      }
      await cli.query("COMMIT");
    } catch (e) {
      await cli.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      cli.release();
    }
    if (cambio) {
      // Que Stocker levante la marca "sin pagar" (con reintentos: sin esto el depósito no lo despacha).
      await deps.colas.stocker("pagado", { numero: p.numero, detalle: `Pagado · ${NOMBRE_MEDIO[p.medio_pago]}` }, `pagado-${p.numero}`);
      await deps.colas.email("pago_confirmado", p.email, await datosMail(p, null));
    }
    return { numero: p.numero, estado: p.estado, repetido: false, insuficiente: false };
  }

  /** Mercado Pago: aplica un pago consultado a MP (del aviso o de la búsqueda por número de pedido). */
  async function aplicarPagoMp(pago: PagoMp, quien: string) {
    const numero = pago.external_reference ?? "";
    const { rows } = await pool.query<FilaPedido>("SELECT * FROM tienda.pedidos WHERE numero = $1", [numero]);
    const p = rows[0];
    if (!p || !["mercadopago", "pagofacil"].includes(p.medio_pago)) return { aplicado: false, motivo: "pedido_ajeno" };
    if (pago.currency_id !== "ARS") return { aplicado: false, motivo: "moneda" };
    const monto = Math.round(pago.transaction_amount * 100);
    if (pago.status !== "approved") {
      await pool.query(
        `INSERT INTO tienda.pagos (pedido_id, proveedor, externo, estado, monto, detalle, registrado_por)
         VALUES ($1,'mercadopago',$2,$3,$4,$5,$6)
         ON CONFLICT (proveedor, externo) DO UPDATE SET estado = EXCLUDED.estado, detalle = EXCLUDED.detalle, actualizado_en = now()
           WHERE tienda.pagos.estado <> 'aprobado'`,
        [p.id, pago.id, pago.status === "rejected" ? "rechazado" : "pendiente", monto, JSON.stringify(pago), quien],
      );
      return { aplicado: false, motivo: pago.status };
    }
    const r = await pagar(numero, { proveedor: "mercadopago", externo: pago.id, monto, detalle: pago, quien });
    return { aplicado: !r.repetido, motivo: null };
  }

  /** Pregunta a Mercado Pago por los pagos de un pedido (si el aviso no llegó, o al volver del checkout). */
  async function consultarMp(numero: string) {
    if (!deps.mp) return;
    const pagos = await deps.mp.pagosDe(numero).catch((e) => { if (e instanceof ErrorMp) return []; throw e; });
    for (const pago of pagos.filter((x) => x.external_reference === numero)) {
      await aplicarPagoMp(pago, "mercadopago (consulta)").catch((e) => deps.log.warn({ err: (e as Error).message }, "pago MP no aplicado"));
    }
  }

  /** Devuelve lo apartado y deja el pedido `vencido` o `cancelado`. */
  async function liberar(p: FilaPedido, estado: "vencido" | "cancelado", motivo: string, quien: string) {
    const stocker = await stockerOError();
    await stocker.cancelarPedido(p.numero, motivo);
    const r = await pool.query<FilaPedido>(
      `UPDATE tienda.pedidos SET estado = $2, actualizado_en = now() WHERE id = $1 AND estado = $3 RETURNING *`, [p.id, estado, p.estado],
    );
    if (r.rows[0]) await evento(pool, p.id, estado, quien, motivo);
    return r.rows[0] ?? null;
  }

  /*
   * Vencimientos (lo corre el worker cada minuto). Antes de vencer uno de
   * Mercado Pago se le pregunta a MP: el aviso de pago pudo no haber llegado.
   */
  async function vencer(limite = 50) {
    const { rows } = await pool.query<FilaPedido>(
      `SELECT * FROM tienda.pedidos WHERE vence_en < now()
          AND estado IN ('esperando_pago','esperando_transferencia','a_pagar_en_local','error_reserva')
        ORDER BY vence_en LIMIT $1`, [limite],
    );
    let vencidos = 0;
    for (const p of rows) {
      try {
        if (p.estado === "esperando_pago") {
          await consultarMp(p.numero);
          const ahora = (await pool.query<{ estado: string }>("SELECT estado FROM tienda.pedidos WHERE id = $1", [p.id])).rows[0];
          if (ahora?.estado !== "esperando_pago") continue;
        }
        if (p.estado === "error_reserva") {
          // Por si Stocker sí había apartado: se cancela del otro lado (no existe = nada que hacer).
          await (await stockerOError()).cancelarPedido(p.numero, "La tienda no pudo confirmar el pedido");
          await pool.query("UPDATE tienda.pedidos SET estado = 'sin_confirmar', actualizado_en = now() WHERE id = $1", [p.id]);
          await evento(pool, p.id, "sin_confirmar", "vencimientos", "Se liberó cualquier reserva que hubiera quedado en Stocker");
          continue;
        }
        const v = await liberar(p, "vencido", "No se pagó a tiempo", "vencimientos");
        if (v) {
          vencidos++;
          await deps.colas.email("pedido_vencido", v.email, await datosMail(v, null));
        }
      } catch (e) {
        deps.log.warn({ err: (e as Error).message, pedido: p.numero }, "no se pudo vencer el pedido; se reintenta en la próxima pasada");
      }
    }
    return { revisados: rows.length, vencidos };
  }

  /** Mercado Pago sin aviso todavía: repasa los que están esperando (cada 10 min). */
  async function conciliarMp() {
    const { rows } = await pool.query<{ numero: string }>(
      "SELECT numero FROM tienda.pedidos WHERE estado = 'esperando_pago' AND creado_en > now() - interval '5 days' ORDER BY creado_en LIMIT 100",
    );
    for (const r of rows) await consultarMp(r.numero).catch(() => {});
    return { revisados: rows.length };
  }

  /** ¿La caja todavía no salió del depósito? (para cancelar un pedido ya cobrado) */
  async function sigueEnDeposito(numero: string) {
    const e = await (await stockerOError()).estadoPedido(numero);
    return !!e && e.estado !== "cancelado" && e.estadoEnvio !== "despachado";
  }

  return { sigueEnDeposito, crear, delDueno, publico, pagar, aplicarPagoMp, consultarMp, linkDePago, liberar, vencer, conciliarMp, datosMail, evento };
}
export type ServicioPedidos = ReturnType<typeof crearServicioPedidos>;
export { ErrorStocker };
