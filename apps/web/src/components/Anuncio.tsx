"use client";
import { formatearPesos } from "@isu/shared";
import { useCarrito } from "./carrito/Carrito";

/*
 * Franja de arriba. El texto sale del backoffice (ajuste "anuncio"); con
 * algo en el carrito y envío gratis configurado, dice cuánto falta (como las
 * tiendas que mejor venden: empuja a sumar una prenda más). El número exacto
 * lo da la API en el carrito; acá alcanza con la cuenta del navegador.
 */
export function Anuncio({ texto, envioGratisDesde }: { texto: string | null; envioGratisDesde: number | null }) {
  const { lineas, cotizacion } = useCarrito();
  const total = lineas.reduce((a, l) => a + l.precio * l.cantidad, 0);
  const falta = envioGratisDesde === null || !lineas.length ? null
    : cotizacion?.faltaParaEnvioGratis ?? Math.max(0, envioGratisDesde - total);
  const mensaje = falta === null
    ? texto ?? (envioGratisDesde ? `Envío gratis desde ${formatearPesos(envioGratisDesde)}` : null)
    : falta > 0 ? `🚚 Te faltan ${formatearPesos(falta)} para el envío gratis` : "🚚 ¡Tenés envío gratis!";
  if (!mensaje) return null;
  return (
    <div className="bg-marca text-center text-[13px] font-bold tracking-wide text-white">
      <p className="mx-auto max-w-7xl px-4 py-2" aria-live="polite">{mensaje}</p>
    </div>
  );
}
