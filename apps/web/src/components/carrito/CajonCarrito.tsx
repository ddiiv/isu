"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useCarrito } from "./Carrito";
import { BarraEnvioGratis, LineasCarrito, Totales } from "./LineasCarrito";
import { IconoBolsa, IconoCerrar } from "../iconos";

/*
 * Carrito lateral: se abre al agregar una prenda. Muestra cuánto falta para
 * el envío gratis y deja ir directo a pagar. Accesible: foco adentro,
 * Escape cierra, el fondo no scrollea.
 */
export function CajonCarrito({ descuento, montoMinimo }: { descuento: number; montoMinimo: number }) {
  const { abierto, cerrar, lineas, cotizacion, cotizar, unidades } = useCarrito();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    void cotizar();
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && cerrar();
    document.addEventListener("keydown", tecla);
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    return () => { document.removeEventListener("keydown", tecla); document.body.style.overflow = ""; };
    // Dependencias a propósito: se cotiza al abrir y cuando cambian las cantidades
  }, [abierto, unidades]);

  if (!abierto || typeof document === "undefined") return null;
  const bloqueado = !lineas.length || (cotizacion?.problemas.length ?? 0) > 0;
  const faltaMinimo = cotizacion?.problemas.find((p) => p.tipo === "minimo");

  return createPortal(
    <div className="fixed inset-0 z-50">
      <button type="button" aria-label="Cerrar carrito" className="absolute inset-0 bg-black/40" onClick={cerrar} />
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="titulo-carrito"
        className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-white shadow-2xl outline-none">
        <div className="flex items-center justify-between border-b border-linea px-5 py-4">
          <h2 id="titulo-carrito" className="text-2xl">Tu carrito {unidades > 0 && <span className="text-tinta-tenue">({unidades})</span>}</h2>
          <button type="button" onClick={cerrar} aria-label="Cerrar" className="rounded-full p-2 hover:bg-fondo-suave"><IconoCerrar /></button>
        </div>
        {lineas.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
            <IconoBolsa className="size-12 text-tinta-tenue" />
            <p className="font-display text-2xl">Tu carrito está vacío</p>
            <button type="button" onClick={cerrar} className="boton-primario">Seguir comprando</button>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-5">
              <div className="pt-4"><BarraEnvioGratis c={cotizacion} /></div>
              <LineasCarrito alNavegar={cerrar} />
            </div>
            <div className="space-y-3 border-t border-linea p-5">
              <Totales c={cotizacion} descuento={descuento} />
              {faltaMinimo && <p className="text-sm font-bold text-oferta">{faltaMinimo.mensaje}</p>}
              <Link href="/checkout" onClick={(e) => { if (bloqueado) e.preventDefault(); else cerrar(); }} aria-disabled={bloqueado}
                className={`boton w-full py-4 text-base ${bloqueado ? "cursor-not-allowed bg-linea text-tinta-tenue" : "bg-tinta text-white hover:bg-marca-fuerte"}`}>
                Finalizar compra
              </Link>
              <Link href="/carrito" onClick={cerrar} className="block text-center text-sm underline">Ver carrito</Link>
              {montoMinimo > 0 && !faltaMinimo && <p className="text-center text-xs text-tinta-tenue">Compra mínima alcanzada.</p>}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function BotonCarrito() {
  const { abrir, unidades } = useCarrito();
  return (
    <button type="button" onClick={abrir} aria-label={unidades ? `Carrito, ${unidades} ${unidades === 1 ? "prenda" : "prendas"}` : "Carrito, vacío"}
      className="relative rounded-full p-2.5 hover:bg-fondo-suave">
      <IconoBolsa />
      {unidades > 0 && (
        <span className="absolute right-0.5 top-0.5 grid min-w-5 place-items-center rounded-full bg-marca px-1 text-[11px] font-bold leading-5 text-white" aria-hidden="true">
          {unidades > 99 ? "99+" : unidades}
        </span>
      )}
    </button>
  );
}
