"use client";
import { formatearPesos } from "@isu/shared";
import { useCarrito } from "./carrito/Carrito";

/*
 * Envío gratis en la ficha (como Deliver): cuánto falta con lo que ya hay en
 * el carrito, con una barra que se llena. El número exacto lo da la API en el
 * carrito (cotización); antes de cotizar, la cuenta del navegador. Sin envío
 * gratis configurado (Ajustes → Envío gratis desde), no se muestra.
 */
export function BarraEnvioGratis({ desde, className = "" }: { desde: number | null; className?: string }) {
  const { lineas, cotizacion } = useCarrito();
  if (desde === null || desde <= 0) return null;
  const total = lineas.reduce((a, l) => a + l.precio * l.cantidad, 0);
  const falta = lineas.length ? (cotizacion?.faltaParaEnvioGratis ?? Math.max(0, desde - total)) : desde;
  const avance = Math.min(100, Math.max(0, Math.round(((desde - falta) / desde) * 100)));
  return (
    <div className={`rounded-2xl border border-linea p-3.5 ${className}`}>
      <p className="text-sm" aria-live="polite">
        <span aria-hidden="true">🚚 </span>
        {falta > 0
          ? <>Te faltan <b>{formatearPesos(falta)}</b> para el <b className="text-ahorro">envío gratis</b></>
          : <b className="text-ahorro">¡Tenés envío gratis!</b>}
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-fondo-suave" role="progressbar" aria-label="Para el envío gratis" aria-valuemin={0} aria-valuemax={100} aria-valuenow={avance}>
        <div className="h-full rounded-full bg-ahorro transition-[width] duration-500" style={{ width: `${avance}%` }} />
      </div>
      <p className="mt-1.5 text-xs text-tinta-tenue">Envío gratis desde {formatearPesos(desde)}</p>
    </div>
  );
}
