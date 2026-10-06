"use client";
import { useState } from "react";
import { TEXTO_CALCE, type ResenaPublica, type ResenasProducto } from "@isu/shared";
import { api } from "@/lib/cliente-api";
import { Estrellas, decimal } from "../Estrellas";

/*
 * Opiniones de una prenda, al pie de la ficha. La primera página viene en el
 * HTML (la lee Google); ordenar y "Ver más" se piden a la API.
 *
 * Sólo opina quien la compró y la recibió: lo dice arriba, para que se lea
 * como lo que es (no un foro abierto).
 */
type Orden = "recientes" | "mejores" | "peores";
const fecha = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" });

export function Opinion({ r }: { r: ResenaPublica }) {
  return (
    <li className="py-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Estrellas valor={r.estrellas} className="text-sm" />
        <span className="font-bold">{r.nombre}</span>
        <span className="rounded-full bg-ahorro-claro px-2 py-0.5 text-xs font-bold text-ahorro">Compra verificada</span>
        <span className="text-sm text-tinta-tenue">{fecha(r.fecha)}</span>
      </div>
      {(r.talle || r.color || r.calce) && (
        <p className="mt-1 text-sm text-tinta-tenue">
          {[r.color && `Color ${r.color}`, r.talle && `Talle ${r.talle}`, r.calce && TEXTO_CALCE[r.calce]].filter(Boolean).join(" · ")}
        </p>
      )}
      {r.texto && <p className="mt-2 whitespace-pre-line leading-relaxed">{r.texto}</p>}
      {r.respuesta && (
        <div className="mt-3 rounded-2xl bg-fondo-suave p-3 text-sm">
          <p className="font-bold">Respuesta de Isuwaya</p>
          <p className="mt-1 whitespace-pre-line text-tinta-suave">{r.respuesta}</p>
        </div>
      )}
    </li>
  );
}

export function OpinionesProducto({ slug, inicial }: { slug: string; inicial: ResenasProducto | null }) {
  const [datos, setDatos] = useState(inicial);
  const [lista, setLista] = useState<ResenaPublica[]>(inicial?.resenas ?? []);
  const [orden, setOrden] = useState<Orden>("recientes");
  const [pagina, setPagina] = useState(1);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pedir(o: Orden, p: number) {
    setCargando(true); setError(null);
    try {
      const r = await api<ResenasProducto>(`productos/${slug}/resenas?orden=${o}&pagina=${p}`);
      setDatos(r);
      setLista((l) => (p === 1 ? r.resenas : [...l, ...r.resenas]));
      setOrden(o); setPagina(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  const s = datos?.resumen;
  const total = s?.cantidad ?? 0;
  const calces = s ? s.calce.chico + s.calce.justo + s.calce.grande : 0;
  const masDicho = s && calces ? (Object.entries(s.calce) as Array<[keyof typeof TEXTO_CALCE, number]>).sort((a, b) => b[1] - a[1])[0]! : null;

  return (
    <section id="opiniones" aria-labelledby="titulo-opiniones" className="mt-16 scroll-mt-28 border-t border-linea pt-10">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div>
          <h2 id="titulo-opiniones" className="text-3xl">Opiniones</h2>
          <p className="mt-1 text-sm text-tinta-tenue">Sólo de quienes la compraron y la recibieron.</p>
          {s && total > 0 && s.promedio ? (
            <>
              <div className="mt-5 flex items-end gap-3">
                <span className="font-display text-6xl leading-none">{decimal(s.promedio)}</span>
                <div className="pb-1"><Estrellas valor={s.promedio} className="text-xl" /><p className="text-sm text-tinta-tenue">{total} {total === 1 ? "opinión" : "opiniones"}</p></div>
              </div>
              <ul className="mt-5 space-y-1.5" aria-label="Cuántas de cada puntaje">
                {[5, 4, 3, 2, 1].map((e) => {
                  const n = s.estrellas[e - 1] ?? 0;
                  return (
                    <li key={e} className="flex items-center gap-2 text-sm">
                      <span className="w-20 shrink-0 whitespace-nowrap">{e} estrella{e > 1 ? "s" : ""}</span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-fondo-suave"><span className="block h-full rounded-full bg-estrella" style={{ width: `${total ? (n / total) * 100 : 0}%` }} /></span>
                      <span className="w-6 shrink-0 text-right text-tinta-tenue">{n}</span>
                    </li>
                  );
                })}
              </ul>
              {masDicho && masDicho[1] > 0 && (
                <p className="mt-5 rounded-2xl bg-marca-claro p-3 text-sm">
                  <b>Calce:</b> {masDicho[1]} de {calces} {masDicho[1] === 1 ? "dice" : "dicen"} que {masDicho[0] === "justo" ? "el talle es justo" : masDicho[0] === "chico" ? "le quedó chico" : "le quedó grande"}.
                </p>
              )}
            </>
          ) : (
            <p className="mt-5 text-tinta-suave">Todavía no hay opiniones. Si la compraste, te mandamos un mail para que nos cuentes cómo te quedó.</p>
          )}
        </div>

        {total > 0 && (
          <div>
            <div className="flex items-center justify-between gap-3 border-b border-linea pb-3">
              <p className="text-sm text-tinta-tenue">{total} {total === 1 ? "opinión" : "opiniones"}</p>
              <label className="flex items-center gap-2 text-sm">
                Ordenar
                <select value={orden} onChange={(e) => void pedir(e.target.value as Orden, 1)} className="rounded-full border border-linea bg-white px-3 py-1.5">
                  <option value="recientes">Más recientes</option>
                  <option value="mejores">Mejor puntaje</option>
                  <option value="peores">Peor puntaje</option>
                </select>
              </label>
            </div>
            <ul className="divide-y divide-linea" aria-busy={cargando}>
              {lista.map((r) => <Opinion key={r.id} r={r} />)}
            </ul>
            {error && <p className="mt-3 text-sm font-bold text-oferta" role="alert">{error}</p>}
            {lista.length < total && (
              <button type="button" onClick={() => void pedir(orden, pagina + 1)} disabled={cargando} className="boton-borde mt-4">
                {cargando ? "Cargando…" : "Ver más opiniones"}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
