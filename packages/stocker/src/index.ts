import { z } from "zod";
import { desdePesos } from "@isu/shared";

/*
 * Cliente de la API de Stocker (credencial de integración con origen `tienda`).
 *
 * Todo lo que llega se valida: si Stocker cambia un campo o devuelve algo
 * raro, la sincronización falla con un error claro en vez de guardar basura
 * en la tienda. Un producto sin precio no se puede vender: se descarta.
 */
const Precio = z.union([z.number(), z.string()]).nullable().transform((v, ctx) => {
  if (v === null || v === "") return null;
  try {
    const c = desdePesos(v);
    if (c < 0) throw new RangeError();
    return c as number;
  } catch {
    ctx.addIssue({ code: "custom", message: `precio inválido: ${String(v)}` });
    return z.NEVER;
  }
});

const texto = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));

export const VarianteStocker = z.object({
  id: z.number().int().positive(),
  sku: z.string().trim().min(1).max(100),
  color: texto(60),
  talle: texto(40),
  precio: Precio,
  cantidad: z.number().int().min(0).max(1_000_000),
});
export type VarianteStocker = z.infer<typeof VarianteStocker>;

export const ProductoStocker = z.object({
  id: z.number().int().positive(),
  sku: z.string().trim().min(1).max(60),
  titulo: z.string().trim().min(1).max(150),
  descripcion: z.string().max(20_000).nullable().optional().transform((v) => v ?? null),
  categoria: texto(80),
  genero: texto(40),
  modelo: texto(80),
  precio: Precio,
  variantes: z.array(VarianteStocker).max(500),
});
export type ProductoStocker = z.infer<typeof ProductoStocker>;

export const CatalogoStocker = z.object({
  negocio: z.number().int().positive(),
  generado: z.iso.datetime({ offset: true }),
  sinLocalesOnline: z.boolean(),
  productos: z.array(ProductoStocker).max(20_000),
});
export type CatalogoStocker = z.infer<typeof CatalogoStocker>;

export const StockStocker = z.object({
  generado: z.iso.datetime({ offset: true }),
  stock: z.record(z.string().max(100), z.number().int().min(0).max(1_000_000)),
});
export type StockStocker = z.infer<typeof StockStocker>;

export const MAX_SKUS_POR_PEDIDO = 200;

export class ErrorStocker extends Error {
  constructor(mensaje: string, public status: number | null = null, public codigo: string | null = null) { super(mensaje); }
}

export const PedidoStocker = z.object({
  id: z.number().int(),
  pedido: z.string(),
  estado: z.string(),
  pagoPendiente: z.boolean(),
  // Etapa 4 (opcionales: un Stocker sin el parche de envíos no los manda).
  envioTipo: z.string().nullable().optional(),
  envioId: z.string().nullable().optional(),
  estadoEnvio: z.string().nullable(),
  despachadoEn: z.string().nullable(),
  canceladoEn: z.string().nullable(),
  motivo: z.string().nullable(),
  repetido: z.boolean().optional(),
  faltantes: z.array(z.object({ sku: z.string(), pedido: z.number().int(), hay: z.number().int() })).optional(),
});
export type PedidoStocker = z.infer<typeof PedidoStocker>;

export interface NuevoPedidoStocker {
  pedido: string;
  items: Array<{ sku: string; cantidad: number; precioUnitario?: number }>;
  comprador: { nombre: string; email: string; documento?: string };
  total: number;           // en pesos (como lo guarda Stocker)
  pagoPendiente: boolean;
  pagoDetalle?: string;
  /** Con qué sale (lo ve el depósito); `despacharAntesDe`: corte de los envíos en el día. */
  envio?: DatosEnvioStocker;
}

/** correo_argentino · andreani · oca · mercado_envios · cabify · retiro · envio */
export interface DatosEnvioStocker { tipo: string; seguimiento?: string; despacharAntesDe?: string }

export interface ClienteStocker {
  catalogo(): Promise<CatalogoStocker>;
  stock(skus: string[]): Promise<StockStocker>;
  crearPedido(p: NuevoPedidoStocker): Promise<PedidoStocker>;
  estadoPedido(numero: string): Promise<PedidoStocker | null>;
  marcarPagado(numero: string, detalle: string): Promise<PedidoStocker>;
  cancelarPedido(numero: string, motivo: string): Promise<PedidoStocker | null>;
  guardarCliente(c: { email: string; nombre?: string; apellido?: string; telefono?: string; dni?: string; direccion?: string }): Promise<{ id: number; nuevo: boolean }>;
  /** La etiqueta ya existe: transporte y número de seguimiento para Envíos del día. */
  cargarEnvio(numero: string, envio: DatosEnvioStocker): Promise<PedidoStocker>;
}

export function crearClienteStocker({ url, token }: { url: string; token: string }): ClienteStocker {
  const base = url.replace(/\/+$/, "");

  async function pedir(ruta: string, timeoutMs: number, metodo: "GET" | "POST" | "PUT" = "GET", cuerpo?: unknown): Promise<unknown> {
    let r: Response;
    try {
      r = await fetch(`${base}/api/integraciones/tienda${ruta}`, {
        method: metodo,
        headers: { authorization: `Bearer ${token}`, accept: "application/json", ...(cuerpo ? { "content-type": "application/json" } : {}) },
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
        // Nunca seguir redirecciones con la credencial puesta.
        redirect: "error",
      });
    } catch (e) {
      throw new ErrorStocker(`Stocker no responde (${(e as Error).name}: ${(e as Error).message})`);
    }
    if (r.status === 401) throw new ErrorStocker("Stocker rechazó la credencial de la tienda (STOCKER_TOKEN)", 401);
    if (!r.ok) {
      let mensaje = `Stocker contestó ${r.status}`;
      let codigo: string | null = null;
      try { const j = (await r.json()) as { message?: string; codigo?: string }; if (j.message) mensaje += `: ${j.message}`; codigo = j.codigo ?? null; } catch { /* sin cuerpo */ }
      throw new ErrorStocker(mensaje, r.status, codigo);
    }
    return r.json();
  }
  const pedido = (x: unknown) => {
    const r = PedidoStocker.safeParse(x);
    if (!r.success) throw new ErrorStocker("Pedido de Stocker con formato inesperado");
    return r.data;
  };
  const num = (n: string) => encodeURIComponent(n);

  return {
    async catalogo() {
      const r = CatalogoStocker.safeParse(await pedir("/catalogo", 60_000));
      if (!r.success) throw new ErrorStocker(`Catálogo de Stocker con formato inesperado: ${r.error.issues.slice(0, 3).map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
      return r.data;
    },
    async stock(skus) {
      if (skus.length > MAX_SKUS_POR_PEDIDO) throw new RangeError(`Como mucho ${MAX_SKUS_POR_PEDIDO} SKU por pedido`);
      const q = new URLSearchParams({ skus: skus.join(",") });
      const r = StockStocker.safeParse(await pedir(`/stock?${q}`, 15_000));
      if (!r.success) throw new ErrorStocker("Stock de Stocker con formato inesperado");
      return r.data;
    },
    async crearPedido(p) {
      return pedido(await pedir("/pedidos", 20_000, "POST", p));
    },
    async estadoPedido(numero) {
      try { return pedido(await pedir(`/pedidos/${num(numero)}`, 10_000)); } catch (e) {
        if (e instanceof ErrorStocker && e.status === 404) return null;
        throw e;
      }
    },
    async marcarPagado(numero, detalle) {
      return pedido(await pedir(`/pedidos/${num(numero)}/pagado`, 10_000, "POST", { detalle }));
    },
    async cancelarPedido(numero, motivo) {
      try { return pedido(await pedir(`/pedidos/${num(numero)}/cancelar`, 15_000, "POST", { motivo })); } catch (e) {
        if (e instanceof ErrorStocker && e.status === 404) return null;
        throw e;
      }
    },
    async cargarEnvio(numero, envio) {
      return pedido(await pedir(`/pedidos/${num(numero)}/envio`, 10_000, "POST", envio));
    },
    async guardarCliente(c) {
      const r = z.object({ id: z.number().int(), nuevo: z.boolean() }).safeParse(await pedir("/clientes", 10_000, "PUT", c));
      if (!r.success) throw new ErrorStocker("Cliente de Stocker con formato inesperado");
      return r.data;
    },
  };
}
