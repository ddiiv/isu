import { createHash } from "node:crypto";
import type pg from "pg";
import { idEventoCompra } from "@isu/shared";
import { telefonoWhatsapp } from "@isu/envios";

/*
 * API de conversiones de Meta: la compra, informada desde el servidor cuando el pedido se paga. Cubre lo que el
 * Pixel no ve: transferencias confirmadas después, bloqueadores, navegadores que cortan las cookies.
 *
 * Sólo se informa si quien compró aceptó las cookies (el checkout guarda `medicion` sólo en ese caso). Los datos
 * personales viajan con hash SHA-256, normalizados como pide Meta. El Pixel manda la misma compra con el mismo
 * identificador (idEventoCompra) y Meta la cuenta una sola vez.
 */
export interface ConfigMeta { pixelId: string; token: string; version: string; url: string; codigoDePrueba?: string }

const sha = (t: string) => createHash("sha256").update(t).digest("hex");
const limpio = (t: string | null | undefined) => (t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
const hash = (t: string | null | undefined) => (limpio(t) ? sha(limpio(t)) : undefined);

interface Fila {
  numero: string; email: string; nombre: string; apellido: string; telefono: string; total: number; pagado_en: Date | null;
  direccion: { localidad?: string; cp?: string } | null; ip: string | null; medicion: { fbp?: string; fbc?: string; ua?: string } | null;
}

export function crearConversiones(o: { pool: pg.Pool; meta: ConfigMeta; sitio: string }) {
  async function compra(numero: string) {
    const p = (await o.pool.query<Fila>(
      "SELECT numero, email, nombre, apellido, telefono, total, pagado_en, direccion, host(ip) AS ip, medicion FROM tienda.pedidos WHERE numero = $1", [numero])).rows[0];
    if (!p) return { motivo: "no_existe" };
    if (!p.pagado_en) return { motivo: "sin_pagar" };
    if (!p.medicion) return { motivo: "sin_consentimiento" };
    const items = (await o.pool.query<{ sku: string; cantidad: number }>(
      "SELECT i.sku, i.cantidad FROM tienda.pedido_items i JOIN tienda.pedidos p ON p.id = i.pedido_id WHERE p.numero = $1 ORDER BY i.id", [numero])).rows;
    const tel = telefonoWhatsapp(p.telefono);
    const usuario = {
      em: [hash(p.email)], ...(tel ? { ph: [sha(tel)] } : {}), fn: [hash(p.nombre.split(" ")[0])], ln: [hash(p.apellido)],
      ...(p.direccion?.localidad ? { ct: [hash(p.direccion.localidad.replace(/\s+/g, ""))] } : {}),
      ...(p.direccion?.cp ? { zp: [hash(p.direccion.cp.replace(/\D/g, ""))] } : {}), country: [sha("ar")],
      ...(p.ip ? { client_ip_address: p.ip } : {}), ...(p.medicion.ua ? { client_user_agent: p.medicion.ua } : {}),
      ...(p.medicion.fbp ? { fbp: p.medicion.fbp } : {}), ...(p.medicion.fbc ? { fbc: p.medicion.fbc } : {}),
    };
    const cuerpo = {
      data: [{
        event_name: "Purchase", event_time: Math.floor(p.pagado_en.getTime() / 1000), event_id: idEventoCompra(p.numero),
        action_source: "website", event_source_url: `${o.sitio.replace(/\/+$/, "")}/pedido/${p.numero}`, user_data: usuario,
        custom_data: {
          currency: "ARS", value: Math.round(p.total) / 100, content_type: "product", content_ids: items.map((i) => i.sku),
          num_items: items.reduce((a, i) => a + i.cantidad, 0), order_id: p.numero,
        },
      }],
      ...(o.meta.codigoDePrueba ? { test_event_code: o.meta.codigoDePrueba } : {}),
    };
    const r = await fetch(`${o.meta.url.replace(/\/+$/, "")}/${o.meta.version}/${encodeURIComponent(o.meta.pixelId)}/events`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { "content-type": "application/json", authorization: `Bearer ${o.meta.token}` }, body: JSON.stringify(cuerpo),
    });
    if (!r.ok) {
      const texto = (await r.text().catch(() => "")).replace(/\d{8,}/g, "…").slice(0, 200);
      // Un pedido o credencial rechazados no se arreglan reintentando; un 5xx o 429 sí.
      throw Object.assign(new Error(`Meta ${r.status}: ${texto}`), { sinReintento: r.status >= 400 && r.status < 500 && r.status !== 429 });
    }
    return { enviado: true };
  }
  return { compra };
}
export type Conversiones = ReturnType<typeof crearConversiones>;
