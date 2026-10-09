"use client";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Foto } from "../Foto";
import type { AvisoStock } from "./Carrito";

/*
 * "Esa prenda ya está en tu carrito": cuando se quiere sumar una variante y
 * las que quedan ya están en el carrito (sueltas o dentro de un pack), en vez
 * de agregarla y que el carrito marque "quedan 1", se explica qué pasa y qué
 * hacer. No se agrega.
 *
 * En la compu y la notebook es una ventana al centro; en el celular, una
 * hoja que sube desde abajo (los botones quedan a mano del pulgar).
 * Accesible: el foco entra al botón principal, Tab no se escapa, Escape
 * cierra y al cerrar el foco vuelve a donde estaba.
 */
export function AvisoYaEnCarrito({ aviso, cerrar, verCarrito }: { aviso: AvisoStock | null; cerrar: () => void; verCarrito: () => void }) {
  const caja = useRef<HTMLDivElement>(null);
  const principal = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!aviso) return;
    const antes = document.activeElement as HTMLElement | null;
    const scroll = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    principal.current?.focus();
    // En captura: si el cajón del carrito está abierto abajo, Escape cierra sólo el aviso.
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); cerrar(); return; }
      if (e.key !== "Tab" || !caja.current) return;
      const botones = [...caja.current.querySelectorAll<HTMLElement>("button")];
      const i = botones.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); botones.at(-1)?.focus(); }
      else if (!e.shiftKey && i === botones.length - 1) { e.preventDefault(); botones[0]?.focus(); }
    };
    document.addEventListener("keydown", tecla, true);
    return () => {
      document.removeEventListener("keydown", tecla, true);
      document.body.style.overflow = scroll;
      antes?.focus?.();
    };
    // Dependencias a propósito: se arma al abrir
  }, [aviso]);

  if (!aviso || typeof document === "undefined") return null;
  const { uso, stock } = aviso;
  const enPack = uso.packs.length > 0;
  const quedan = stock === 1 ? "Queda 1" : `Quedan ${stock}`;
  const tenes = uso.total === 1 ? (enPack ? "ya está" : "ya la tenés") : `ya tenés ${uso.total}`;
  const titulo = enPack ? "Esa prenda ya está en un pack de tu carrito" : uso.total >= stock ? "Ya tenés todas las que quedan" : "No alcanzan las que quedan";
  const queHacer = aviso.desde === "pack"
    ? "Para armar este pack con ese talle y color, sacala del carrito o elegí otro."
    : enPack
      ? "Mientras esté dentro del pack, no la podés sumar suelta. Si la querés aparte, sacá el pack del carrito o elegí otro talle o color."
      : "No quedan más para sumar. Podés elegir otro talle o color.";

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-6">
      <button type="button" tabIndex={-1} aria-label="Cerrar aviso" className="absolute inset-0 cursor-default bg-black/50 animate-fundido" onClick={cerrar} />
      <div ref={caja} role="alertdialog" aria-modal="true" aria-labelledby="aviso-stock-titulo" aria-describedby="aviso-stock-texto"
        className="relative w-full max-w-md animate-entra-abajo rounded-t-3xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:max-w-lg sm:animate-sube sm:rounded-2xl sm:p-7">
        {/* La "manija" de la hoja, sólo en el celular. */}
        <span aria-hidden="true" className="mx-auto -mt-1 mb-4 block h-1.5 w-12 rounded-full bg-linea sm:hidden" />
        <div className="flex items-start gap-4">
          <div className="relative aspect-[4/5] w-16 shrink-0 overflow-hidden rounded-xl bg-fondo-suave">
            <Foto foto={aviso.foto ? { clave: aviso.foto, ancho: 400, alto: 500, alt: null } : null} alt="" sizes="64px" />
            {enPack && <span aria-hidden="true" className="absolute -bottom-1 -right-1 rounded-full bg-white px-1 text-base shadow">📦</span>}
          </div>
          <div className="min-w-0">
            <h2 id="aviso-stock-titulo" className="font-sans text-lg font-bold leading-snug">{titulo}</h2>
            <p className="mt-0.5 line-clamp-2 text-sm text-tinta-suave">{aviso.nombre}{aviso.detalle && <> · {aviso.detalle}</>}</p>
          </div>
        </div>
        <div id="aviso-stock-texto" className="mt-4 space-y-3 text-[15px] leading-relaxed">
          <p>{quedan} de esta prenda y {tenes} en tu carrito:</p>
          <ul className="space-y-1.5 rounded-xl bg-fondo-suave p-3 text-sm">
            {uso.packs.map((x) => (
              <li key={x.nombre} className="flex justify-between gap-3"><span>📦 En tu {x.nombre}</span><b className="shrink-0">{x.cantidad}</b></li>
            ))}
            {uso.sueltas > 0 && <li className="flex justify-between gap-3"><span>Suelta{uso.sueltas > 1 ? "s" : ""}</span><b className="shrink-0">{uso.sueltas}</b></li>}
          </ul>
          <p className="text-tinta-suave">{queHacer}</p>
        </div>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
          {aviso.desde === "carrito" ? (
            <button ref={principal} type="button" onClick={cerrar} className="boton w-full bg-tinta py-3.5 text-white hover:bg-marca-fuerte sm:w-auto sm:flex-1">Entendido</button>
          ) : (
            <>
              <button ref={principal} type="button" onClick={verCarrito} className="boton w-full bg-tinta py-3.5 text-white hover:bg-marca-fuerte sm:flex-1">Ver mi carrito</button>
              <button type="button" onClick={cerrar} className="boton w-full border-2 border-tinta py-3 hover:bg-fondo-suave sm:flex-1">Elegir otro talle o color</button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
