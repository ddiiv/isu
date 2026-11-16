"use client";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CategoriaNodo } from "@isu/shared";
import { Foto } from "./Foto";
import { IconoCerrar, IconoMenu } from "./iconos";
import { SITIO } from "@/lib/sitio";
import { useSalida } from "@/lib/animacion";

/*
 * Menú del celular: un cajón lateral. Arriba, lo justo: las categorías (Hombre,
 * Mujer, Niños), Packs y Liquidación (enlaces directos: el filtro por género
 * y temporada está adentro de cada página). Al tocar una categoría con
 * subcategorías se abre su panel: sus subcategorías y 1 o 2 fotos de prendas
 * que la representan. Nuevos y Armá tu outfit quedan abajo, más chicos.
 *
 * Los accesos de la fila de abajo del header (MenuAcceso) abren el cajón
 * directo en el panel de esa categoría.
 */
export interface FotoDelMenu { slug: string; nombre: string; foto: { clave: string; ancho: number | null; alto: number | null; alt: string | null } }
type Panel = null | string;
const EVENTO = "isu:menu";

/** Abre el menú del celular en un panel (lo usan los accesos del header). */
export function MenuAcceso({ panel, children, className }: { panel: string; children: React.ReactNode; className?: string }) {
  return <button type="button" className={className} onClick={() => window.dispatchEvent(new CustomEvent(EVENTO, { detail: panel }))}>{children}</button>;
}

export function MenuMovil({ categorias, fotos, hayPacks, hayLiquidacion }: {
  categorias: CategoriaNodo[]; fotos: Record<string, FotoDelMenu[]>; hayPacks: boolean; hayLiquidacion: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const id = useId();
  const boton = useRef<HTMLButtonElement>(null);
  const panelActual = useRef<Panel>(null);
  panelActual.current = panel;
  const cerrar = () => setAbierto(false);
  // Etapa 14: entra y sale deslizándose desde la izquierda.
  const { montado, saliendo } = useSalida(abierto);

  useEffect(() => {
    const abrirEn = (e: Event) => { setPanel(String((e as CustomEvent).detail ?? "") || null); setAbierto(true); };
    window.addEventListener(EVENTO, abrirEn);
    return () => window.removeEventListener(EVENTO, abrirEn);
  }, []);
  useEffect(() => {
    if (!abierto) return;
    const alTeclado = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Escape: primero vuelve al menú; desde el menú, cierra.
      if (panelActual.current === null) setAbierto(false);
      else setPanel(null);
    };
    document.addEventListener("keydown", alTeclado);
    document.body.style.overflow = "hidden";
    // Si la ventana pasa al encabezado de escritorio (xl) con el menú abierto, se cierra: si no, la página queda trabada.
    const escritorio = window.matchMedia("(min-width: 80rem)");
    const alCruzar = () => { if (escritorio.matches) setAbierto(false); };
    escritorio.addEventListener("change", alCruzar);
    return () => {
      escritorio.removeEventListener("change", alCruzar);
      document.removeEventListener("keydown", alTeclado);
      document.body.style.overflow = "";
      boton.current?.focus();
    };
  }, [abierto]);

  const cat = categorias.find((c) => c.slug === panel);
  const enlace = "flex items-center justify-between border-b border-linea py-3.5 font-display text-2xl";
  const flecha = <span aria-hidden="true" className="font-sans text-xl text-tinta-tenue">›</span>;

  return (
    <>
      <button ref={boton} type="button" className="-ml-2 p-2.5 xl:hidden" aria-label="Abrir menú" aria-expanded={abierto} aria-controls={id} onClick={() => { setPanel(null); setAbierto(true); }}>
        <IconoMenu />
      </button>
      {/* Portal al body: así el cajón nunca queda atrapado dentro del header
          (un transform o filtro en un ancestro cambia a qué se pega el "fixed"). */}
      {montado && createPortal(
        <div className={`fixed inset-0 z-50 xl:hidden ${saliendo ? "pointer-events-none" : ""}`} role="dialog" aria-modal="true" aria-label="Menú" inert={saliendo}>
          <div className={`absolute inset-0 bg-black/40 ${saliendo ? "animate-desvanece" : "animate-fundido"}`} onClick={cerrar} />
          <nav id={id} className={`absolute inset-y-0 left-0 flex w-[88%] max-w-sm flex-col overflow-y-auto overscroll-contain bg-white px-5 pb-8 pt-4 shadow-2xl ${saliendo ? "animate-sale-izq" : "animate-entra-izq"}`}>
            <div className="mb-2 flex items-center justify-between">
              {panel !== null
                ? <button type="button" onClick={() => setPanel(null)} className="-ml-1 flex items-center gap-1 py-2 text-[15px] font-bold" autoFocus><span aria-hidden="true" className="text-xl">‹</span> Menú</button>
                : <span />}
              <button type="button" aria-label="Cerrar menú" className="-mr-2 p-2.5" onClick={cerrar} autoFocus={panel === null}><IconoCerrar /></button>
            </div>

            {/* Cada nivel entra deslizándose (key: se vuelve a montar al cambiar de panel). */}
            <div key={panel ?? "menu"} className="flex flex-col animate-desliza">
            {panel === null && (
              <>
                {categorias.map((c) => c.hijas.length || fotos[c.slug]?.length
                  ? <button key={c.id} type="button" className={`${enlace} text-left`} onClick={() => setPanel(c.slug)}>{c.nombre} {flecha}</button>
                  : <Link key={c.id} href={`/${c.slug}`} className={enlace} onClick={cerrar}>{c.nombre}</Link>)}
                {hayPacks && <Link href="/packs" className={`${enlace} text-ahorro`} onClick={cerrar}>Packs</Link>}
                {hayLiquidacion && <Link href="/liquidacion" className={`${enlace} text-oferta`} onClick={cerrar}>Liquidación</Link>}
                <Link href="/nuevos" className="pt-4 text-[15px] font-bold" onClick={cerrar}>Nuevos</Link>
                <Link href="/outfits" className="py-3 text-[15px] font-bold" onClick={cerrar}>Armá tu outfit</Link>
                <Link href="/locales" className="py-3 text-[15px]" onClick={cerrar}>Nuestros locales</Link>
                <Link href="/nosotros" className="py-1.5 text-[15px]" onClick={cerrar}>Quiénes somos</Link>
                <Link href="/contacto" className="py-1.5 text-[15px]" onClick={cerrar}>Contacto</Link>
                <a href={SITIO.mayorista} rel="nofollow" className="mt-2 inline-flex w-fit items-center gap-2 rounded-full border border-tinta px-4 py-2 text-[15px] font-bold">Pedido mayorista <span aria-hidden="true">↗</span></a>
              </>
            )}

            {cat && (
              <>
                <p className="font-display text-3xl">{cat.nombre}</p>
                <ul className="mt-3 divide-y divide-linea border-y border-linea text-[17px]">
                  {cat.hijas.map((h) => <li key={h.id}><Link href={`/${cat.slug}/${h.slug}`} className="block py-3" onClick={cerrar}>{h.nombre}</Link></li>)}
                  <li><Link href={`/${cat.slug}`} className="block py-3 font-bold text-marca" onClick={cerrar}>Ver todo {cat.nombre}</Link></li>
                </ul>
                {(fotos[cat.slug]?.length ?? 0) > 0 && (
                  <ul className={`mt-5 grid gap-3 ${fotos[cat.slug]!.length > 1 ? "grid-cols-2" : "grid-cols-1"}`} aria-label={`Prendas de ${cat.nombre}`}>
                    {fotos[cat.slug]!.map((f) => (
                      <li key={f.slug}>
                        <Link href={`/producto/${f.slug}`} onClick={cerrar} className="group block">
                          <span className="block aspect-[4/5] overflow-hidden rounded-[var(--radius-foto)] bg-fondo-suave">
                            <Foto foto={f.foto} alt={f.nombre} sizes="45vw" className="transition duration-500 group-hover:scale-[1.03]" />
                          </span>
                          <span className="mt-1.5 block text-sm leading-snug">{f.nombre}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}

            </div>
          </nav>
        </div>,
        document.body,
      )}
    </>
  );
}
