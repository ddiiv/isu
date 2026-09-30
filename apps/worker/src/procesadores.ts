import type { Job, Queue } from "bullmq";
import type pg from "pg";
import type { Redis } from "ioredis";
import type { ClienteStocker } from "./stocker/cliente.js";
import { MAX_SKUS_POR_PEDIDO } from "./stocker/cliente.js";
import { aplicarCatalogo, aplicarStock, registrar } from "./stocker/sincronizar.js";
import type { Invalidador } from "./stocker/invalidar.js";

/*
 * Qué hace cada trabajo de cada cola.
 *
 * stocker/catalogo  catálogo completo: al arrancar, cada 10 minutos y cuando
 *                   aparece un SKU que la tienda no conoce.
 * stocker/stock     stock de unos SKU, después de un aviso de Stocker.
 * stocker/latido    prueba de punta a punta (Redis → cola → worker).
 * stocker/pagado    avisarle a Stocker que un pedido se cobró (sin esto no se despacha).
 * stocker/cliente   alta o actualización del cliente en Stocker.
 * stocker/invalidar el backoffice cambió la vidriera: regenerar páginas (ISR).
 * notificaciones/email   mails al cliente.
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
}

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
        return { ...r, afectados: r.afectados.length, sinLocalesOnline: cat.sinLocalesOnline };
      },

      stock: async (t) => {
        const d = necesita();
        const skus = Array.isArray(t.data?.skus) ? (t.data.skus as unknown[]).filter((s): s is string => typeof s === "string").slice(0, MAX_SKUS_POR_PEDIDO) : [];
        if (!skus.length) return { cambios: 0 };
        const s = await d.stocker.stock(skus);
        const r = await registrar(d.pool, "stock", async () => ({ ...(await aplicarStock(d.pool, s)), variantes: skus.length }));
        if (r.cambios > 0) await d.invalidar(r.afectados);
        if (r.desconocidos.length) {
          // Un SKU nuevo: producto recién cargado en Stocker. Un solo catálogo aunque lleguen muchos avisos.
          await d.cola.add("catalogo", {}, { jobId: "catalogo-por-sku-nuevo", delay: 20_000, removeOnComplete: true, removeOnFail: true });
        }
        return { cambios: r.cambios, desconocidos: r.desconocidos.length };
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
    },
    envios: {},
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
