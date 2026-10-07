"use client";
import Link from "next/link";
import { useId, useState } from "react";
import { conDescuento, centavos, formatearPesos, MAX_PACKS_POR_LINEA, rutaPack, type Cotizacion } from "@isu/shared";
import { Foto } from "../Foto";
import { useCarrito, usoDe, type AvisoStock, type LineaCarrito } from "./Carrito";

/*
 * Si el + no deja sumar porque la misma variante también está en otra línea
 * (suelta y en un pack comparten el stock), qué decir. null: no es por eso.
 */
function bloqueoPorOtras(l: LineaCarrito, lineas: LineaCarrito[], c: Cotizacion | null, max: number): AvisoStock | null {
  if (!c || l.cantidad < max) return null;
  const prendas = l.pack ? l.pack.prendas : [{ sku: l.sku, cantidad: 1, talle: l.talle, color: l.color, foto: l.foto }];
  for (const x of prendas) {
    const otras = usoDe(lineas, x.sku, l.sku);
    if (!otras.total) continue;
    // Lo que queda para esta línea (la API ya le restó lo de las otras).
    const libre = c.lineas.find((y) => y.clave === (l.pack ? `${l.sku}|${x.sku}` : l.sku))?.disponible;
    if (libre === undefined || Math.floor(libre / x.cantidad) > l.cantidad) continue;
    return {
      nombre: l.nombre, detalle: [x.talle && `Talle ${x.talle}`, x.color].filter(Boolean).join(" · "), foto: x.foto,
      stock: libre + otras.total, uso: usoDe(lineas, x.sku), desde: "carrito",
    };
  }
  return null;
}

/* Las líneas del carrito y el resumen: lo usan el cajón lateral y la página /carrito. */
export function LineasCarrito({ alNavegar }: { alNavegar?: () => void }) {
  const { lineas, cambiar, quitar, cotizacion, avisarStock } = useCarrito();
  return (
    <ul className="divide-y divide-linea">
      {lineas.map((l) => {
        const pack = l.pack ? cotizacion?.packs?.find((x) => x.clave === l.sku) : undefined;
        const suelta = l.pack ? undefined : cotizacion?.lineas.find((x) => x.clave === l.sku && !x.pack);
        // El aviso puede ser del pack entero o de una de sus prendas (stock).
        const skus = l.pack ? new Set([l.sku, ...l.pack.prendas.map((x) => x.sku)]) : new Set([l.sku]);
        const problema = cotizacion?.problemas.find((x) => x.sku !== null && skus.has(x.sku) && (l.pack ? true : x.tipo !== "pack"));
        const max = l.pack ? Math.max(1, Math.min(MAX_PACKS_POR_LINEA, pack?.disponible ?? MAX_PACKS_POR_LINEA)) : Math.max(1, Math.min(20, suelta?.disponible ?? 20));
        const lista = l.pack ? pack?.precioLista : suelta?.precioLista;
        const pct = l.pack ? pack?.porcentaje : undefined;
        const nombre = l.pack ? `Pack x${l.pack.unidades} ${l.nombre}` : l.nombre;
        const href = l.pack ? rutaPack(l.slug, l.pack.unidades) : `/producto/${l.slug}`;
        const bloqueo = bloqueoPorOtras(l, lineas, cotizacion, max);
        return (
          <li key={l.sku} className="flex gap-3 py-4">
            <Link href={href} onClick={alNavegar} className="block aspect-[4/5] w-20 shrink-0 overflow-hidden rounded-xl bg-fondo-suave">
              <Foto foto={l.foto ? { clave: l.foto, ancho: 400, alto: 500, alt: null } : null} alt={nombre} sizes="80px" />
            </Link>
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex justify-between gap-2">
                <Link href={href} onClick={alNavegar} className="text-[15px] leading-snug hover:underline">{nombre}</Link>
                <div className="shrink-0 text-right">
                  <p className="text-[15px] font-bold">{formatearPesos(l.precio * l.cantidad)}</p>
                  {lista && lista > l.precio ? <s className="text-xs text-tinta-tenue">{formatearPesos(lista * l.cantidad)}</s> : null}
                </div>
              </div>
              {l.pack ? (
                <>
                  {pct ? <p className="mt-1 inline-flex w-fit rounded-full bg-ahorro-claro px-2.5 py-0.5 text-xs font-bold text-ahorro">📦 Pack · −{pct}%</p> : null}
                  <ul className="mt-2 space-y-1.5" aria-label={`Qué lleva el pack ${nombre}`}>
                    {l.pack.prendas.map((x) => (
                      <li key={x.sku} className="flex items-center gap-2 text-sm text-tinta-suave">
                        <span className="block size-9 shrink-0 overflow-hidden rounded-md bg-fondo-suave">
                          <Foto foto={x.foto ? { clave: x.foto, ancho: 400, alto: 500, alt: null } : null} alt="" sizes="36px" />
                        </span>
                        <span><b className="text-tinta">{x.cantidad}×</b> {[x.talle, x.color].filter(Boolean).join(" / ") || l.nombre}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-sm text-tinta-tenue">{[l.color, l.talle && `Talle ${l.talle}`].filter(Boolean).join(" · ")}</p>
              )}
              {problema && <p className="mt-1 text-sm font-bold text-oferta" role="alert">{problema.mensaje}</p>}
              <div className="mt-auto flex items-center justify-between pt-2">
                <div className="inline-flex items-center rounded-full border border-linea" role="group" aria-label={`Cantidad de ${nombre}`}>
                  <button type="button" onClick={() => cambiar(l.sku, l.cantidad - 1)} disabled={l.cantidad <= 1} className="size-9 rounded-full text-lg disabled:opacity-30" aria-label="Uno menos">−</button>
                  <span className="w-7 text-center text-sm font-bold" aria-live="polite">{l.cantidad}</span>
                  {/* Sin stock por lo que va en otra línea: el + explica por qué, en vez de quedar apagado. */}
                  <button type="button" onClick={() => (bloqueo ? avisarStock(bloqueo) : cambiar(l.sku, l.cantidad + 1))} disabled={!bloqueo && l.cantidad >= max}
                    className={`size-9 rounded-full text-lg disabled:opacity-30 ${bloqueo ? "opacity-40" : ""}`} aria-label="Uno más">+</button>
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

/*
 * Cómo se paga, como en las tiendas de referencia: dos botones con el total
 * de cada forma. Transferencia con su % ya aplicado (y cuánto ahorra);
 * tarjeta o Mercado Pago al precio de lista, en cuotas sin interés. Cada uno
 * lleva al checkout con ese pago elegido.
 */
export function OpcionesPago({ c, descuento, cuotas, medios, bloqueado, alElegir }: {
  c: Cotizacion | null; descuento: number; cuotas: number; medios: string[]; bloqueado: boolean; alElegir?: () => void;
}) {
  if (!c) return null;
  // Algo marcado en rojo (stock, pack que no se arma): no hay total que mostrar todavía.
  const conProblemas = c.problemas.some((p) => p.tipo !== "minimo");
  const trasCupon = Math.max(0, c.subtotal - (c.descuentoCupon ?? 0));
  const conTransferencia = descuento > 0 ? conDescuento(centavos(trasCupon), descuento) : trasCupon;
  const boton = (pago: string, contenido: React.ReactNode, clase: string) => (
    <Link href={`/checkout?pago=${pago}`} aria-disabled={bloqueado} onClick={(e) => { if (bloqueado) e.preventDefault(); else alElegir?.(); }}
      className={`block w-full rounded-2xl px-4 py-3 text-left transition ${bloqueado ? "cursor-not-allowed bg-linea text-tinta-tenue" : clase}`}>
      {contenido}
    </Link>
  );
  return (
    <div className="space-y-2">
      {medios.includes("transferencia") && boton("transferencia", (
        <span className="flex items-center justify-between gap-3">
          <span>
            <span className="block text-[15px] font-bold">Pagar con transferencia</span>
            {descuento > 0 && !conProblemas && <span className="block text-xs opacity-90">Ahorrás {formatearPesos(trasCupon - conTransferencia)} · {descuento}% ya aplicado</span>}
          </span>
          {!conProblemas && <span className="shrink-0 font-display text-2xl">{formatearPesos(conTransferencia)}</span>}
        </span>
      ), "bg-ahorro text-white hover:brightness-95")}
      {medios.includes("mercadopago") && boton("mercadopago", (
        <span className="flex items-center justify-between gap-3">
          <span>
            <span className="block text-[15px] font-bold">Tarjeta o Mercado Pago</span>
            {cuotas > 1 && !conProblemas && <span className="block text-xs text-tinta-suave">Hasta {cuotas} cuotas sin interés de {formatearPesos(Math.ceil(trasCupon / cuotas / 100) * 100)}</span>}
          </span>
          {!conProblemas && <span className="shrink-0 font-display text-2xl">{formatearPesos(trasCupon)}</span>}
        </span>
      ), "border-2 border-tinta bg-white hover:bg-fondo-suave")}
      {!medios.includes("transferencia") && !medios.includes("mercadopago") && boton("", <span className="block text-center text-[15px] font-bold">Finalizar compra</span>, "bg-tinta text-white hover:bg-marca-fuerte")}
      {conProblemas
        ? <p className="text-center text-sm font-bold text-oferta" role="status">Corregí lo marcado en rojo para seguir.</p>
        : <p className="text-center text-xs text-tinta-tenue">El envío se calcula en el siguiente paso.</p>}
    </div>
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

/* Subtotal, cupón y la promo más cercana (el total de cada forma de pago va en los botones). */
export function Totales({ c }: { c: Cotizacion | null }) {
  if (!c || c.problemas.some((p) => p.tipo !== "minimo")) return null;
  return (
    <div className="space-y-1 text-[15px]">
      <div className="flex justify-between"><span>Subtotal</span><b>{formatearPesos(c.subtotal)}</b></div>
      <LineaCupon c={c} />
      {c.promoCerca && (
        <p className="text-sm text-tinta-suave">Te faltan <b>{formatearPesos(c.promoCerca.falta)}</b> para <b className="text-ahorro">{c.promoCerca.nombre}</b>.</p>
      )}
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
