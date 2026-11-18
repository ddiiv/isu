"use client";
import Link from "next/link";
import { useSyncExternalStore } from "react";

/*
 * Descuentos relámpago: un descuento que termina en 48 horas o menos. Se ven
 * en rojo (token `oferta`) con una cuenta regresiva. Un solo reloj para toda la
 * página (cada tarjeta lo comparte): no hay un intervalo por producto.
 *
 * Sin salto de diseño ni error de hidratación: antes de montar (servidor y primer
 * render del cliente) los números son "--:--:--"; al montar empiezan a correr. Si
 * el descuento ya terminó, se oculta solo. Sin animación con movimiento reducido
 * (globals.css apaga todas) y sin avisar cada segundo a los lectores de pantalla.
 */
export const HORAS_RELAMPAGO = 48;

let ahora = 0;
const oyentes = new Set<() => void>();
let reloj: ReturnType<typeof setInterval> | undefined;
function suscribir(f: () => void) {
  oyentes.add(f);
  if (!reloj) {
    ahora = Date.now();
    reloj = setInterval(() => { ahora = Date.now(); oyentes.forEach((o) => o()); }, 1000);
  }
  return () => {
    oyentes.delete(f);
    if (!oyentes.size && reloj) { clearInterval(reloj); reloj = undefined; }
  };
}
/** 0 = todavía no montó. */
const useAhora = () => useSyncExternalStore(suscribir, () => ahora, () => 0);

const dos = (n: number) => String(n).padStart(2, "0");
const reloj_ = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${dos(Math.floor(s / 3600))}:${dos(Math.floor((s % 3600) / 60))}:${dos(s % 60)}`; };
/** "Termina en 5 horas y 12 minutos" (cambia por minuto: no se lo anuncia por segundo). */
function textoLegible(ms: number) {
  const m = Math.max(0, Math.floor(ms / 60_000)), h = Math.floor(m / 60);
  return h ? `${h} ${h === 1 ? "hora" : "horas"} y ${m % 60} ${m % 60 === 1 ? "minuto" : "minutos"}` : `${m} ${m === 1 ? "minuto" : "minutos"}`;
}

/** Milisegundos que faltan si es relámpago vigente (termina en ≤ 48 h), si no null. `listo` = ya montó (el reloj corre). */
export function useRelampago(hasta: string | null | undefined): { ms: number; listo: boolean } | null {
  const a = useAhora();
  if (!hasta) return null;
  const ms = Date.parse(hasta) - (a || Date.now());
  return ms > 0 && ms <= HORAS_RELAMPAGO * 3_600_000 ? { ms, listo: a > 0 } : null;
}

const PULSO = "motion-safe:animate-pulso-suave";

/** Cuenta regresiva en rojo. `soloLector`: sin dibujo, para quien usa lector de pantalla (la tarjeta tiene la foto oculta). */
export function Cuenta({ hasta, className = "", soloLector = false }: { hasta: string | null | undefined; className?: string; soloLector?: boolean }) {
  const r = useRelampago(hasta);
  if (!r) return null;
  const etiqueta = `Oferta relámpago: termina en ${textoLegible(r.ms)}`;
  if (soloLector) return <span role="timer" className="sr-only">{etiqueta}</span>;
  return (
    <span role="timer" aria-label={etiqueta} className={`inline-flex min-w-[5.5rem] justify-center rounded-full bg-oferta px-2.5 py-1 text-xs font-bold tabular-nums text-white ${className}`}>
      <span aria-hidden="true">{r.listo ? reloj_(r.ms) : "--:--:--"}</span>
    </span>
  );
}

/** «⚡ RELÁMPAGO −X%» en rojo, con la cuenta al lado o abajo. */
/** `sino`: lo que se muestra cuando no es relámpago (el "-X%" de siempre). */
export function EtiquetaRelampago({ hasta, porcentaje, grande = false, sino = null }: { hasta: string | null | undefined; porcentaje: number | null; grande?: boolean; sino?: React.ReactNode }) {
  const r = useRelampago(hasta);
  if (!r) return <>{sino}</>;
  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 ${PULSO}`}>
      <span className={`rounded-full bg-oferta font-bold uppercase tracking-wide text-white ${grande ? "px-3 py-1.5 text-sm" : "px-2.5 py-1 text-xs"}`}>
        <span aria-hidden="true">⚡ </span>Relámpago{porcentaje ? <> −{porcentaje}%</> : null}
      </span>
      <Cuenta hasta={hasta} />
    </span>
  );
}

/** Cartel rojo de arriba del sitio mientras haya un relámpago vigente. Se reserva el lugar desde el servidor: no empuja la página. */
export function CartelRelampago({ relampago }: { relampago: { porcentaje: number; hasta: string } | null }) {
  const r = useRelampago(relampago?.hasta);
  const a = useAhora();
  // Antes de montar se dibuja igual (con números en guiones); ya montado y vencido, se va.
  if (!relampago || (a > 0 && !r)) return null;
  return (
    <div className="bg-oferta text-center text-[13px] font-bold tracking-wide text-white">
      <Link href="/relampago" className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-2 px-4 py-2 hover:underline">
        <span className={PULSO}><span aria-hidden="true">⚡ </span>RELÁMPAGO: hasta {relampago.porcentaje}% OFF</span>
        <span aria-hidden="true">·</span>
        <span>termina en <span className="tabular-nums" aria-hidden="true">{r?.listo ? reloj_(r.ms) : "--:--:--"}</span><span className="sr-only">{r ? textoLegible(r.ms) : ""}</span></span>
      </Link>
    </div>
  );
}
