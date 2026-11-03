"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { IconoCerrar, IconoChat, IconoWhatsapp } from "../iconos";

/*
 * La burbuja del asistente, abajo a la derecha (donde estaba el botón de
 * WhatsApp). El panel del chat se baja recién al abrirlo (o al pasarle el
 * mouse / el foco, para que ya esté): casi nadie lo abre y estaba en el JS
 * de todas las páginas.
 */
const cargarPanel = () => import("./Asistente");
// Si el archivo no baja (sin red, o un deploy cambió su nombre), React lo tira al dibujar y se cae toda la tienda: queda un aviso con WhatsApp.
const PanelAsistente = dynamic(() => cargarPanel().then((m) => m.PanelAsistente).catch(() => SinPanel), { ssr: false });

function SinPanel({ whatsapp, abierto, cerrar }: { whatsapp: string; abierto: boolean; cerrar: () => void }) {
  useEffect(() => {
    if (!abierto) return;
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") cerrar(); };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [abierto, cerrar]);
  if (!abierto) return null;
  return (
    <section id="asistente" role="dialog" aria-modal="false" aria-label="Asistente Isuwaya"
      className="fixed inset-x-5 bottom-24 z-50 rounded-[var(--radius-foto)] border border-linea bg-white p-4 shadow-2xl sm:left-auto sm:w-[380px]">
      <p className="text-sm">No pudimos abrir el asistente. Recargá la página o escribinos por WhatsApp.</p>
      <div className="mt-3 flex gap-2">
        <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-full bg-whatsapp px-3 py-1.5 text-sm font-bold text-white"><IconoWhatsapp className="size-4" /> WhatsApp</a>
        <button type="button" onClick={cerrar} className="boton-borde px-3 py-1.5 text-sm">Cerrar</button>
      </div>
    </section>
  );
}

export function BotonAsistente({ saludo, whatsapp }: { saludo: string; whatsapp: string }) {
  const [abierto, setAbierto] = useState(false);
  // Una vez abierto queda montado: la charla en curso no se corta al cerrarlo.
  const [usado, setUsado] = useState(false);
  const boton = useRef<HTMLButtonElement>(null);

  // Al cerrar, el foco vuelve a la burbuja (en el celular está oculta mientras el panel está abierto: se espera a que aparezca).
  const devolverFoco = useRef(false);
  const cerrar = useCallback(() => { devolverFoco.current = true; setAbierto(false); }, []);
  useEffect(() => {
    if (!abierto && devolverFoco.current) { devolverFoco.current = false; boton.current?.focus(); }
  }, [abierto]);

  return (
    <>
      <button ref={boton} type="button" onClick={() => { if (abierto) cerrar(); else { setUsado(true); setAbierto(true); } }}
        onPointerEnter={() => void cargarPanel().catch(() => {})} onFocus={() => void cargarPanel().catch(() => {})}
        aria-expanded={abierto} aria-controls="asistente"
        aria-label={abierto ? "Cerrar el asistente" : "Abrir el asistente de la tienda"}
        className={`fixed bottom-5 right-5 z-40 grid size-14 place-items-center rounded-full bg-marca text-white shadow-lg shadow-black/20 transition hover:scale-105 focus-visible:outline-offset-4 ${abierto ? "max-sm:hidden" : ""}`}>
        {abierto ? <IconoCerrar /> : <IconoChat />}
      </button>
      {usado && <PanelAsistente saludo={saludo} whatsapp={whatsapp} abierto={abierto} cerrar={cerrar} />}
    </>
  );
}
