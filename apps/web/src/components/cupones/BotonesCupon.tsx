"use client";
import Link from "next/link";
import { useState } from "react";
import { useCarrito } from "@/components/carrito/Carrito";

/* Los dos botones de un cupón visible: copiar el código y aplicarlo en el carrito (el código se puede escribir a mano igual). */
export function BotonesCupon({ codigo }: { codigo: string }) {
  const { ponerCupon, cupon } = useCarrito();
  const [copiado, setCopiado] = useState(false);
  const [aplicado, setAplicado] = useState(false);
  const copiar = async () => { try { await navigator.clipboard.writeText(codigo); setCopiado(true); setTimeout(() => setCopiado(false), 2000); } catch { /* el código se ve en pantalla */ } };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => void copiar()} className="boton-borde py-1.5 text-sm">{copiado ? "¡Copiado!" : "Copiar código"}</button>
      <button type="button" onClick={() => { ponerCupon(codigo); setAplicado(true); }} className="boton-primario py-1.5 text-sm">Usar en mi carrito</button>
      {(aplicado || cupon === codigo) && <span role="status" className="text-sm text-ahorro">Listo: <Link href="/carrito" className="font-bold underline">ver mi carrito</Link></span>}
    </div>
  );
}
