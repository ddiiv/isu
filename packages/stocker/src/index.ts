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

/*
 * Formas del contrato v1 de Stocker (GET /catalogo y GET /stock). Se validan
 * tal cual llegan y se pasan a la forma que usa la tienda: `skuAgrupador` →
 * `sku`, `precioMinorista` → `precio` (en centavos), `publicable` →
 * `cantidad`. El precio mayorista no se lee: la tienda vende al público.
 */
const Publicable = z.number().int().max(1_000_000).transform((n) => Math.max(0, n));

const VarianteV1 = z.object({
  id: z.number().int().positive(),
  sku: z.string().trim().min(1).max(100),
  color: texto(60),
  talle: texto(40),
  precioMinorista: Precio.optional().transform((v) => v ?? null),
  publicable: Publicable,
  // Sin el campo, activa (como antes de que Stocker lo mandara).
  activo: z.boolean().optional().default(true),
});

const ProductoV1 = z.object({
  id: z.number().int().positive(),
  skuAgrupador: z.string().trim().min(1).max(60),
  titulo: z.string().trim().min(1).max(150),
  descripcion: z.string().max(20_000).nullable().optional().transform((v) => v ?? null),
  categoria: texto(80),
  genero: texto(40),
  modelo: texto(80),
  precioMinorista: Precio.optional().transform((v) => v ?? null),
  variantes: z.array(VarianteV1).max(500),
});

const aVariante = (v: z.output<typeof VarianteV1>) => ({ id: v.id, sku: v.sku, color: v.color, talle: v.talle, precio: v.precioMinorista, cantidad: v.publicable });

export const VarianteStocker = VarianteV1.transform(aVariante);
export type VarianteStocker = z.output<typeof VarianteStocker>;

export const ProductoStocker = ProductoV1.transform((p) => ({
  id: p.id,
  sku: p.skuAgrupador,
  titulo: p.titulo,
  descripcion: p.descripcion,
  categoria: p.categoria,
  genero: p.genero,
  modelo: p.modelo,
  precio: p.precioMinorista,
  // Una variante dada de baja en Stocker no se vende: es como si no viniera.
  variantes: p.variantes.filter((v) => v.activo).map(aVariante),
}));
export type ProductoStocker = z.output<typeof ProductoStocker>;

export const CatalogoStocker = z.object({
  negocio: z.number().int().positive(),
  generadoEn: z.iso.datetime({ offset: true }),
  /** Stocker cortó la lista: lo que no vino NO es una baja. */
  truncado: z.boolean().optional().default(false),
  sinLocalesOnline: z.boolean().optional().default(false),
  productos: z.array(ProductoStocker).max(20_000),
}).transform(({ generadoEn, ...c }) => ({ ...c, generado: generadoEn }));
export type CatalogoStocker = z.output<typeof CatalogoStocker>;

export const StockStocker = z.object({
  generadoEn: z.iso.datetime({ offset: true }),
  stock: z.record(z.string().max(100), Publicable),
  /** SKU que Stocker no conoce. No es «sin stock»: es un error de catálogo. */
  desconocidos: z.array(z.string().max(100)).max(1000).optional().default([]),
}).transform(({ generadoEn, ...s }) => ({ ...s, generado: generadoEn }));
export type StockStocker = z.output<typeof StockStocker>;

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
      // "fetch failed" solo no dice nada: la causa real (no existe el servidor, rechaza la conexión, no contesta) viene en e.cause.
      const err = e as Error & { cause?: { code?: string; message?: string } };
      const causa = err.cause?.code ?? err.cause?.message;
      const ayuda: Record<string, string> = {
        ENOTFOUND: "no existe ese servidor: revisá el nombre del servicio en STOCKER_API_URL",
        EAI_AGAIN: "no se pudo resolver el nombre del servidor: revisá el nombre del servicio en STOCKER_API_URL",
        ECONNREFUSED: "el servidor existe pero rechaza la conexión: casi seguro el puerto de STOCKER_API_URL no es en el que escucha Stocker",
        ECONNRESET: "Stocker cortó la conexión: ¿STOCKER_API_URL usa https a la red interna? Tiene que ser http://",
        UND_ERR_CONNECT_TIMEOUT: "Stocker no contesta: revisá el puerto, o que Stocker escuche en :: (la red interna de Railway puede ser sólo IPv6)",
      };
      const detalle = err.name === "TimeoutError" ? `no contestó en ${timeoutMs / 1000} s` : causa ? `${causa}${ayuda[causa] ? ` — ${ayuda[causa]}` : ""}` : err.message;
      throw new ErrorStocker(`Stocker no responde en ${new URL(base).host} (${detalle})`);
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
