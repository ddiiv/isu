import type { Job, Queue } from "bullmq";
import type pg from "pg";
import type { Redis } from "ioredis";
import type { ClienteStocker } from "./stocker/cliente.js";
import { MAX_SKUS_POR_PEDIDO } from "./stocker/cliente.js";
import { aplicarCatalogo, aplicarStock, registrar } from "./stocker/sincronizar.js";
import type { Invalidador } from "./stocker/invalidar.js";
import type { Envios } from "./envios/envios.js";
import type { Whatsapp } from "@isu/envios";

/*
 * Qué hace cada trabajo de cada cola.
 *
 * stocker/catalogo  catálogo completo: al arrancar, cada 10 minutos y cuando
 *                   aparece un SKU que la tienda no conoce.
 * stocker/stock     stock de unas variantes (aviso stock_cambio de Stocker) o SKU (pedido).
 * stocker/latido    prueba de punta a punta (Redis → cola → worker).
 * stocker/pagado    avisarle a Stocker que un pedido se cobró (sin esto no se despacha).
 * stocker/cliente   alta o actualización del cliente en Stocker.
 * stocker/invalidar el backoffice cambió la vidriera: regenerar páginas (ISR).
 * stocker/envio    el número de seguimiento al pedido de Stocker (Envíos del día).
 * notificaciones/email · notificaciones/whatsapp   avisos al cliente.
 * envios/despachado      Stocker despachó (o le falta mercadería): el pedido sale.
 * envios/seguimiento     cada 10 minutos, los envíos a los que les toca.
 * envios/seguir          uno ya (botón "Actualizar" del backoffice).
 * envios/revisar-despachos  repaso por si se perdió un aviso de Stocker.
 * envios/pedir-resenas   cada hora: el mail para opinar de las compras ya entregadas.
 * envios/mercado-envios  trae el envío que creó Mercado Pago con el pago.
 * pagos/vencer · pagos/conciliar-mp   los corre la API (tiene la lógica del pedido);
 *                   el worker sólo marca el ritmo (cada 1 y 10 minutos).
 */
export type Procesador = (trabajo: Job) => Promise<unknown>;

export interface Dependencias {
  pool: pg.Pool;
  redis: Redis;
  stocker: ClienteStocker;
  invalidar: Invalidador;
  cola: Pick<Queue, "add">;
}

export const CLAVE_NEGOCIO = "isu:stocker:negocio";

export interface Extras {
  correo?: (datos: unknown) => Promise<unknown>;
  /** POST a una ruta interna de la API (con la credencial interna). */
  api?: (ruta: string) => Promise<unknown>;
  envios?: Envios;
  whatsapp?: Whatsapp | null;
}

const NUMERO = /^ISU-\d{4,10}$/;
const sinReintento = (m: string) => Object.assign(new Error(m), { sinReintento: true });

export function crearProcesadores(deps?: Dependencias, extras: Extras = {}): Record<string, Record<string, Procesador>> {
  const necesita = () => {
    if (!deps) throw Object.assign(new Error("Falta configurar Stocker (STOCKER_API_URL / STOCKER_TOKEN)"), { sinReintento: true });
    return deps;
  };

  return {
    stocker: {
      latido: async (t) => ({ ok: true, recibido: t.data, en: new Date().toISOString() }),

      catalogo: async () => {
        const d = necesita();
        const cat = await d.stocker.catalogo();
        await d.redis.set(CLAVE_NEGOCIO, String(cat.negocio));
        const r = await registrar(d.pool, "catalogo", () => aplicarCatalogo(d.pool, cat));
        if (r.cambios > 0) await d.invalidar(r.afectados);
        // Los renglones de stock son muchos (uno por venta): se guardan una semana.
        await d.pool.query("DELETE FROM tienda.sincronizaciones WHERE tipo = 'stock' AND inicio < now() - interval '7 days'");
        if (cat.truncado) console.warn(`[stocker] el catálogo vino cortado (truncado): se aplicaron ${cat.productos.length} productos y no se dio de baja ninguno.`);
        return { ...r, afectados: r.afectados.length, sinLocalesOnline: cat.sinLocalesOnline, truncado: cat.truncado };
      },

      stock: async (t) => {
        const d = necesita();
        // El aviso de Stocker (stock_cambio) trae ids de variante; la API, después de un pedido, manda SKU.
        const ids = Array.isArray(t.data?.variantes) ? (t.data.variantes as unknown[]).filter((n): n is number => Number.isInteger(n) && (n as number) > 0).slice(0, MAX_SKUS_POR_PEDIDO) : [];
        const skus = Array.isArray(t.data?.skus) ? (t.data.skus as unknown[]).filter((s): s is string => typeof s === "string").slice(0, MAX_SKUS_POR_PEDIDO) : [];
        let variantesNuevas = 0;
        if (ids.length) {
          const { rows } = await d.pool.query<{ sku: string; stocker_id: number }>("SELECT sku, stocker_id FROM tienda.variantes WHERE stocker_id = ANY($1::int[])", [ids]);
          for (const r of rows) if (!skus.includes(r.sku)) skus.push(r.sku);
          variantesNuevas = ids.length - rows.length;
        }
        const catalogoNuevo = () => d.cola.add("catalogo", {}, { jobId: "catalogo-por-sku-nuevo", delay: 20_000, removeOnComplete: true, removeOnFail: true });
        // Una variante que la tienda no conoce: producto recién cargado en Stocker. Un solo catálogo aunque lleguen muchos avisos.
        if (variantesNuevas) await catalogoNuevo();
        if (!skus.length) return { cambios: 0, variantesNuevas };
        const s = await d.stocker.stock(skus.slice(0, MAX_SKUS_POR_PEDIDO));
        const r = await registrar(d.pool, "stock", async () => ({ ...(await aplicarStock(d.pool, s)), variantes: skus.length }));
        if (r.cambios > 0) await d.invalidar(r.afectados);
        if (r.desconocidos.length && !variantesNuevas) await catalogoNuevo();
        if (s.desconocidos.length) {
          // Stocker no conoce un SKU que la tienda tiene: no es «sin stock», es un error de catálogo
          // (un SKU corregido en Stocker). El stock de esa variante no se toca; el próximo catálogo la da de baja.
          console.warn(`[stocker] SKU que Stocker no conoce: ${s.desconocidos.slice(0, 10).join(", ")}${s.desconocidos.length > 10 ? ` y ${s.desconocidos.length - 10} más` : ""}. Se pide el catálogo.`);
          await catalogoNuevo();
        }
        return { cambios: r.cambios, desconocidos: r.desconocidos.length, desconocidosEnStocker: s.desconocidos.length, variantesNuevas };
      },

      pagado: async (t) => {
        const d = necesita();
        const numero = String(t.data?.numero ?? "");
        if (!/^ISU-\d{4,10}$/.test(numero)) throw Object.assign(new Error("Número de pedido inválido"), { sinReintento: true });
        try {
          const r = await d.stocker.marcarPagado(numero, String(t.data?.detalle ?? "Pagado").slice(0, 120));
          return { estado: r.estado, pagoPendiente: r.pagoPendiente };
        } catch (e) {
          // Cancelado del otro lado (venció justo): no tiene arreglo reintentando; lo ve una persona.
          if ((e as { status?: number }).status === 409 || (e as { status?: number }).status === 404) throw Object.assign(e as Error, { sinReintento: true });
          throw e;
        }
      },

      invalidar: async (t) => {
        const d = necesita();
        const slugs = Array.isArray(t.data?.slugs) ? (t.data.slugs as unknown[]).filter((s): s is string => typeof s === "string" && /^[a-z0-9-]{1,80}$/.test(s)).slice(0, 500) : [];
        await d.invalidar(slugs);
        return { slugs: slugs.length };
      },

      envio: async (t) => {
        const d = necesita();
        const numero = String(t.data?.numero ?? "");
        const tipo = String(t.data?.tipo ?? "");
        const seguimiento = t.data?.seguimiento === undefined || t.data.seguimiento === null ? undefined : String(t.data.seguimiento);
        if (!NUMERO.test(numero) || !/^[a-z_]{3,20}$/.test(tipo)) throw sinReintento("Datos de envío inválidos");
        try {
          const r = await d.stocker.cargarEnvio(numero, { tipo, seguimiento });
          return { envioTipo: r.envioTipo, envioId: r.envioId };
        } catch (e) {
          // Ya despachado con otro número, o el pedido no está: lo ve una persona.
          if ([404, 409].includes((e as { status?: number }).status ?? 0)) throw Object.assign(e as Error, { sinReintento: true });
          throw e;
        }
      },

      cliente: async (t) => {
        const d = necesita();
        const c = t.data ?? {};
        const limpio = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
        return d.stocker.guardarCliente({
          email: String(c.email ?? ""), nombre: limpio(c.nombre), apellido: limpio(c.apellido), telefono: limpio(c.telefono), dni: limpio(c.dni),
        });
      },
    },
    notificaciones: {
      email: async (t) => {
        if (!extras.correo) throw Object.assign(new Error("Correo sin configurar"), { sinReintento: true });
        return extras.correo(t.data);
      },
      whatsapp: async (t) => {
        if (!extras.whatsapp) throw sinReintento("WhatsApp sin configurar");
        const tel = String(t.data?.telefono ?? "");
        const plantilla = String(t.data?.plantilla ?? "");
        const parametros = Array.isArray(t.data?.parametros) ? (t.data.parametros as unknown[]).map((p) => String(p).slice(0, 200)).slice(0, 10) : [];
        if (!/^549\d{10}$/.test(tel)) throw sinReintento("Teléfono inválido");
        try {
          return await extras.whatsapp.plantilla(tel, plantilla, parametros);
        } catch (e) {
          // Meta rechaza (plantilla no aprobada, número sin WhatsApp): reintentar no lo arregla.
          if ((e as { reintentable?: boolean }).reintentable === false) throw Object.assign(e as Error, { sinReintento: true });
          throw e;
        }
      },
    },
    envios: {
      despachado: async (t) => {
        const e = extras.envios ?? (() => { throw sinReintento("Envíos sin configurar"); })();
        const numero = String(t.data?.numero ?? "");
        const que = t.data?.evento === "faltante" ? "faltante" : "despachado";
        if (!NUMERO.test(numero)) throw sinReintento("Número de pedido inválido");
        return e.despachado(numero, que);
      },
      seguimiento: async () => {
        if (!extras.envios) throw sinReintento("Envíos sin configurar");
        return extras.envios.seguirPendientes();
      },
      seguir: async (t) => {
        if (!extras.envios) throw sinReintento("Envíos sin configurar");
        const id = Number(t.data?.envioId);
        if (!Number.isInteger(id) || id <= 0) throw sinReintento("Envío inválido");
        return extras.envios.seguir(id);
      },
      "revisar-despachos": async () => {
        if (!extras.envios) throw sinReintento("Envíos sin configurar");
        return extras.envios.revisarDespachos();
      },
      // Etapa 8: "¿Qué te pareció tu compra?" (una vez por pedido).
      "pedir-resenas": async () => {
        if (!extras.envios) throw sinReintento("Envíos sin configurar");
        return extras.envios.pedirResenas();
      },
      "mercado-envios": async (t) => {
        if (!extras.envios) throw sinReintento("Envíos sin configurar");
        const numero = String(t.data?.numero ?? "");
        const pagoId = String(t.data?.pagoId ?? "");
        if (!NUMERO.test(numero) || !/^\d{1,20}$/.test(pagoId)) throw sinReintento("Datos inválidos");
        return extras.envios.mercadoEnvios(numero, pagoId);
      },
    },
    pagos: {
      vencer: async () => {
        if (!extras.api) throw Object.assign(new Error("Falta API_URL / INTERNO_TOKEN en el worker"), { sinReintento: true });
        return extras.api("/v1/interno/vencer");
      },
      "conciliar-mp": async () => {
        if (!extras.api) throw Object.assign(new Error("Falta API_URL / INTERNO_TOKEN en el worker"), { sinReintento: true });
        return extras.api("/v1/interno/conciliar-mp");
      },
    },
  };
}

export function crearProcesar(deps?: Dependencias, extras: Extras = {}) {
  const tabla = crearProcesadores(deps, extras);
  return async function procesar(cola: string, trabajo: Job) {
    const p = Object.hasOwn(tabla, cola) ? tabla[cola]?.[trabajo.name] : undefined;
    // Un trabajo desconocido falla sin reintentos: reintentarlo no lo va a arreglar.
    if (!p || !Object.hasOwn(tabla[cola]!, trabajo.name)) {
      throw Object.assign(new Error(`Trabajo desconocido: ${cola}/${trabajo.name}`), { sinReintento: true });
    }
    return p(trabajo);
  };
}

/* Sin dependencias: sólo el latido (lo usan las pruebas de la cola). */
export const procesar = crearProcesar();
