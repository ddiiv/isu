import type pg from "pg";
import type { Redis } from "ioredis";
import {
  AjusteTransportes, cpEnRangos, EnviosEnElDia, NOMBRE_TRANSPORTE, OrigenEnvios, PaqueteEnvios, TRANSPORTES,
  type MedioPago, type OpcionEnvio, type ServicioEnvio, type SucursalEnvio, type TransporteTienda,
} from "@isu/shared";
import type { Cotizacion as CotizacionTransporte, Paquete, Transportes } from "@isu/envios";
import { ErrorHttp } from "../../lib/errores.js";
import type { Fila } from "../pedidos/cotizar.js";

/*
 * Cuánto cuesta mandar un carrito a un código postal, con cada transporte.
 *
 * Se le pregunta a cada uno en paralelo, con un tiempo máximo: si uno tarda
 * o está caído, el cliente igual ve los demás (y se avisa). Las respuestas se
 * guardan 30 minutos por destino, peso y caja: la misma consulta no le pega
 * dos veces a la API del correo mientras el cliente completa el checkout.
 *
 * El precio que se cobra lo decide SIEMPRE esto (del lado del servidor): el
 * navegador sólo dice qué opción eligió.
 */
export interface ConfigEnvios {
  transportes: AjusteTransportes;
  origen: OrigenEnvios;
  paquete: PaqueteEnvios;
  enElDia: EnviosEnElDia;
  envioGratisDesde: number | null;
  costoEnvio: number;
}
const POR_DEFECTO: ConfigEnvios = {
  transportes: Object.fromEntries(TRANSPORTES.map((t) => [t, { activo: true, domicilio: t !== "cabify", sucursal: !["mercado_envios", "cabify"].includes(t), recargo: 0 }])) as AjusteTransportes,
  origen: { nombre: "Isuwaya", calle: "Bacacay", numero: "3231", piso: "", cp: "1406", localidad: "Flores", provincia: "CABA", email: "isu.isuwaya@gmail.com", telefono: "1168515444", cuit: "" },
  paquete: { pesoPrendaGramos: 350, pesoCajaGramos: 150, cajas: [{ hastaPrendas: 99, altoCm: 20, anchoCm: 30, largoCm: 40 }] },
  enElDia: { cps: "", dias: [], horaCorte: "14:00" },
  envioGratisDesde: null,
  costoEnvio: 790_000,
};
const ESQUEMAS = { transportes: AjusteTransportes, origenEnvios: OrigenEnvios, paqueteEnvios: PaqueteEnvios, enviosEnElDia: EnviosEnElDia } as const;

export interface Destino { cp: string; provincia: string; localidad: string }
export interface Carrito { lineas: Array<{ sku: string; cantidad: number; subtotal: number }>; filas: Map<string, Fila>; neto: number }

const ZONA = "America/Argentina/Buenos_Aires";
const DIAS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>;
/** Día de la semana y hora (HH:MM) en Argentina. */
export function ahoraEnArgentina(d: Date) {
  const partes = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: ZONA, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d).map((p) => [p.type, p.value]));
  return { dia: DIAS[partes.weekday!] ?? -1, hora: `${partes.hour === "24" ? "00" : partes.hour}:${partes.minute}` };
}
/** Hoy a esa hora de Argentina (UTC-3 todo el año), como fecha. */
export function hoyA(hora: string, d = new Date()) {
  const fecha = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA }).format(d);
  return new Date(`${fecha}T${hora}:00-03:00`);
}

const plazoTexto = (c: CotizacionTransporte) => {
  if (c.plazoMin === null && c.plazoMax === null) return "";
  if (c.plazoMin === c.plazoMax || c.plazoMax === null) return `Llega en ${c.plazoMin} ${c.plazoMin === 1 ? "día hábil" : "días hábiles"}`;
  return `Llega en ${c.plazoMin ?? 1} a ${c.plazoMax} días hábiles`;
};
// Recargo y redondeo a $10.
const conRecargo = (precio: number, pct: number) => Math.max(0, Math.ceil((precio * (1 + pct / 100)) / 1000) * 1000);

export function crearCotizadorEnvios(deps: {
  pool: pg.Pool; redis: Redis; transportes: Transportes; log: { warn: (o: object, m: string) => void };
  ahora?: () => Date; timeoutMs?: number;
}) {
  const { pool, redis } = deps;
  const ahora = deps.ahora ?? (() => new Date());
  const hayTransportes = Object.keys(deps.transportes.adaptadores).length > 0;

  async function config(): Promise<ConfigEnvios> {
    const { rows } = await pool.query<{ clave: string; valor: unknown }>(
      "SELECT clave, valor FROM tienda.ajustes WHERE clave = ANY($1::text[])", [["transportes", "origenEnvios", "paqueteEnvios", "enviosEnElDia", "envioGratisDesde", "costoEnvio"]]);
    const c: ConfigEnvios = structuredClone(POR_DEFECTO);
    for (const r of rows) {
      if (r.clave === "envioGratisDesde") c.envioGratisDesde = typeof r.valor === "number" ? r.valor : null;
      else if (r.clave === "costoEnvio") { if (typeof r.valor === "number") c.costoEnvio = r.valor; }
      else {
        const esquema = ESQUEMAS[r.clave as keyof typeof ESQUEMAS];
        const v = esquema.safeParse(r.valor);
        if (!v.success) { deps.log.warn({ clave: r.clave }, "ajuste de envíos inválido: se usa el valor por defecto"); continue; }
        if (r.clave === "transportes") c.transportes = v.data as AjusteTransportes;
        if (r.clave === "origenEnvios") c.origen = v.data as OrigenEnvios;
        if (r.clave === "paqueteEnvios") c.paquete = v.data as PaqueteEnvios;
        if (r.clave === "enviosEnElDia") c.enElDia = v.data as EnviosEnElDia;
      }
    }
    return c;
  }

  /** El paquete: peso de cada prenda (o el de Ajustes) + la caja según cuántas prendas son. */
  function paquete(carrito: Carrito, cfg: ConfigEnvios): Paquete {
    let prendas = 0, gramos = cfg.paquete.pesoCajaGramos, valor = 0;
    for (const l of carrito.lineas) {
      const f = carrito.filas.get(l.sku);
      prendas += l.cantidad;
      gramos += (f?.peso_gramos ?? cfg.paquete.pesoPrendaGramos) * l.cantidad;
      valor += l.subtotal;
    }
    const cajas = [...cfg.paquete.cajas].sort((a, b) => a.hastaPrendas - b.hastaPrendas);
    const caja = cajas.find((c) => prendas <= c.hastaPrendas) ?? cajas.at(-1)!;
    return { pesoGramos: gramos, altoCm: caja.altoCm, anchoCm: caja.anchoCm, largoCm: caja.largoCm, valorDeclarado: Math.max(valor, carrito.neto) };
  }

  const enElDiaPosible = (cp: string, cfg: ConfigEnvios) => {
    const { dia, hora } = ahoraEnArgentina(ahora());
    return cpEnRangos(cp, cfg.enElDia.cps) && cfg.enElDia.dias.includes(dia) && hora < cfg.enElDia.horaCorte;
  };

  async function conCache<T>(clave: string, segundos: number, fn: () => Promise<T>): Promise<T> {
    const guardado = await redis.get(clave).catch(() => null);
    if (guardado) { try { return JSON.parse(guardado) as T; } catch { /* se vuelve a pedir */ } }
    const valor = await fn();
    await redis.set(clave, JSON.stringify(valor), "EX", segundos).catch(() => 0);
    return valor;
  }
  const conTiempo = <T>(p: Promise<T>) => Promise.race([p, new Promise<never>((_, no) => setTimeout(() => no(new Error("tiempo agotado")), deps.timeoutMs ?? 6000).unref())]);

  async function opciones(args: { destino: Destino; carrito: Carrito; medioPago?: MedioPago }): Promise<{ opciones: OpcionEnvio[]; aviso: string | null }> {
    const cfg = await config();
    const pq = paquete(args.carrito, cfg);
    const pedidos: Array<Promise<OpcionEnvio | null>> = [];
    const fallaron: string[] = [];

    for (const t of TRANSPORTES) {
      const a = deps.transportes.adaptadores[t];
      const aj = cfg.transportes[t];
      if (!a || !aj.activo) continue;
      if (t === "mercado_envios" && args.medioPago && args.medioPago !== "mercadopago") continue;
      const servicios: ServicioEnvio[] = t === "cabify"
        ? (enElDiaPosible(args.destino.cp, cfg) ? ["en_el_dia"] : [])
        : (["domicilio", "sucursal"] as const).filter((s) => aj[s] && a.servicios.includes(s));
      for (const s of servicios) {
        const clave = `isu:cotenv:${t}:${s}:${args.destino.cp}:${Math.ceil(pq.pesoGramos / 100)}:${pq.altoCm}x${pq.anchoCm}x${pq.largoCm}:${Math.ceil(pq.valorDeclarado / 1_000_000)}`;
        pedidos.push(conTiempo(conCache(clave, 1800, () => a.cotizar(args.destino, pq, s, cfg.origen)))
          .then((c): OpcionEnvio | null => {
            if (!c) return null;
            const precio = conRecargo(c.precio, aj.recargo);
            const esMe = t === "mercado_envios";
            return {
              id: `${t}:${s}`, transporte: t, servicio: s,
              nombre: s === "en_el_dia" ? `${NOMBRE_TRANSPORTE[t]} · llega hoy` : `${NOMBRE_TRANSPORTE[t]} ${s === "sucursal" ? "a sucursal" : "a domicilio"}`,
              detalle: s === "en_el_dia" ? `Si lo pagás antes de las ${cfg.enElDia.horaCorte}, te llega hoy` : esMe ? `${plazoTexto(c)} · el envío se paga en Mercado Pago`.replace(/^ · /, "") : plazoTexto(c),
              precio, precioOriginal: precio, gratis: false, requiereSucursal: s === "sucursal", llegaHoy: s === "en_el_dia", soloMercadoPago: esMe,
            };
          })
          .catch((e) => { fallaron.push(NOMBRE_TRANSPORTE[t]); deps.log.warn({ transporte: t, err: (e as Error).message }, "no se pudo cotizar"); return null; }));
      }
    }
    let lista = (await Promise.all(pedidos)).filter((o): o is OpcionEnvio => o !== null);

    // Sin transportes (o ninguno respondió): el envío de costo fijo, para no frenar la venta.
    if (!lista.length) {
      lista = [{ id: "estandar:domicilio", transporte: "estandar", servicio: "domicilio", nombre: "Envío a domicilio", detalle: "Te avisamos por email cuando sale", precio: cfg.costoEnvio, precioOriginal: cfg.costoEnvio, gratis: false, requiereSucursal: false, llegaHoy: false, soloMercadoPago: false }];
    }
    /*
     * Envío gratis desde cierto monto: la opción estándar más barata sale
     * gratis y las demás cuestan la diferencia. En el día y Mercado Envíos
     * (lo cobra Mercado Pago) no entran.
     */
    if (cfg.envioGratisDesde !== null && args.carrito.neto >= cfg.envioGratisDesde) {
      const estandar = lista.filter((o) => !o.llegaHoy && !o.soloMercadoPago);
      const minimo = Math.min(...estandar.map((o) => o.precio));
      if (Number.isFinite(minimo)) for (const o of estandar) { o.precio -= minimo; o.gratis = o.precio === 0; }
    }
    lista.sort((a, b) => Number(b.llegaHoy) - Number(a.llegaHoy) || a.precio - b.precio);
    const aviso = fallaron.length ? `${[...new Set(fallaron)].join(" y ")} no respondió: te mostramos las demás opciones.` : null;
    return { opciones: lista, aviso };
  }

  /** La opción que eligió el cliente, recalculada ahora. Si ya no está, 409. */
  async function elegir(args: { destino: Destino; carrito: Carrito; medioPago?: MedioPago; id: string }) {
    const r = await opciones(args);
    const o = r.opciones.find((x) => x.id === args.id);
    if (!o) throw new ErrorHttp(409, "envio_no_disponible", "Esa forma de envío ya no está disponible para tu código postal. Elegí otra.", { opciones: r.opciones });
    return o;
  }

  async function sucursales(transporte: TransporteTienda, cp: string, provincia: string | null): Promise<SucursalEnvio[]> {
    const a = deps.transportes.adaptadores[transporte];
    if (!a?.sucursales) return [];
    return conCache(`isu:sucenv:${transporte}:${cp}:${provincia ?? ""}`, 12 * 3600, () => conTiempo(a.sucursales!(cp, provincia)));
  }

  return { hayTransportes, config, paquete, opciones, elegir, sucursales, enElDiaPosible };
}
export type CotizadorEnvios = ReturnType<typeof crearCotizadorEnvios>;
