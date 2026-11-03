"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { IconoCerrar, IconoChat } from "../iconos";

/*
 * La burbuja del asistente, abajo a la derecha (donde estaba el botón de
 * WhatsApp). El panel del chat se baja recién al abrirlo (o al pasarle el
 * mouse / el foco, para que ya esté): casi nadie lo abre y estaba en el JS
 * de todas las páginas.
 */
const cargarPanel = () => import("./Asistente");
const PanelAsistente = dynamic(() => cargarPanel().then((m) => m.PanelAsistente), { ssr: false });

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
        onPointerEnter={() => void cargarPanel()} onFocus={() => void cargarPanel()}
        aria-expanded={abierto} aria-controls="asistente"
        aria-label={abierto ? "Cerrar el asistente" : "Abrir el asistente de la tienda"}
        className={`fixed bottom-5 right-5 z-40 grid size-14 place-items-center rounded-full bg-marca text-white shadow-lg shadow-black/20 transition hover:scale-105 focus-visible:outline-offset-4 ${abierto ? "max-sm:hidden" : ""}`}>
        {abierto ? <IconoCerrar /> : <IconoChat />}
      </button>
      {usado && <PanelAsistente saludo={saludo} whatsapp={whatsapp} abierto={abierto} cerrar={cerrar} />}
    </>
  );
}
