"use client";
import { useCallback, useEffect, useState } from "react";
import { formatearPesos, type RuletaEstado, type RuletaResultado } from "@isu/shared/puro";
import { api, ErrorApi } from "@/lib/cliente-api";

/*
 * Ruleta de descuentos de «Mi cuenta». El navegador NO decide nada: pide el giro a la API (con la sesión de la cuenta), que sortea y
 * crea el cupón personal; acá sólo se dibuja la rueda y se la frena donde dijo el servidor. Una vez por semana por cuenta.
 */
const COLORES = ["fill-oferta", "fill-ahorro", "fill-marca", "fill-tinta-suave"];
const VUELTAS = 5;
const DURACION = 4600;

const fechaCorta = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "long", timeZone: "America/Argentina/Buenos_Aires" });
const punto = (r: number, grados: number) => { const a = ((grados - 90) * Math.PI) / 180; return [150 + r * Math.cos(a), 150 + r * Math.sin(a)] as const; };
function gajo(i: number, n: number) {
  const g = 360 / n;
  const [x1, y1] = punto(144, i * g), [x2, y2] = punto(144, (i + 1) * g);
  return n === 1 ? "M150 6a144 144 0 1 1 -.01 0z" : `M150 150L${x1.toFixed(2)} ${y1.toFixed(2)}A144 144 0 ${g > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}Z`;
}

export function Ruleta() {
  const [estado, setEstado] = useState<RuletaEstado | null>(null);
  const [angulo, setAngulo] = useState(0);
  const [girando, setGirando] = useState(false);
  const [resultado, setResultado] = useState<RuletaResultado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);
  const [sinMovimiento, setSinMovimiento] = useState(false);

  const cargar = useCallback(() => api<RuletaEstado>("cuenta/ruleta").then(setEstado).catch(() => setEstado(null)), []);
  useEffect(() => {
    void cargar();
    setSinMovimiento(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, [cargar]);

  // Cerrada y sin cupones: nada que mostrar. En espera (ya giró) sí: dice cuándo vuelve.
  if (!estado || (estado.motivo === "apagada" && !estado.cupones.length && !resultado)) return null;
  const n = estado.premios.length;
  const g = n ? 360 / n : 360;

  async function girar() {
    if (girando || !estado?.disponible) return;
    setError(null); setResultado(null); setGirando(true);
    try {
      const r = await api<RuletaResultado>("cuenta/ruleta/girar", { cuerpo: {} });
      // Se frena dentro del gajo que dijo el servidor (el punto exacto dentro del gajo es sólo estético).
      const destino = VUELTAS * 360 + (360 - (r.indice + 0.5 + (Math.random() - 0.5) * 0.6) * g);
      setAngulo((a) => a - (a % 360) + destino);
      setTimeout(() => { setResultado(r); setGirando(false); void cargar(); }, sinMovimiento ? 0 : DURACION + 150);
    } catch (e) {
      setGirando(false);
      setError(e instanceof ErrorApi ? e.message : "No pudimos girar la ruleta. Probá de nuevo.");
      void cargar();
    }
  }
  const copiar = async (codigo: string) => { try { await navigator.clipboard.writeText(codigo); setCopiado(codigo); setTimeout(() => setCopiado(null), 2000); } catch { /* el código se ve en pantalla */ } };

  return (
    <section aria-labelledby="titulo-ruleta" className="mt-8 rounded-[var(--radius-foto)] border border-linea bg-fondo-suave p-5 sm:p-8">
      <div className="grid items-center gap-8 md:grid-cols-[320px_1fr]">
        <div className="relative mx-auto w-full max-w-[300px]" aria-hidden="true">
          {/* La flecha que marca el premio. */}
          <svg viewBox="0 0 300 300" className="absolute inset-0 z-10 size-full pointer-events-none"><path d="M150 0l-13 24h26z" className="fill-tinta" /></svg>
          <svg viewBox="0 0 300 300" className="size-full drop-shadow-sm" style={{ transform: `rotate(${angulo}deg)`, transition: girando && !sinMovimiento ? `transform ${DURACION}ms cubic-bezier(.17,.67,.12,1)` : "none" }}>
            <circle cx="150" cy="150" r="148" className="fill-white stroke-tinta" strokeWidth="2" />
            {estado.premios.map((p, i) => {
              const medio = (i + 0.5) * g;
              // El texto corre a lo largo del radio, pegado al borde: así entra aunque haya muchos gajos.
              const [tx, ty] = punto(134, medio);
              return (
                <g key={i}>
                  <path d={gajo(i, n)} className={`${p.tipo === "nada" ? "fill-tinta-suave" : COLORES[i % 3]} stroke-white`} strokeWidth="2" />
                  <text x={tx} y={ty} transform={`rotate(${medio - 90} ${tx} ${ty})`} textAnchor="end" dominantBaseline="middle" className="fill-white text-[12px] font-bold">{p.etiqueta.length > 17 ? `${p.etiqueta.slice(0, 16)}…` : p.etiqueta}</text>
                </g>
              );
            })}
            <circle cx="150" cy="150" r="16" className="fill-white stroke-tinta" strokeWidth="2" />
          </svg>
        </div>

        <div>
          <h2 id="titulo-ruleta" className="text-[clamp(1.8rem,4vw,2.6rem)] leading-none">{estado.evento ? `Ruleta de ${estado.evento}` : "Ruleta de descuentos"}</h2>
          {resultado ? (
            <div role="status" className="mt-4 space-y-2">
              <p className="text-xl font-bold">{resultado.cupon ? `¡Ganaste ${resultado.premio.etiqueta}!` : resultado.premio.etiqueta}</p>
              {resultado.cupon ? (
                <p className="text-tinta-suave">Es tu cupón: escribilo en el carrito al comprar. Sólo lo podés usar vos, una vez{resultado.cupon.hasta ? `, hasta el ${fechaCorta(resultado.cupon.hasta)}` : ""}{resultado.cupon.minimo > 0 ? `, en compras desde ${formatearPesos(resultado.cupon.minimo)}` : ""}.</p>
              ) : <p className="text-tinta-suave">Esta vez no hubo premio, pero seguís participando.</p>}
              <p className="text-sm text-tinta-tenue">Volvé a girar el {fechaCorta(resultado.proximoGiro)}.</p>
            </div>
          ) : estado.disponible ? (
            <p className="mt-3 text-tinta-suave">Girá y ganá un descuento para tu próxima compra. Podés girar una vez por semana{estado.evento ? ` mientras dure ${estado.evento}` : ""}.</p>
          ) : (
            <p className="mt-3 text-tinta-suave">{estado.proximoGiro ? `Ya giraste esta semana. Volvé el ${fechaCorta(estado.proximoGiro)}.` : "La ruleta no está disponible por ahora."}</p>
          )}
          {error && <p role="alert" className="mt-3 rounded-xl bg-oferta/10 p-3 text-sm font-bold text-oferta">{error}</p>}
          {estado.disponible && !resultado && (
            <button type="button" onClick={() => void girar()} disabled={girando} className="boton-primario mt-5 disabled:opacity-60">{girando ? "Girando…" : "Girar la ruleta"}</button>
          )}
          {estado.cupones.length > 0 && (
            <div className="mt-6">
              <h3 className="text-lg">Mis cupones</h3>
              <ul className="mt-2 space-y-2">
                {estado.cupones.map((c) => (
                  <li key={c.codigo} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-linea bg-white px-4 py-3 text-sm">
                    <span><b className="font-mono tracking-wide">{c.codigo}</b><br /><span className="text-tinta-tenue">{c.nombre.replace(/^Ruleta: /, "")}{c.minimo > 0 ? ` · desde ${formatearPesos(c.minimo)}` : ""}{c.hasta ? ` · hasta el ${fechaCorta(c.hasta)}` : ""}</span></span>
                    <button type="button" onClick={() => void copiar(c.codigo)} className="boton-borde py-1.5 text-sm">{copiado === c.codigo ? "¡Copiado!" : "Copiar"}</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
