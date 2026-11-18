"use client";
import { conDescuento, centavos, formatearPesos } from "@isu/shared/puro";
import { useRelampago } from "./Relampago";

/*
 * Precio como lo muestran las tiendas que mejor venden: el de lista arriba
 * (tachado si hay una rebaja del backoffice, con el porcentaje), el de
 * transferencia en verde (es plata a favor del cliente) y las cuotas.
 */
export function Precio({
  precio, precioHasta, precioLista, rebaja, hasta, descuento, cuotas, grande = false,
}: { precio: number; precioHasta?: number; precioLista?: number | null; rebaja?: number | null; hasta?: string | null; descuento: number; cuotas: number; grande?: boolean }) {
  // Relámpago: el precio rebajado en rojo y destacado, el de lista tachado.
  const relampago = !!useRelampago(hasta);
  const desde = precioHasta !== undefined && precioHasta > precio;
  const transferencia = conDescuento(centavos(precio), descuento);
  return (
    <div className={grande ? "space-y-1.5" : "space-y-0.5"}>
      {precioLista && precioLista > precio && (
        <p className={`flex items-center gap-2 ${grande ? "text-base" : "text-xs"}`}>
          <s className="text-tinta-tenue" aria-label={`Antes ${formatearPesos(precioLista)}`}>{formatearPesos(precioLista)}</s>
          {rebaja ? <span className="rounded-full bg-oferta px-2 py-0.5 font-bold text-white">-{rebaja}%</span> : null}
        </p>
      )}
      <p className={`${grande ? "font-display text-3xl" : "text-[15px] font-bold"} ${relampago ? "font-bold text-oferta" : ""} ${relampago && !grande ? "text-base" : ""}`}>
        {desde && <span className="mr-1 text-sm font-normal text-tinta-tenue">desde</span>}
        {formatearPesos(precio)}
      </p>
      {descuento > 0 && (
        <p className={`font-bold text-ahorro ${grande ? "text-lg" : "text-sm"}`}>
          {formatearPesos(transferencia)} <span className="font-normal">con transferencia</span>
        </p>
      )}
      {cuotas > 1 && (
        <p className={`text-tinta-tenue ${grande ? "text-[15px]" : "text-xs"}`}>
          {cuotas} cuotas sin interés de {formatearPesos(Math.ceil(precio / cuotas / 100) * 100)}
        </p>
      )}
    </div>
  );
}
