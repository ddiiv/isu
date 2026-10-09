"use client";
import { useEffect, useState } from "react";

/*
 * Etapa 14: un cajón o una ventana que sale animada en vez de desaparecer de
 * golpe. Lo deja montado unos milisegundos después de cerrarlo (`saliendo`)
 * para que corra la animación de salida; quien pidió menos animaciones lo ve
 * cerrarse en el acto.
 */
export function useSalida(abierto: boolean, ms = 220) {
  const [montado, setMontado] = useState(abierto);
  useEffect(() => {
    if (abierto) { setMontado(true); return; }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setMontado(false); return; }
    const t = setTimeout(() => setMontado(false), ms);
    return () => clearTimeout(t);
  }, [abierto, ms]);
  return { montado: abierto || montado, saliendo: !abierto && montado };
}
