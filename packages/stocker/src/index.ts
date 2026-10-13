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
  // Packs y combos de Stocker no se venden en la tienda (los packs se arman sobre la prenda padre).
  esPack: z.boolean().optional(),
  esCombo: z.boolean().optional(),
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
  /*
   * A la tienda llegan sólo los productos padre. Stocker ya deja afuera los
   * de evento (feria) y las variantes de pack o combo; si alguno viniera
   * marcado igual, la tienda lo descarta acá.
   */
  esFeria: z.boolean().nullable().optional(),
  esEvento: z.boolean().nullable().optional(),
  esCombo: z.boolean().nullable().optional(),
  esPack: z.boolean().nullable().optional(),
  definicionCombo: z.unknown().optional(),
  tipo: z.string().max(40).nullable().optional(),
});

/** Producto padre: ni de evento, ni pack, ni combo (con los datos que mande Stocker). */
const TIPOS_PADRE = new Set(["padre", "producto", "normal", "simple"]);
const esPadre = (p: z.output<typeof ProductoV1>) =>
  !p.esFeria && !p.esEvento && !p.esCombo && !p.esPack && (p.definicionCombo === undefined || p.definicionCombo === null || p.definicionCombo === "")
  && (p.tipo === undefined || p.tipo === null || TIPOS_PADRE.has(p.tipo.toLowerCase()));

const aVariante = (v: z.output<typeof VarianteV1>) => ({ id: v.id, sku: v.sku, color: v.color, talle: v.talle, precio: v.precioMinorista, cantidad: v.publicable });

export const VarianteStocker = VarianteV1.transform(aVariante);
export type VarianteStocker = z.output<typeof VarianteStocker>;

const aProducto = (p: z.output<typeof ProductoV1>) => ({
  id: p.id,
  sku: p.skuAgrupador,
  titulo: p.titulo,
  descripcion: p.descripcion,
  categoria: p.categoria,
  genero: p.genero,
  modelo: p.modelo,
  precio: p.precioMinorista,
  // Una variante dada de baja en Stocker no se vende: es como si no viniera. Tampoco las de pack o combo.
  variantes: p.variantes.filter((v) => v.activo && !v.esPack && !v.esCombo).map(aVariante),
});
export const ProductoStocker = ProductoV1.transform(aProducto);
export type ProductoStocker = z.output<typeof ProductoStocker>;

export const CatalogoStocker = z.object({
  negocio: z.number().int().positive(),
  generadoEn: z.iso.datetime({ offset: true }),
  /** Stocker cortó la lista: lo que no vino NO es una baja. */
  truncado: z.boolean().optional().default(false),
  sinLocalesOnline: z.boolean().optional().default(false),
  productos: z.array(ProductoV1).max(20_000),
}).transform(({ generadoEn, productos, ...c }) => ({
  ...c,
  generado: generadoEn,
  // Lo que no es padre no entra: es como si no viniera (si ya estaba en la tienda, se da de baja).
  productos: productos.filter(esPadre).map(aProducto),
}));
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

/*
 * ── Pedidos de la tienda (contrato v1 de Stocker, tanda 2) ─────────
 *
 * Todo lo que la tienda le manda va en el sobre del contrato:
 *
 *   { contrato: 1, tipo: "venta", id: "isu:ISU-1042", ocurrioEn, datos: { pedidoExterno, … } }
 *
 * El `id` es la idempotencia: el mismo pedido reenviado lleva siempre el mismo,
 * y Stocker lo aparta una sola vez. Stocker contesta con el código según el
 * estado: 201 lo tomó, 200 ya lo tenía, 409 no hay stock (no apartó nada),
 * 202 lo guardó pero todavía no lo resolvió (no hay nada apartado).
 */
export const CONTRATO = 1;
export const PREFIJO = "isu";
const sobre = (tipo: string, id: string, ocurrioEn: Date | string, datos: Record<string, unknown>) =>
  ({ contrato: CONTRATO, tipo, id: `${PREFIJO}:${id}`, ocurrioEn: new Date(ocurrioEn).toISOString(), datos });

const textoONull = z.string().max(2000).nullable().optional().transform((v) => v ?? null);

export const RespuestaPedido = z.object({
  pedidoExterno: z.string().max(80).nullable().optional().transform((v) => v ?? null),
  /** pendiente · aceptado · parcial · rechazado · cancelado */
  estado: z.string().min(1).max(30),
  motivo: textoONull,
  repetido: z.boolean().optional().default(false),
});
export type RespuestaPedido = z.output<typeof RespuestaPedido>;

/** Lo que faltó, leído del motivo del rechazo («Sin stock para despachar. A: pide 2 y faltan 1; …»). */
export interface FaltanteStocker { sku: string; pide: number | null; hay: number | null }
export function leerFaltantes(motivo: string | null): FaltanteStocker[] {
  if (!motivo) return [];
  const resto = motivo.replace(/^\s*Sin stock para despachar\.\s*/i, "");
  const out: FaltanteStocker[] = [];
  for (const parte of resto.split(/;\s*/).slice(0, 200)) {
    const t = parte.trim().replace(/\.$/, "");
    const m = /^(\S{1,100}): pide (\d{1,6}) y faltan (\d{1,6})$/.exec(t);
    if (m) { const pide = Number(m[2]), falta = Number(m[3]); out.push({ sku: m[1]!, pide, hay: Math.max(0, pide - falta) }); continue; }
    // Dos pedidos por la última unidad: no se sabe cuánto queda.
    const c = /^(\S{1,100}): se apartó para otro pedido/.exec(t);
    if (c) out.push({ sku: c[1]!, pide: null, hay: null });
  }
  return out;
}

export interface NuevoPedidoStocker {
  numero: string;
  /** Cuándo se hizo el pedido en la tienda. */
  ocurrioEn: Date | string;
  items: Array<{ sku: string; cantidad: number; precioUnitario?: number }>;
  comprador: { nombre: string; email: string; documento?: string };
  total: number;           // en pesos (como lo guarda Stocker)
  pagoPendiente: boolean;
  pagoDetalle?: string;
  /** Hasta cuándo se aparta sin cobrar (Stocker libera solo después, con un tope de 7 días). */
  pagoVenceEn?: Date | string;
  /** Con qué sale (lo ve el depósito); `despacharAntesDe`: corte de los envíos en el día. */
  envio?: DatosEnvioStocker;
}

/** correo_argentino · andreani · oca · mercado_envios · cabify · retiro · envio */
export interface DatosEnvioStocker { tipo?: string; seguimiento?: string; despacharAntesDe?: string }

export const RespuestaCancelacion = z.object({
  /** cancelado · ya_cancelado · no_existe */
  accion: z.string().max(30),
  liberadas: z.number().int().optional(),
  /** Ya se había despachado: Stocker no devuelve el stock (si vuelve, entra por devolución). */
  yaSalio: z.boolean().optional().default(false),
});
export type RespuestaCancelacion = z.output<typeof RespuestaCancelacion>;

export const RespuestaEnvio = z.object({
  pedidoExterno: z.string().max(80).nullable().optional(),
  seguimiento: z.string().max(80).nullable().optional().transform((v) => v ?? null),
  envioTipo: z.string().max(40).nullable().optional().transform((v) => v ?? null),
  despacharAntesDe: z.string().max(40).nullable().optional().transform((v) => v ?? null),
});
export type RespuestaEnvio = z.output<typeof RespuestaEnvio>;

const Importe = z.union([z.number(), z.string()]).nullable().optional().transform((v) => (v === null || v === undefined || v === "" ? null : Number(v)));
export const RespuestaCobro = z.object({
  movimientoExterno: z.string().max(80),
  pedidoExterno: z.string().max(80).nullable().optional().transform((v) => v ?? null),
  /** false: Stocker lo anotó pero no lo aplicó (pedido cancelado, operación repetida): lo mira una persona. */
  aplicado: z.boolean(),
  motivo: textoONull,
  pagoEstado: z.string().max(30).nullable().optional().transform((v) => v ?? null),
  cobrado: Importe,
  repetido: z.boolean().optional().default(false),
});
export type RespuestaCobro = z.output<typeof RespuestaCobro>;

export interface CobroStocker {
  numero: string;
  /** Id propio del cobro (el del pago en la tienda): el mismo cobro reenviado lleva siempre el mismo. */
  cobro: string;
  importe: number;         // en pesos
  medio: string;
  operacion?: string | null;
  ocurrioEn: Date | string;
}

/* El feed de novedades: qué pasó con los pedidos después de la respuesta del POST. */
const fechaONull = z.union([z.string().max(40), z.date()]).nullable().optional().transform((v) => (v ? new Date(v).toISOString() : null));
export const CambioPedido = z.object({
  pedidoExterno: z.string().max(80),
  /** despachado · faltante · cancelado · o el estado (aceptado, parcial, rechazado…) */
  cambio: z.string().max(30),
  estado: z.string().max(30).nullable().optional().transform((v) => v ?? null),
  estadoEnvio: z.string().max(30).nullable().optional().transform((v) => v ?? null),
  pagoEstado: z.string().max(30).nullable().optional().transform((v) => v ?? null),
  seguimiento: z.string().max(80).nullable().optional().transform((v) => v ?? null),
  envioTipo: z.string().max(40).nullable().optional().transform((v) => v ?? null),
  despachadoEn: fechaONull,
  canceladoEn: fechaONull,
  motivo: textoONull,
  en: fechaONull,
});
export type CambioPedido = z.output<typeof CambioPedido>;
export const Resoluciones = z.object({
  /** Opaco: se manda tal cual en la próxima vuelta. */
  cursor: z.string().min(1).max(300),
  cambios: z.array(CambioPedido).max(1000),
  hayMas: z.boolean().optional().default(false),
});
export type Resoluciones = z.output<typeof Resoluciones>;

export interface ClienteStocker {
  catalogo(): Promise<CatalogoStocker>;
  stock(skus: string[]): Promise<StockStocker>;
  /** Aparta el pedido. 409 (sin stock) y 202 (sin resolver) vuelven como respuesta, no como error. */
  crearPedido(p: NuevoPedidoStocker): Promise<RespuestaPedido & { status: number; faltantes: FaltanteStocker[] }>;
  /** Libera lo apartado. null: Stocker no tiene ese pedido. */
  cancelarPedido(numero: string, motivo: string): Promise<RespuestaCancelacion | null>;
  /** La etiqueta ya existe: transporte y número de seguimiento para Envíos del día. */
  cargarEnvio(numero: string, envio: DatosEnvioStocker): Promise<RespuestaEnvio>;
  /** Un cobro del pedido (sin cobro el depósito no lo despacha). */
  registrarCobro(c: CobroStocker): Promise<RespuestaCobro>;
  /** Novedades desde el cursor (sin cursor: el cursor de ahora, sin historia). */
  resoluciones(desde: string | null, limite?: number): Promise<Resoluciones>;
}

export function crearClienteStocker({ url, token }: { url: string; token: string }): ClienteStocker {
  const base = url.replace(/\/+$/, "");

  async function pedir(ruta: string, timeoutMs: number, metodo: "GET" | "POST" = "GET", cuerpo?: unknown, aceptar: number[] = []): Promise<{ status: number; cuerpo: unknown }> {
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
    if (aceptar.includes(r.status)) {
      try { return { status: r.status, cuerpo: await r.json() }; } catch { throw new ErrorStocker(`Stocker contestó ${r.status} sin cuerpo`, r.status); }
    }
    if (!r.ok) {
      let mensaje = `Stocker contestó ${r.status}`;
      let codigo: string | null = null;
      try { const j = (await r.json()) as { message?: string; codigo?: string }; if (j.message) mensaje += `: ${j.message}`; codigo = j.codigo ?? null; } catch { /* sin cuerpo */ }
      throw new ErrorStocker(mensaje, r.status, codigo);
    }
    return { status: r.status, cuerpo: await r.json() };
  }
  const leer = <T extends z.ZodType>(esquema: T, x: unknown, que: string): z.output<T> => {
    const r = esquema.safeParse(x);
    if (!r.success) throw new ErrorStocker(`${que} de Stocker con formato inesperado: ${r.error.issues.slice(0, 3).map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
    return r.data;
  };
  const num = (n: string) => encodeURIComponent(n);
  const sinNulos = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ""));

  return {
    async catalogo() {
      const r = CatalogoStocker.safeParse((await pedir("/catalogo", 60_000)).cuerpo);
      if (!r.success) throw new ErrorStocker(`Catálogo de Stocker con formato inesperado: ${r.error.issues.slice(0, 3).map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
      return r.data;
    },
    async stock(skus) {
      if (skus.length > MAX_SKUS_POR_PEDIDO) throw new RangeError(`Como mucho ${MAX_SKUS_POR_PEDIDO} SKU por pedido`);
      const q = new URLSearchParams({ skus: skus.join(",") });
      const r = StockStocker.safeParse((await pedir(`/stock?${q}`, 15_000)).cuerpo);
      if (!r.success) throw new ErrorStocker("Stock de Stocker con formato inesperado");
      return r.data;
    },
    async crearPedido(p) {
      const datos = sinNulos({
        pedidoExterno: p.numero,
        items: p.items,
        comprador: sinNulos(p.comprador),
        total: p.total,
        pagoPendiente: p.pagoPendiente,
        pagoDetalle: p.pagoDetalle,
        pagoVenceEn: p.pagoVenceEn ? new Date(p.pagoVenceEn).toISOString() : undefined,
        envio: p.envio ? sinNulos({ ...p.envio }) : undefined,
      });
      // 409 = sin stock y 202 = guardado sin resolver: son respuestas, traen el estado.
      const r = await pedir("/pedidos", 20_000, "POST", sobre("venta", p.numero, p.ocurrioEn, datos), [409, 202]);
      const x = leer(RespuestaPedido, r.cuerpo, "Pedido");
      return { ...x, status: r.status, faltantes: x.estado === "rechazado" ? leerFaltantes(x.motivo) : [] };
    },
    async cancelarPedido(numero, motivo) {
      try {
        const r = await pedir(`/pedidos/${num(numero)}/cancelar`, 15_000, "POST", sobre("cancelacion", numero, new Date(), { motivo: motivo.slice(0, 300) }));
        return leer(RespuestaCancelacion, r.cuerpo, "Cancelación");
      } catch (e) {
        if (e instanceof ErrorStocker && e.status === 404) return null;
        throw e;
      }
    },
    async cargarEnvio(numero, envio) {
      const r = await pedir(`/pedidos/${num(numero)}/envio`, 10_000, "POST", sinNulos({ ...envio }));
      return leer(RespuestaEnvio, r.cuerpo, "Envío");
    },
    async registrarCobro(c) {
      const r = await pedir("/cobros", 15_000, "POST", sobre("cobro", `${c.numero}-C${c.cobro}`, c.ocurrioEn, sinNulos({
        ventaId: `${PREFIJO}:${c.numero}`,
        importe: c.importe,
        medio: c.medio.slice(0, 30),
        operacion: c.operacion ? c.operacion.slice(0, 60) : undefined,
      })));
      return leer(RespuestaCobro, r.cuerpo, "Cobro");
    },
    async resoluciones(desde, limite = 100) {
      const q = new URLSearchParams({ limite: String(Math.min(Math.max(1, limite), 500)) });
      if (desde) q.set("desde", desde);
      return leer(Resoluciones, (await pedir(`/pedidos/resoluciones?${q}`, 20_000)).cuerpo, "Novedades");
    },
  };
}
