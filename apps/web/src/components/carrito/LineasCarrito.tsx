"use client";
import Link from "next/link";
import { useId, useState } from "react";
import { conDescuento, centavos, formatearPesos, type Cotizacion } from "@isu/shared";
import { Foto } from "../Foto";
import { useCarrito } from "./Carrito";

/* Las líneas del carrito y el resumen: lo usan el cajón lateral y la página /carrito. */
export function LineasCarrito({ alNavegar }: { alNavegar?: () => void }) {
  const { lineas, cambiar, quitar, cotizacion } = useCarrito();
  const problema = (sku: string) => cotizacion?.problemas.find((p) => p.sku === sku);
  const disponible = (sku: string) => cotizacion?.lineas.find((l) => l.sku === sku)?.disponible;
  const cotizada = (sku: string) => cotizacion?.lineas.find((l) => l.sku === sku);
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
              {cotizada(l.sku)?.pack && (
                <p className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-full bg-ahorro-claro px-2.5 py-0.5 text-xs font-bold text-ahorro">
                  Pack x{Math.min(5, cotizada(l.sku)!.pack!.unidades)} · −{cotizada(l.sku)!.pack!.porcentaje}%
                  {cotizada(l.sku)!.precioLista ? <s className="font-normal text-tinta-tenue">{formatearPesos(cotizada(l.sku)!.precioLista! * l.cantidad)}</s> : null}
                </p>
              )}
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
  const trasCupon = c.subtotal - (c.descuentoCupon ?? 0);
  return (
    <div className="space-y-1 text-[15px]">
      <div className="flex justify-between"><span>Subtotal</span><b>{formatearPesos(c.subtotal)}</b></div>
      <LineaCupon c={c} />
      {descuento > 0 && trasCupon > 0 && (
        <div className="flex justify-between text-ahorro"><span>Con transferencia</span><b>{formatearPesos(conDescuento(centavos(trasCupon), descuento))}</b></div>
      )}
      {c.promoCerca && (
        <p className="text-sm text-tinta-suave">Te faltan <b>{formatearPesos(c.promoCerca.falta)}</b> para <b className="text-ahorro">{c.promoCerca.nombre}</b>.</p>
      )}
      <p className="text-xs text-tinta-tenue">El envío se calcula en el siguiente paso.</p>
    </div>
  );
}

/* "Cupón VERANO10 −$2.000" o "Promo 10% superando $80.000 −$…" (o envío gratis). */
export function LineaCupon({ c, Etiqueta = "span" }: { c: Pick<Cotizacion, "cupon" | "descuentoCupon">; Etiqueta?: "span" | "dt" }) {
  if (!c.cupon) return null;
  const Valor = Etiqueta === "dt" ? "dd" : "b";
  return (
    <div className="flex justify-between gap-3 text-ahorro">
      <Etiqueta>{c.cupon.codigo ? <>Cupón <b>{c.cupon.codigo}</b></> : <>Promo: {c.cupon.nombre}</>}</Etiqueta>
      <Valor className="shrink-0">{c.descuentoCupon ? `−${formatearPesos(c.descuentoCupon)}` : c.cupon.envioGratis ? "Envío gratis" : ""}</Valor>
    </div>
  );
}

/*
 * "¿Tenés un cupón?": se escribe y se aplica. Sin <form> propio: en el
 * checkout vive adentro del formulario de la compra (Enter aplica el cupón,
 * no confirma la compra).
 */
export function CampoCupon() {
  const { cupon, ponerCupon, cotizacion, avisoCupon, cotizando } = useCarrito();
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");
  const id = useId();
  const aplicado = cotizacion?.cupon?.codigo ? cotizacion.cupon : null;
  const aplicar = () => { if (texto.trim()) ponerCupon(texto); };
  // "La promoción X te descuenta más…" es informativo; el resto, un error.
  const informativo = avisoCupon?.startsWith("La promoción");

  if (aplicado) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl bg-ahorro-claro px-3 py-2 text-sm">
        <span>Cupón <b>{aplicado.codigo}</b> aplicado{aplicado.nombre ? <span className="block text-xs text-tinta-suave">{aplicado.nombre}</span> : null}</span>
        <button type="button" onClick={() => { ponerCupon(null); setTexto(""); }} aria-label={`Quitar el cupón ${aplicado.codigo}`} className="shrink-0 font-bold underline">Quitar</button>
      </div>
    );
  }
  return (
    <div className="text-sm">
      {!abierto && !avisoCupon && !cupon ? (
        <button type="button" onClick={() => setAbierto(true)} className="underline">¿Tenés un cupón de descuento?</button>
      ) : (
        <div className="flex gap-2">
          <label htmlFor={`${id}-cupon`} className="sr-only">Código del cupón</label>
          <input id={`${id}-cupon`} value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={40} autoComplete="off" autoCapitalize="characters" spellCheck={false}
            placeholder="Código del cupón" aria-describedby={avisoCupon ? `${id}-aviso` : undefined} aria-invalid={!!avisoCupon && !informativo}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); aplicar(); } }}
            className="min-w-0 flex-1 rounded-xl border border-linea bg-white px-3 py-2.5 text-base uppercase outline-none placeholder:normal-case focus:border-tinta aria-[invalid=true]:border-oferta" />
          <button type="button" onClick={aplicar} disabled={cotizando || !texto.trim()} className="boton-borde shrink-0 px-4 py-2.5 disabled:opacity-50">Aplicar</button>
        </div>
      )}
      {avisoCupon && <p id={`${id}-aviso`} role={informativo ? "status" : "alert"} className={`mt-1.5 ${informativo ? "text-tinta-suave" : "font-bold text-oferta"}`}>{avisoCupon}</p>}
    </div>
  );
}
