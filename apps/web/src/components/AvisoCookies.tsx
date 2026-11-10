"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CLAVE_CONSENTIMIENTO, leerEleccion, valoresConsentimiento, type EleccionCookies } from "@isu/shared";

/* Evento que dispara el link «Cookies» del pie para reabrir el aviso. */
export const REABRIR_COOKIES = "isu:cookies";

/*
 * Aviso de cookies para la medición de Analytics (Consent Mode v2). Sólo se
 * monta con GA configurado. Arranca oculto y aparece tras hidratar si no hay
 * elección guardada: al ser fixed no empuja el contenido (sin salto de layout).
 */
export function AvisoCookies() {
  const [abierto, setAbierto] = useState(false);
  const region = useRef<HTMLDivElement>(null);
  const reabierto = useRef(false);

  useEffect(() => {
    try { if (!leerEleccion(localStorage.getItem(CLAVE_CONSENTIMIENTO))) setAbierto(true); } catch { setAbierto(true); }
    const reabrir = () => { reabierto.current = true; setAbierto(true); };
    window.addEventListener(REABRIR_COOKIES, reabrir);
    return () => window.removeEventListener(REABRIR_COOKIES, reabrir);
  }, []);

  // Al reabrirlo a pedido, llevar el foco al aviso; la primera vez no le robamos el foco a nadie.
  useEffect(() => { if (abierto && reabierto.current) region.current?.focus(); }, [abierto]);

  function elegir(e: EleccionCookies) {
    try { localStorage.setItem(CLAVE_CONSENTIMIENTO, e); } catch { /* sin storage: vale para esta página */ }
    try { window.gtag?.("consent", "update", valoresConsentimiento(e)); } catch { /* nada */ }
    setAbierto(false);
  }

  if (!abierto) return null;
  // Mismas clases en los dos botones: mismo peso visual. pr-24 en celular deja libre el botón flotante de WhatsApp.
  const boton = "boton boton-borde !px-5 !py-2 !text-sm";
  return (
    <div ref={region} role="region" aria-label="Aviso de cookies" tabIndex={-1}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-linea bg-white py-3 pl-4 pr-24 shadow-[0_-2px_12px_rgba(0,0,0,0.08)] outline-none sm:px-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-tinta">
          Usamos cookies para medir cómo se usa la tienda y mejorar tus compras. Podés aceptarlas o rechazarlas.{" "}
          <Link href="/privacidad" className="font-bold underline underline-offset-2">Más info</Link>
        </p>
        <div className="flex gap-2">
          <button type="button" className={boton} onClick={() => elegir("granted")}>Aceptar</button>
          <button type="button" className={boton} onClick={() => elegir("denied")}>Rechazar</button>
        </div>
      </div>
    </div>
  );
}
