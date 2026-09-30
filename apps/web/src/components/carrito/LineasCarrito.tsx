"use client";
import Link from "next/link";
import { conDescuento, centavos, formatearPesos, type Cotizacion } from "@isu/shared";
import { Foto } from "../Foto";
import { useCarrito } from "./Carrito";

/* Las líneas del carrito y el resumen: lo usan el cajón lateral y la página /carrito. */
export function LineasCarrito({ alNavegar }: { alNavegar?: () => void }) {
  const { lineas, cambiar, quitar, cotizacion } = useCarrito();
  const problema = (sku: string) => cotizacion?.problemas.find((p) => p.sku === sku);
  const disponible = (sku: string) => cotizacion?.lineas.find((l) => l.sku === sku)?.disponible;
  return (
    <ul className="divide-y divide-linea">
      {lineas.map((l) => {
        const p = problema(l.sku);
        const max = Math.max(1, Math.min(20, disponible(l.sku) ?? 20));
        return (
          <li key={l.sku} className="flex gap-3 py-4">
            <Link href={`/producto/${l.slug}`} onClick={alNavegar} className="block aspect-[4/5] w-20 shrink-0 overflow-hidden rounded-xl bg-fondo-suave">
              <Foto foto={l.foto ? { clave: l.foto, ancho: 400, alto: 500, alt: null } : null} alt={l.nombre} sizes="80px" />
            </Link>
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex justify-between gap-2">
                <Link href={`/producto/${l.slug}`} onClick={alNavegar} className="text-[15px] leading-snug hover:underline">{l.nombre}</Link>
                <p className="shrink-0 text-[15px] font-bold">{formatearPesos(l.precio * l.cantidad)}</p>
              </div>
              <p className="text-sm text-tinta-tenue">{[l.color, l.talle && `Talle ${l.talle}`].filter(Boolean).join(" · ")}</p>
              {p && <p className="mt-1 text-sm font-bold text-oferta" role="alert">{p.mensaje}</p>}
              <div className="mt-auto flex items-center justify-between pt-2">
                <div className="inline-flex items-center rounded-full border border-linea" role="group" aria-label={`Cantidad de ${l.nombre}`}>
                  <button type="button" onClick={() => cambiar(l.sku, l.cantidad - 1)} disabled={l.cantidad <= 1} className="size-9 rounded-full text-lg disabled:opacity-30" aria-label="Uno menos">−</button>
                  <span className="w-7 text-center text-sm font-bold" aria-live="polite">{l.cantidad}</span>
                  <button type="button" onClick={() => cambiar(l.sku, l.cantidad + 1)} disabled={l.cantidad >= max} className="size-9 rounded-full text-lg disabled:opacity-30" aria-label="Uno más">+</button>
                </div>
                <button type="button" onClick={() => quitar(l.sku)} className="text-sm text-tinta-tenue underline hover:text-tinta">Quitar</button>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function BarraEnvioGratis({ c }: { c: Cotizacion | null }) {
  if (!c || c.envioGratisDesde === null) return null;
  const falta = c.faltaParaEnvioGratis ?? 0;
  const avance = Math.min(100, Math.round(((c.envioGratisDesde - falta) / c.envioGratisDesde) * 100));
  return (
    <div className="rounded-2xl bg-ahorro-claro p-3">
      <p className="text-sm">{falta > 0
        ? <>Te faltan <b>{formatearPesos(falta)}</b> para el <b className="text-ahorro">envío gratis</b></>
        : <><b className="text-ahorro">¡Tenés envío gratis!</b></>}</p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white" role="progressbar" aria-valuenow={avance} aria-valuemin={0} aria-valuemax={100} aria-label="Avance hacia el envío gratis">
        <div className="h-full rounded-full bg-ahorro transition-all" style={{ width: `${avance}%` }} />
      </div>
    </div>
  );
}

export function Totales({ c, descuento }: { c: Cotizacion | null; descuento: number }) {
  if (!c) return null;
  return (
    <div className="space-y-1 text-[15px]">
      <div className="flex justify-between"><span>Subtotal</span><b>{formatearPesos(c.subtotal)}</b></div>
      {descuento > 0 && c.subtotal > 0 && (
        <div className="flex justify-between text-ahorro"><span>Con transferencia</span><b>{formatearPesos(conDescuento(centavos(c.subtotal), descuento))}</b></div>
      )}
      <p className="text-xs text-tinta-tenue">El envío se calcula en el siguiente paso.</p>
    </div>
  );
}
