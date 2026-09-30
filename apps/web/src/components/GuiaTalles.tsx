"use client";
import { useEffect, useId, useRef, useState } from "react";
import { normalizarTalle, recomendarTalle, type GuiaPublica, type MedidasCliente } from "@isu/shared";
import { useMedidas } from "@/lib/medidas";
import { IconoCerrar } from "./iconos";

/*
 * Guía de talles de la prenda, como en Mercado Libre: la tabla con las
 * medidas de cada talle y "¿Cuál es mi talle?", que con las medidas del
 * cliente recomienda uno. Se abre en un <dialog> nativo (foco, Escape y
 * fondo inerte los resuelve el navegador).
 */
const unidad = (clave: string) => (clave === "edad" ? "años" : "cm");
const rango = (r: [number, number] | null) => (!r ? "–" : r[0] === r[1] ? `${r[0]}` : `${r[0]}–${r[1]}`);

export function useRecomendado(guia: GuiaPublica | null) {
  const { medidas } = useMedidas();
  if (!guia) return null;
  const r = recomendarTalle(guia, medidas);
  return r.talle;
}

export function BotonGuiaTalles({ guia, disponibles, coloresCon, onElegir }: {
  guia: GuiaPublica; disponibles: string[]; onElegir: (talle: string) => void;
  /** En qué otros colores hay stock de un talle (para no dejar al cliente sin salida). */
  coloresCon?: (talle: string) => string[];
}) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const titulo = useId();
  const [pestana, setPestana] = useState<"tabla" | "mi-talle">("tabla");
  const { medidas, guardar } = useMedidas();
  const [borrador, setBorrador] = useState<Record<string, string>>({});
  const cuerpo = guia.medidas.filter((m) => m.tipo === "cuerpo");

  useEffect(() => {
    setBorrador(Object.fromEntries(Object.entries(medidas).map(([k, v]) => [k, String(v)])));
  }, [medidas]);

  const leidas: MedidasCliente = Object.fromEntries(
    Object.entries(borrador).map(([k, v]) => [k, Number(v.replace(",", "."))]).filter(([, v]) => Number.isFinite(v) && (v as number) > 0 && (v as number) < 300),
  );
  const rec = recomendarTalle(guia, leidas);
  const hay = rec.talle ? disponibles.find((d) => normalizarTalle(d) === rec.talle) : undefined;

  return (
    <>
      <button type="button" onClick={() => { setPestana(cuerpo.length && Object.keys(medidas).length ? "mi-talle" : "tabla"); dialogo.current?.showModal(); }}
        className="text-sm font-bold text-marca underline underline-offset-2 hover:text-marca-fuerte">
        Guía de talles
      </button>
      <dialog ref={dialogo} aria-labelledby={titulo} onClick={(e) => { if (e.target === dialogo.current) dialogo.current?.close(); }}
        className="m-auto w-[min(640px,calc(100vw-2rem))] max-h-[88vh] rounded-[var(--radius-foto)] bg-white p-0 text-tinta shadow-2xl backdrop:bg-black/40">
        <div className="sticky top-0 flex items-center justify-between border-b border-linea bg-white px-5 py-4">
          <h2 id={titulo} className="text-2xl">Guía de talles</h2>
          <button type="button" aria-label="Cerrar" className="-mr-2 p-2" onClick={() => dialogo.current?.close()}><IconoCerrar /></button>
        </div>
        <div className="px-5 pb-6 pt-4">
          <p className="text-sm text-tinta-suave">{guia.nombre}</p>
          {cuerpo.length > 0 && (
            <div role="tablist" className="mt-3 inline-flex rounded-full bg-fondo-suave p-1 text-sm font-bold">
              {([["tabla", "Tabla de medidas"], ["mi-talle", "¿Cuál es mi talle?"]] as const).map(([k, t]) => (
                <button key={k} type="button" role="tab" aria-selected={pestana === k} onClick={() => setPestana(k)}
                  className={`rounded-full px-4 py-2 ${pestana === k ? "bg-white shadow-sm" : "text-tinta-suave"}`}>{t}</button>
              ))}
            </div>
          )}

          {pestana === "tabla" ? (
            <>
              <div className="mt-4 overflow-x-auto rounded-xl border border-linea">
                <table className="w-full min-w-max text-left text-sm">
                  <thead className="bg-fondo-suave">
                    <tr>
                      <th scope="col" className="px-3 py-2.5">Talle</th>
                      {guia.medidas.map((m) => <th key={m.clave} scope="col" className="px-3 py-2.5">{m.nombre} <span className="font-normal text-tinta-tenue">({unidad(m.clave)})</span></th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {guia.filas.map((f) => (
                      <tr key={f.talle} className={`border-t border-linea ${rec.talle === f.talle ? "bg-marca-claro" : ""}`}>
                        <th scope="row" className="px-3 py-2.5 font-bold">{f.talle}{rec.talle === f.talle && <span className="ml-2 text-xs text-marca">tu talle</span>}</th>
                        {f.valores.map((v, i) => <td key={i} className="px-3 py-2.5 tabular-nums">{rango(v)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {guia.nota && <p className="mt-3 text-sm text-tinta-suave">{guia.nota}</p>}
              <details className="mt-4 text-sm">
                <summary className="cursor-pointer font-bold">Cómo medir</summary>
                <ul className="mt-2 space-y-1.5 text-tinta-suave">
                  {guia.medidas.map((m) => <li key={m.clave}><span className="font-bold text-tinta">{m.nombre}:</span> {m.ayuda}</li>)}
                </ul>
              </details>
            </>
          ) : (
            <form className="mt-4" onSubmit={(e) => { e.preventDefault(); guardar({ ...medidas, ...leidas }); }}>
              <p className="text-sm text-tinta-suave">Cargá tus medidas (con una alcanza) y te decimos qué talle de esta prenda te va. Quedan guardadas sólo en este dispositivo.</p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                {cuerpo.map((m) => (
                  <label key={m.clave} className="text-sm">
                    <span className="font-bold">{m.nombre}</span>
                    <span className="relative mt-1 block">
                      <input inputMode="decimal" value={borrador[m.clave] ?? ""} onChange={(e) => setBorrador((b) => ({ ...b, [m.clave]: e.target.value.replace(/[^\d.,]/g, "").slice(0, 5) }))}
                        onBlur={() => guardar({ ...medidas, ...leidas })}
                        className="w-full rounded-xl border border-linea px-3 py-2.5 pr-12 text-base" aria-describedby={`ayuda-${m.clave}`} />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-tinta-tenue">{unidad(m.clave)}</span>
                    </span>
                    <span id={`ayuda-${m.clave}`} className="mt-1 block text-xs text-tinta-tenue">{m.ayuda}</span>
                  </label>
                ))}
              </div>
              <div className="mt-5 rounded-xl bg-fondo-suave p-4" aria-live="polite">
                {rec.motivo === "sin_medidas" && <p className="text-sm text-tinta-suave">Completá al menos una medida.</p>}
                {rec.motivo === "grande" && <p className="text-sm">Esta prenda te puede quedar chica aun en el talle más grande. Escribinos por WhatsApp y te ayudamos.</p>}
                {rec.motivo === "chico" && <p className="text-sm">Esta prenda te puede quedar grande aun en el talle más chico. Escribinos por WhatsApp y te ayudamos.</p>}
                {rec.talle && (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p><span className="text-sm text-tinta-suave">Te recomendamos</span><br /><span className="font-display text-3xl">Talle {rec.talle}</span>
                      {!rec.exacto && <span className="block text-xs text-tinta-tenue">Estás entre dos talles: te sugerimos el más cómodo.</span>}</p>
                    {hay
                      ? <button type="submit" className="boton-primario" onClick={() => { onElegir(hay); dialogo.current?.close(); }}>Elegir talle {rec.talle}</button>
                      : <p className="max-w-60 text-sm font-bold text-oferta">No hay talle {rec.talle} en este color.
                          {(coloresCon?.(rec.talle) ?? []).length > 0 && <span className="block font-normal text-tinta-suave">Hay en: {coloresCon!(rec.talle).join(", ")}.</span>}</p>}
                  </div>
                )}
              </div>
            </form>
          )}
        </div>
      </dialog>
    </>
  );
}
