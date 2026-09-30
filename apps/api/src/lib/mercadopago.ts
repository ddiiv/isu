import { createHmac } from "node:crypto";
import { z } from "zod";
import { iguales } from "./cripto.js";

/*
 * Mercado Pago (Checkout Pro).
 *
 * El aviso de pago (webhook) NUNCA se cree por lo que trae: se verifica la
 * firma y después se le pregunta a Mercado Pago por ese pago con nuestro
 * access token. Recién ahí, si el pago es de ESE pedido, por ESE monto y en
 * pesos, se da por cobrado.
 */
export interface ItemMp { id: string; title: string; quantity: number; unit_price: number; currency_id: "ARS" }

export const PagoMp = z.object({
  id: z.union([z.number(), z.string()]).transform(String),
  status: z.string(),
  status_detail: z.string().nullable().optional(),
  external_reference: z.string().nullable().optional(),
  transaction_amount: z.number(),
  currency_id: z.string(),
  payment_type_id: z.string().nullable().optional(),
  payment_method_id: z.string().nullable().optional(),
  installments: z.number().nullable().optional(),
  date_approved: z.string().nullable().optional(),
});
export type PagoMp = z.infer<typeof PagoMp>;

export class ErrorMp extends Error {}

export function crearMercadoPago(o: { url: string; token: string }) {
  const base = o.url.replace(/\/+$/, "");
  const pedir = async (ruta: string, init: RequestInit = {}) => {
    let r: Response;
    try {
      r = await fetch(`${base}${ruta}`, {
        ...init,
        headers: { authorization: `Bearer ${o.token}`, "content-type": "application/json", ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      });
    } catch (e) {
      throw new ErrorMp(`Mercado Pago no responde: ${(e as Error).message}`);
    }
    if (!r.ok) throw new ErrorMp(`Mercado Pago contestó ${r.status}`);
    return r.json() as Promise<unknown>;
  };

  return {
    async crearPreferencia(p: {
      numero: string; items: ItemMp[]; email: string; nombre: string; apellido: string;
      vuelta: string; aviso: string; vence: Date; soloEfectivo: boolean;
    }): Promise<{ id: string; url: string }> {
      const cuerpo = {
        items: p.items,
        payer: { email: p.email, name: p.nombre, surname: p.apellido },
        external_reference: p.numero,
        notification_url: p.aviso,
        back_urls: { success: p.vuelta, failure: p.vuelta, pending: p.vuelta },
        auto_return: "approved",
        statement_descriptor: "ISUWAYA",
        expires: true,
        expiration_date_to: p.vence.toISOString(),
        // Pago Fácil / Rapipago: vence cuando vence la reserva.
        ...(p.soloEfectivo ? { date_of_expiration: p.vence.toISOString() } : {}),
        payment_methods: p.soloEfectivo
          ? {
            excluded_payment_types: ["credit_card", "debit_card", "prepaid_card", "account_money", "bank_transfer", "atm", "digital_currency", "digital_wallet"].map((id) => ({ id })),
            installments: 1,
          }
          : { excluded_payment_types: [{ id: "ticket" }, { id: "atm" }], installments: 12 },
      };
      const r = z.object({ id: z.string(), init_point: z.string().url() }).safeParse(
        await pedir("/checkout/preferences", { method: "POST", body: JSON.stringify(cuerpo), headers: { "x-idempotency-key": `pref-${p.numero}-${p.soloEfectivo ? "e" : "t"}-${p.vence.getTime()}` } }),
      );
      if (!r.success) throw new ErrorMp("Preferencia de Mercado Pago con formato inesperado");
      return { id: r.data.id, url: r.data.init_point };
    },

    async pago(id: string): Promise<PagoMp> {
      if (!/^\d{1,20}$/.test(id)) throw new ErrorMp("Id de pago inválido");
      const r = PagoMp.safeParse(await pedir(`/v1/payments/${id}`));
      if (!r.success) throw new ErrorMp("Pago de Mercado Pago con formato inesperado");
      return r.data;
    },

    async pagosDe(numero: string): Promise<PagoMp[]> {
      const q = new URLSearchParams({ external_reference: numero, sort: "date_created", criteria: "desc", limit: "20" });
      const r = z.object({ results: z.array(PagoMp) }).safeParse(await pedir(`/v1/payments/search?${q}`));
      if (!r.success) throw new ErrorMp("Búsqueda de Mercado Pago con formato inesperado");
      return r.data.results;
    },
  };
}
export type MercadoPago = ReturnType<typeof crearMercadoPago>;

/*
 * Firma del aviso: cabecera x-signature "ts=…,v1=…". Se firma
 * "id:<data.id>;request-id:<x-request-id>;ts:<ts>;" con HMAC-SHA256 y la clave
 * secreta. Además se rechaza un aviso de hace más de 10 minutos (repetición).
 */
export function firmaValida(o: { firma: string | undefined; requestId: string | undefined; dataId: string; secreto: string; ahora?: number }): boolean {
  if (!o.firma) return false;
  const partes = Object.fromEntries(o.firma.split(",").map((p) => p.trim().split("=", 2) as [string, string]));
  const ts = partes.ts, v1 = partes.v1;
  if (!ts || !v1 || !/^\d{10,13}$/.test(ts) || !/^[0-9a-f]{64}$/.test(v1)) return false;
  const ms = ts.length === 13 ? Number(ts) : Number(ts) * 1000;
  if (Math.abs((o.ahora ?? Date.now()) - ms) > 10 * 60_000) return false;
  const manifiesto = `id:${o.dataId.toLowerCase()};${o.requestId ? `request-id:${o.requestId};` : ""}ts:${ts};`;
  return iguales(createHmac("sha256", o.secreto).update(manifiesto).digest("hex"), v1);
}
