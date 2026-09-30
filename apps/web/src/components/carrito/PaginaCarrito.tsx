"use client";
import Link from "next/link";
import { useEffect } from "react";
import { useCarrito } from "./Carrito";
import { BarraEnvioGratis, LineasCarrito, Totales } from "./LineasCarrito";

export function PaginaCarrito({ descuento }: { descuento: number }) {
  const { lineas, cotizacion, cotizar, unidades } = useCarrito();
  // Dependencias a propósito: se cotiza al entrar y cuando cambian las cantidades
  useEffect(() => { void cotizar(); }, [unidades]);
  const bloqueado = !lineas.length || (cotizacion?.problemas.length ?? 0) > 0;
  return (
    <div className="contenedor py-10">
      <h1 className="text-[clamp(2.2rem,6vw,4rem)] leading-none">Tu carrito</h1>
      {lineas.length === 0 ? (
        <div className="mt-10 text-center">
          <p className="font-display text-2xl">Todavía no agregaste nada</p>
          <Link href="/" className="boton-primario mt-6">Ver la tienda</Link>
        </div>
      ) : (
        <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_380px]">
          <LineasCarrito />
          <aside className="space-y-4 self-start rounded-[var(--radius-foto)] border border-linea p-5 lg:sticky lg:top-28">
            <BarraEnvioGratis c={cotizacion} />
            <Totales c={cotizacion} descuento={descuento} />
            {cotizacion?.problemas.filter((p) => p.tipo === "minimo").map((p) => <p key={p.mensaje} className="text-sm font-bold text-oferta">{p.mensaje}</p>)}
            <Link href="/checkout" aria-disabled={bloqueado} onClick={(e) => bloqueado && e.preventDefault()}
              className={`boton w-full py-4 text-base ${bloqueado ? "cursor-not-allowed bg-linea text-tinta-tenue" : "bg-tinta text-white hover:bg-marca-fuerte"}`}>
              Finalizar compra
            </Link>
          </aside>
        </div>
      )}
    </div>
  );
}
