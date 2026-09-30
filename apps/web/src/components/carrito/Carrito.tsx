"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { MAX_LINEAS_CARRITO, MAX_UNIDADES_POR_ARTICULO, type Cotizacion } from "@isu/shared";
import { api } from "@/lib/cliente-api";
import { evento, pesos } from "@/lib/ga";

/*
 * El carrito vive en el navegador (localStorage): agregar y sacar es
 * instantáneo y no le pega a la base por cada clic. Lo que se guarda es sólo
 * SKU y cantidad (más lo necesario para dibujarlo); precios, stock, envío y
 * descuentos los calcula SIEMPRE la API al cotizar.
 */
export interface LineaCarrito { sku: string; cantidad: number; nombre: string; slug: string; color: string | null; talle: string | null; precio: number; foto: string | null }

interface Ctx {
  lineas: LineaCarrito[];
  unidades: number;
  abierto: boolean;
  abrir(): void;
  cerrar(): void;
  agregar(l: Omit<LineaCarrito, "cantidad">, cantidad?: number): void;
  cambiar(sku: string, cantidad: number): void;
  quitar(sku: string): void;
  vaciar(): void;
  cotizacion: Cotizacion | null;
  cotizando: boolean;
  cotizar(opciones?: { entrega?: "envio" | "retiro"; medioPago?: string }): Promise<Cotizacion | null>;
}
const Contexto = createContext<Ctx | null>(null);
const CLAVE = "isu:carrito";

export function ProveedorCarrito({ children }: { children: React.ReactNode }) {
  const [lineas, setLineas] = useState<LineaCarrito[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [cotizacion, setCotizacion] = useState<Cotizacion | null>(null);
  const [cotizando, setCotizando] = useState(false);
  // Nada se guarda hasta haber leído lo guardado: si no, el carrito vacío del
  // primer dibujo pisa el de verdad (React en desarrollo corre los efectos dos veces).
  const [cargado, setCargado] = useState(false);

  useEffect(() => {
    try {
      const g = JSON.parse(localStorage.getItem(CLAVE) ?? "[]");
      if (Array.isArray(g)) setLineas(g.filter((l) => typeof l?.sku === "string" && Number.isInteger(l?.cantidad)).slice(0, MAX_LINEAS_CARRITO));
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

  const cotizar = useCallback(async (opciones: { entrega?: "envio" | "retiro"; medioPago?: string } = {}) => {
    if (!lineas.length) { setCotizacion(null); return null; }
    setCotizando(true);
    try {
      const c = await api<Cotizacion>("carrito", { cuerpo: { items: lineas.map(({ sku, cantidad }) => ({ sku, cantidad })), ...opciones } });
      setCotizacion(c);
      // Los precios guardados se actualizan con los de verdad.
      setLineas((ls) => ls.map((l) => { const x = c.lineas.find((y) => y.sku === l.sku); return x && x.precio !== l.precio ? { ...l, precio: x.precio } : l; }));
      return c;
    } catch {
      return null;
    } finally {
      setCotizando(false);
    }
  }, [lineas]);

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
    cambiar: (sku, cantidad) => setLineas((ls) => ls.map((l) => (l.sku === sku ? { ...l, cantidad: Math.max(1, Math.min(MAX_UNIDADES_POR_ARTICULO, cantidad)) } : l))),
    quitar: (sku) => {
      setLineas((ls) => {
        const l = ls.find((x) => x.sku === sku);
        if (l) evento("remove_from_cart", { currency: "ARS", value: pesos(l.precio * l.cantidad), items: [{ item_id: l.slug, item_name: l.nombre, item_variant: l.sku, price: pesos(l.precio), quantity: l.cantidad }] });
        return ls.filter((x) => x.sku !== sku);
      });
    },
    vaciar: () => { setLineas([]); setCotizacion(null); },
    cotizacion, cotizando, cotizar,
  }), [lineas, abierto, cotizacion, cotizando, cotizar]);

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useCarrito(): Ctx {
  const c = useContext(Contexto);
  if (!c) throw new Error("useCarrito fuera de ProveedorCarrito");
  return c;
}
