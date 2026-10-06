import { z } from "zod";

/*
 * Talo (https://docs.talo.com.ar): cobro por transferencia con un CVU y alias
 * propios de cada pedido, por el monto exacto.
 *
 * El aviso de Talo trae sólo ids (no viene firmado): NUNCA se cree lo que
 * dice. Se le pregunta a Talo por ese pago con nuestra credencial y recién
 * ahí, si es de ESE pedido y llegó la plata, se da por cobrado.
 *
 * Credencial: TALO_USER_ID + TALO_CLIENT_ID + TALO_CLIENT_SECRET (panel de
 * Talo → Usuario → Credenciales). Con eso se pide un token que se guarda en
 * memoria y se renueva si Talo lo rechaza.
 */
export class ErrorTalo extends Error {}

// Talo manda los montos como número o como texto ("30000", "172029.37").
const Monto = z.union([z.number(), z.string().max(20).refine((v) => v.trim() !== "" && Number.isFinite(Number(v)), "monto")])
  .transform(Number).refine((n) => n >= 0, "monto");

export const PagoTalo = z.object({
  id: z.string().min(3).max(120),
  external_id: z.string().nullable().optional(),
  payment_status: z.enum(["PENDING", "SUCCESS", "OVERPAID", "UNDERPAID", "EXPIRED"]).or(z.string()),
  price: z.object({ amount: Monto, currency: z.string() }).optional(),
  quotes: z.array(z.object({
    cvu: z.string().optional(), address: z.string().optional(), alias: z.string().optional(),
  }).passthrough()).optional().default([]),
  expiration_timestamp: z.string().nullable().optional(),
  transactions: z.array(z.object({
    amount: Monto,
    currency: z.string().optional(),
    creation_timestamp: z.string().optional(),
    transaction_data: z.object({
      PROCESSED: z.object({
        trxId: z.string().optional(), senderCuit: z.string().optional(), senderTitular: z.string().optional(),
      }).passthrough().optional(),
    }).passthrough().optional(),
  }).passthrough()).optional().default([]),
}).passthrough();
export type PagoTalo = z.infer<typeof PagoTalo>;

/** Lo que importa de un pago de Talo, en centavos y con quién transfirió. */
export function resumirPagoTalo(p: PagoTalo) {
  const transferencias = p.transactions.map((t, i) => ({
    id: t.transaction_data?.PROCESSED?.trxId ?? `${p.id}:${i}`,
    monto: Math.round(t.amount * 100),
    pagador: t.transaction_data?.PROCESSED?.senderTitular ?? null,
    cuit: t.transaction_data?.PROCESSED?.senderCuit ?? null,
    fecha: t.creation_timestamp ?? null,
  })).filter((t) => t.monto > 0);
  return {
    id: p.id,
    pedido: p.external_id ?? null,
    estado: p.payment_status,
    recibido: transferencias.reduce((a, t) => a + t.monto, 0),
    transferencias,
  };
}

export function crearTalo(o: { url: string; userId: string; clientId: string; clientSecret: string }) {
  const base = o.url.replace(/\/+$/, "");
  let token: { valor: string; hasta: number } | null = null;

  async function llamar(ruta: string, init: RequestInit & { conToken?: string } = {}) {
    let r: Response;
    try {
      r = await fetch(`${base}${ruta}`, {
        ...init,
        headers: { "content-type": "application/json", ...(init.conToken ? { authorization: `Bearer ${init.conToken}` } : {}), ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(12_000),
        redirect: "error",
      });
    } catch (e) {
      throw new ErrorTalo(`Talo no responde: ${(e as Error).message}`);
    }
    return r;
  }

  async function obtenerToken(forzar = false): Promise<string> {
    if (!forzar && token && token.hasta > Date.now()) return token.valor;
    const r = await llamar(`/users/${encodeURIComponent(o.userId)}/tokens`, {
      method: "POST", body: JSON.stringify({ client_id: o.clientId, client_secret: o.clientSecret }),
    });
    if (!r.ok) throw new ErrorTalo(`Talo no dio el token (${r.status}): revisá TALO_USER_ID, TALO_CLIENT_ID y TALO_CLIENT_SECRET`);
    const d = z.object({ data: z.object({ token: z.string().min(10) }) }).safeParse(await r.json().catch(() => null));
    if (!d.success) throw new ErrorTalo("Token de Talo con formato inesperado");
    // Talo no dice cuánto dura: se renueva cada 30 minutos o cuando lo rechaza.
    token = { valor: d.data.data.token, hasta: Date.now() + 30 * 60_000 };
    return token.valor;
  }

  async function conToken(ruta: string, init: RequestInit = {}): Promise<unknown> {
    let r = await llamar(ruta, { ...init, conToken: await obtenerToken() });
    if (r.status === 401 || r.status === 403) r = await llamar(ruta, { ...init, conToken: await obtenerToken(true) });
    if (!r.ok) throw new ErrorTalo(`Talo contestó ${r.status}`);
    return r.json().catch(() => { throw new ErrorTalo("Respuesta de Talo que no es JSON"); });
  }

  return {
    /** Crea el cobro del pedido: devuelve el CVU y alias donde transferir. */
    async crearPago(p: {
      numero: string; monto: number; aviso: string; motivo: string;
      cliente: { nombre: string; apellido: string; email: string; dni: string };
    }): Promise<{ id: string; cvu: string; alias: string | null; vence: string | null }> {
      const cuerpo = {
        user_id: o.userId,
        price: { amount: Math.round(p.monto) / 100, currency: "ARS" },
        payment_options: ["transfer"],
        external_id: p.numero,
        webhook_url: p.aviso,
        motive: p.motivo.slice(0, 120),
        client_data: { first_name: p.cliente.nombre, last_name: p.cliente.apellido, email: p.cliente.email, dni: p.cliente.dni },
      };
      const r = z.object({ data: PagoTalo }).safeParse(await conToken("/payments/", { method: "POST", body: JSON.stringify(cuerpo) }));
      if (!r.success) throw new ErrorTalo("Pago de Talo con formato inesperado");
      const q = r.data.data.quotes[0];
      const cvu = q?.cvu ?? q?.address ?? "";
      if (!/^\d{22}$/.test(cvu)) throw new ErrorTalo("Talo no devolvió un CVU válido");
      const alias = q?.alias && /^[A-Za-z0-9.-]{6,40}$/.test(q.alias) ? q.alias : null;
      return { id: r.data.data.id, cvu, alias, vence: r.data.data.expiration_timestamp ?? null };
    },

    async pago(id: string): Promise<PagoTalo> {
      if (!/^[A-Za-z0-9_-]{3,120}$/.test(id)) throw new ErrorTalo("Id de pago de Talo inválido");
      const r = z.object({ data: PagoTalo }).safeParse(await conToken(`/payments/${encodeURIComponent(id)}`));
      if (!r.success) throw new ErrorTalo("Pago de Talo con formato inesperado");
      return r.data.data;
    },
  };
}
export type Talo = ReturnType<typeof crearTalo>;
