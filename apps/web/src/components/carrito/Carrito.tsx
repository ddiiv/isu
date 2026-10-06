"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { MAX_LINEAS_CARRITO, MAX_UNIDADES_POR_ARTICULO, type Cotizacion } from "@isu/shared";
import { api } from "@/lib/cliente-api";
import { evento, pesos } from "@/lib/ga";

/*
 * El carrito vive en el navegador (localStorage): agregar y sacar es
 * instantáneo y no le pega a la base por cada clic. Lo que se guarda es sólo
 * SKU y cantidad (más lo necesario para dibujarlo); precios, stock, envío y
 * descuentos los calcula SIEMPRE la API al cotizar.
 *
 * El cupón también: se guarda el código que escribió el cliente y la API
 * dice si sirve. Si no se aplicó (no existe, venció, falta monto…), se
 * muestra por qué y se descarta: no se sigue mandando en cada cotización.
 */
export interface LineaCarrito { sku: string; cantidad: number; nombre: string; slug: string; color: string | null; talle: string | null; precio: number; foto: string | null }

interface Ctx {
  lineas: LineaCarrito[];
  unidades: number;
  abierto: boolean;
  abrir(): void;
  cerrar(): void;
  agregar(l: Omit<LineaCarrito, "cantidad">, cantidad?: number): void;
  /** Un pack: varias prendas de una (las iguales se suman) y el cajón se abre una sola vez. */
  agregarVarias(ls: Array<Omit<LineaCarrito, "cantidad">>): void;
  cambiar(sku: string, cantidad: number): void;
  quitar(sku: string): void;
  vaciar(): void;
  cotizacion: Cotizacion | null;
  cotizando: boolean;
  cotizar(opciones?: OpcionesCotizar): Promise<Cotizacion | null>;
  /** código de cupón aplicado (o recién escrito, mientras se valida) */
  cupon: string | null;
  ponerCupon(codigo: string | null): void;
  /** por qué el último cupón escrito no se aplicó, o un aviso sobre la promo */
  avisoCupon: string | null;
}
const Contexto = createContext<Ctx | null>(null);
const CLAVE = "isu:carrito";
const CLAVE_CUPON = "isu:cupon";
const normalizar = (c: string) => c.trim().toUpperCase().replace(/\s+/g, "");
/** `envio`: la opción de envío elegida en el checkout (la API la vuelve a cotizar y la suma). */
export interface OpcionesCotizar {
  entrega?: "envio" | "retiro"; medioPago?: string;
  envio?: { cp: string; provincia: string; localidad: string; opcion: string };
}

export function ProveedorCarrito({ children }: { children: React.ReactNode }) {
  const [lineas, setLineas] = useState<LineaCarrito[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [cotizacion, setCotizacion] = useState<Cotizacion | null>(null);
  const [cotizando, setCotizando] = useState(false);
  const [cupon, setCupon] = useState<string | null>(null);
  const [avisoCupon, setAvisoCupon] = useState<string | null>(null);
  // Con qué se cotizó la última vez (el checkout manda entrega y pago): al cambiar el cupón se repite igual.
  const ultimas = useRef<OpcionesCotizar>({});
  // Nada se guarda hasta haber leído lo guardado: si no, el carrito vacío del
  // primer dibujo pisa el de verdad (React en desarrollo corre los efectos dos veces).
  const [cargado, setCargado] = useState(false);

  useEffect(() => {
    try {
      const g = JSON.parse(localStorage.getItem(CLAVE) ?? "[]");
      if (Array.isArray(g)) setLineas(g.filter((l) => typeof l?.sku === "string" && Number.isInteger(l?.cantidad)).slice(0, MAX_LINEAS_CARRITO));
      const cu = localStorage.getItem(CLAVE_CUPON);
      if (cu && /^[A-Z0-9_-]{3,30}$/.test(cu)) setCupon(cu);
    } catch { /* carrito roto: se empieza de cero */ }
    setCargado(true);
    // Otra pestaña cambió el carrito.
    const alCambiar = (e: StorageEvent) => { if (e.key === CLAVE) { try { setLineas(JSON.parse(e.newValue ?? "[]")); } catch { /* */ } } };
    window.addEventListener("storage", alCambiar);
    return () => window.removeEventListener("storage", alCambiar);
  }, []);
  useEffect(() => {
    if (!cargado) return;
    try { localStorage.setItem(CLAVE, JSON.stringify(lineas)); } catch { /* modo privado */ }
  }, [lineas, cargado]);
  useEffect(() => {
    if (!cargado) return;
    try { if (cupon) localStorage.setItem(CLAVE_CUPON, cupon); else localStorage.removeItem(CLAVE_CUPON); } catch { /* modo privado */ }
  }, [cupon, cargado]);

  const cotizar = useCallback(async (opciones: OpcionesCotizar = {}) => {
    ultimas.current = opciones;
    if (!lineas.length) { setCotizacion(null); return null; }
    setCotizando(true);
    try {
      const c = await api<Cotizacion>("carrito", { cuerpo: { items: lineas.map(({ sku, cantidad }) => ({ sku, cantidad })), ...opciones, ...(cupon ? { cupon } : {}) } });
      setCotizacion(c);
      if (cupon) {
        // No se aplicó: se dice por qué y se deja de mandar.
        if (c.cupon?.codigo !== cupon) { setAvisoCupon(c.avisoCupon ?? "Ese cupón no se puede usar."); setCupon(null); }
        else setAvisoCupon(null);
      }
      // Los precios guardados se actualizan con los de verdad.
      setLineas((ls) => ls.map((l) => { const x = c.lineas.find((y) => y.sku === l.sku); return x && x.precio !== l.precio ? { ...l, precio: x.precio } : l; }));
      return c;
    } catch {
      return null;
    } finally {
      setCotizando(false);
    }
  }, [lineas, cupon]);
  // Cupón nuevo (o quitado): se vuelve a cotizar con lo mismo de la última vez.
  useEffect(() => {
    if (cargado && lineas.length) void cotizar(ultimas.current);
    // Dependencias a propósito: sólo cuando cambia el cupón
  }, [cupon]);

  const valor = useMemo<Ctx>(() => ({
    lineas,
    unidades: lineas.reduce((a, l) => a + l.cantidad, 0),
    abierto,
    abrir: () => { setAbierto(true); evento("view_cart", { currency: "ARS", value: pesos(lineas.reduce((a, l) => a + l.precio * l.cantidad, 0)) }); },
    cerrar: () => setAbierto(false),
    agregar: (l, cantidad = 1) => {
      setLineas((ls) => {
        const ya = ls.find((x) => x.sku === l.sku);
        if (ya) return ls.map((x) => (x.sku === l.sku ? { ...x, ...l, cantidad: Math.min(MAX_UNIDADES_POR_ARTICULO, x.cantidad + cantidad) } : x));
        if (ls.length >= MAX_LINEAS_CARRITO) return ls;
        return [...ls, { ...l, cantidad: Math.min(MAX_UNIDADES_POR_ARTICULO, cantidad) }];
      });
      evento("add_to_cart", { currency: "ARS", value: pesos(l.precio * cantidad), items: [{ item_id: l.slug, item_name: l.nombre, item_variant: l.sku, price: pesos(l.precio), quantity: cantidad }] });
      setAbierto(true);
    },
    agregarVarias: (nuevas) => {
      setLineas((ls) => {
        let r = ls;
        for (const l of nuevas) {
          const ya = r.find((x) => x.sku === l.sku);
          if (ya) r = r.map((x) => (x.sku === l.sku ? { ...x, ...l, cantidad: Math.min(MAX_UNIDADES_POR_ARTICULO, x.cantidad + 1) } : x));
          else if (r.length < MAX_LINEAS_CARRITO) r = [...r, { ...l, cantidad: 1 }];
        }
        return r;
      });
      const valor = nuevas.reduce((a, l) => a + l.precio, 0);
      evento("add_to_cart", { currency: "ARS", value: pesos(valor), items: nuevas.map((l) => ({ item_id: l.slug, item_name: l.nombre, item_variant: l.sku, price: pesos(l.precio), quantity: 1 })) });
      setAbierto(true);
    },
    cambiar: (sku, cantidad) => setLineas((ls) => ls.map((l) => (l.sku === sku ? { ...l, cantidad: Math.max(1, Math.min(MAX_UNIDADES_POR_ARTICULO, cantidad)) } : l))),
    quitar: (sku) => {
      setLineas((ls) => {
        const l = ls.find((x) => x.sku === sku);
        if (l) evento("remove_from_cart", { currency: "ARS", value: pesos(l.precio * l.cantidad), items: [{ item_id: l.slug, item_name: l.nombre, item_variant: l.sku, price: pesos(l.precio), quantity: l.cantidad }] });
        return ls.filter((x) => x.sku !== sku);
      });
    },
    vaciar: () => { setLineas([]); setCotizacion(null); setCupon(null); setAvisoCupon(null); },
    cotizacion, cotizando, cotizar,
    cupon,
    ponerCupon: (codigo) => { setAvisoCupon(null); setCupon(codigo ? normalizar(codigo).slice(0, 40) || null : null); },
    avisoCupon,
  }), [lineas, abierto, cotizacion, cotizando, cotizar, cupon, avisoCupon]);

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useCarrito(): Ctx {
  const c = useContext(Contexto);
  if (!c) throw new Error("useCarrito fuera de ProveedorCarrito");
  return c;
}
