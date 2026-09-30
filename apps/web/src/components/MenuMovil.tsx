"use client";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CategoriaNodo } from "@isu/shared";
import { IconoCerrar, IconoMenu } from "./iconos";
import { SITIO } from "@/lib/sitio";

/*
 * Menú del celular: un cajón lateral. Es el único pedazo del header con JS;
 * el de escritorio es CSS puro (hover y foco), así la página pesa poco.
 */
export function MenuMovil({ categorias }: { categorias: CategoriaNodo[] }) {
  const [abierto, setAbierto] = useState(false);
  const id = useId();
  const boton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const alTeclado = (e: KeyboardEvent) => e.key === "Escape" && setAbierto(false);
    document.addEventListener("keydown", alTeclado);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", alTeclado);
      document.body.style.overflow = "";
      boton.current?.focus();
    };
  }, [abierto]);

  return (
    <>
      <button ref={boton} type="button" className="-ml-2 p-2.5 lg:hidden" aria-label="Abrir menú" aria-expanded={abierto} aria-controls={id} onClick={() => setAbierto(true)}>
        <IconoMenu />
      </button>
      {/* Portal al body: así el cajón nunca queda atrapado dentro del header
          (un transform o filtro en un ancestro cambia a qué se pega el "fixed"). */}
      {abierto && createPortal(
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menú">
          <div className="absolute inset-0 bg-black/40" onClick={() => setAbierto(false)} />
          <nav id={id} className="absolute inset-y-0 left-0 flex w-[86%] max-w-sm flex-col overflow-y-auto bg-white px-5 pb-8 pt-4">
            <div className="mb-4 flex justify-end">
              <button type="button" aria-label="Cerrar menú" className="-mr-2 p-2.5" onClick={() => setAbierto(false)} autoFocus>
                <IconoCerrar />
              </button>
            </div>
            <Link href="/nuevos" className="border-b border-linea py-3 font-display text-2xl text-marca" onClick={() => setAbierto(false)}>Nuevos</Link>
            {categorias.map((c) => (
              <div key={c.id} className="border-b border-linea py-3">
                <Link href={`/${c.slug}`} className="font-display text-2xl" onClick={() => setAbierto(false)}>{c.nombre}</Link>
                {c.hijas.length > 0 && (
                  <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[15px] text-tinta-suave">
                    {c.hijas.map((h) => (
                      <li key={h.id}><Link href={`/${c.slug}/${h.slug}`} onClick={() => setAbierto(false)}>{h.nombre}</Link></li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
            <Link href="/outfits" className="pt-3 text-[15px] font-bold" onClick={() => setAbierto(false)}>Armá tu outfit</Link>
            <Link href="/locales" className="py-3 text-[15px]" onClick={() => setAbierto(false)}>Nuestros locales</Link>
            <a href={SITIO.mayorista} rel="nofollow" className="mt-2 inline-flex w-fit items-center gap-2 rounded-full border border-tinta px-4 py-2 text-[15px] font-bold">Pedido mayorista <span aria-hidden="true">↗</span></a>
          </nav>
        </div>,
        document.body,
      )}
    </>
  );
}
