"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CALCES, type Calce, type PedidoParaOpinar } from "@isu/shared";
import { api, type ErrorApi } from "@/lib/cliente-api";
import { Foto } from "../Foto";

/*
 * El formulario para opinar de una compra: una tarjeta por prenda (estrellas,
 * cómo le quedó y unas palabras) y una general sobre la compra. Lo único
 * obligatorio son las estrellas; lo que se deja sin estrellas no se manda.
 */
interface Opinion { estrellas: number; texto: string; calce: Calce | null }
const VACIA: Opinion = { estrellas: 0, texto: "", calce: null };
const ETIQUETAS = ["", "No me gustó", "Regular", "Está bien", "Me gustó", "Me encantó"];

function ElegirEstrellas({ valor, onChange, nombre }: { valor: number; onChange: (n: number) => void; nombre: string }) {
  const [sobre, setSobre] = useState(0);
  const ver = sobre || valor;
  return (
    <div className="flex items-center gap-3">
      <div role="radiogroup" aria-label={`Puntaje de ${nombre}`} className="flex" onMouseLeave={() => setSobre(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={valor === n} aria-label={`${n} de 5: ${ETIQUETAS[n]}`}
            onClick={() => onChange(n)} onMouseEnter={() => setSobre(n)}
            className={`px-0.5 text-4xl leading-none transition ${n <= ver ? "text-estrella" : "text-linea"}`}>★</button>
        ))}
      </div>
      <span className="text-sm font-bold text-tinta-suave">{ETIQUETAS[ver]}</span>
    </div>
  );
}

export function FormOpinar({ numero, firma, estrellasIniciales }: { numero: string; firma: string; estrellasIniciales: number | null }) {
  const [pedido, setPedido] = useState<PedidoParaOpinar | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opiniones, setOpiniones] = useState<Record<string, Opinion>>({});
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState<{ publicadas: boolean } | null>(null);
  const q = `opinar/${numero}?t=${encodeURIComponent(firma)}`;

  useEffect(() => {
    api<PedidoParaOpinar>(q).then((p) => {
      setPedido(p);
      // Las estrellas que tocó en el mail van a la primera prenda (y a la general si opina de una sola).
      if (estrellasIniciales) {
        const primera = p.productos.find((x) => !x.yaOpino);
        if (primera) setOpiniones((o) => ({ ...o, [String(primera.productoId)]: { ...VACIA, estrellas: estrellasIniciales } }));
      }
    }, (e: ErrorApi) => setError(e.message));
  }, [q, estrellasIniciales]);

  const de = (k: string) => opiniones[k] ?? VACIA;
  const poner = (k: string, c: Partial<Opinion>) => setOpiniones((o) => ({ ...o, [k]: { ...de(k), ...c } }));

  async function enviar() {
    if (!pedido) return;
    const resenas = Object.entries(opiniones)
      .filter(([, o]) => o.estrellas > 0)
      .map(([k, o]) => ({ productoId: k === "general" ? null : Number(k), estrellas: o.estrellas, ...(o.texto.trim() ? { texto: o.texto.trim() } : {}), ...(k !== "general" && o.calce ? { calce: o.calce } : {}) }));
    if (!resenas.length) { setError("Poné estrellas a por lo menos una prenda."); return; }
    setEnviando(true); setError(null);
    try {
      const r = await api<{ guardadas: number; publicadas: boolean }>(q, { cuerpo: { resenas } });
      setListo({ publicadas: r.publicadas });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  if (listo) {
    return (
      <div className="rounded-[var(--radius-foto)] bg-ahorro-claro p-8 text-center">
        <p className="text-5xl" aria-hidden="true">💚</p>
        <h1 className="mt-3 text-3xl">¡Gracias por contarnos!</h1>
        <p className="mt-2 text-tinta-suave">{listo.publicadas ? "Tu opinión ya se ve en la tienda." : "La vamos a publicar en estos días, apenas la leamos."} Ayuda a otras personas a elegir su talle.</p>
        <Link href="/" className="boton-primario mt-6">Seguir mirando</Link>
      </div>
    );
  }
  if (!pedido) {
    return error
      ? <div className="rounded-2xl border border-linea p-6"><h1 className="text-2xl">No pudimos abrir tu opinión</h1><p className="mt-2 text-tinta-suave" role="alert">{error}</p></div>
      : <p className="text-tinta-tenue">Cargando tu pedido…</p>;
  }
  const pendientes = pedido.productos.filter((x) => !x.yaOpino);
  if (!pendientes.length && pedido.generalYaOpino) {
    return <div className="rounded-2xl border border-linea p-6"><h1 className="text-2xl">Ya nos contaste todo 🙌</h1><p className="mt-2 text-tinta-suave">Gracias por tu opinión sobre el pedido {pedido.numero}.</p></div>;
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
      <h1 className="text-[clamp(2rem,5vw,3rem)] leading-none">¿Qué te pareció, {pedido.nombre}?</h1>
      <p className="mt-3 text-tinta-suave">Pedido {pedido.numero}. Con las estrellas alcanza; si querés, contanos cómo te quedó. Se publica con tu nombre y la inicial del apellido.</p>

      <ul className="mt-8 space-y-4">
        {pendientes.map((x) => {
          const k = String(x.productoId);
          const o = de(k);
          return (
            <li key={k} className="rounded-[var(--radius-foto)] border border-linea p-4 sm:p-5">
              <div className="flex gap-4">
                <div className="aspect-[4/5] w-20 shrink-0 overflow-hidden rounded-xl bg-fondo-suave"><Foto foto={x.foto} alt={x.nombre} sizes="80px" /></div>
                <div className="min-w-0">
                  <p className="font-bold">{x.nombre}</p>
                  <p className="text-sm text-tinta-tenue">{[x.color, x.talle && `Talle ${x.talle}`].filter(Boolean).join(" · ")}</p>
                  <div className="mt-2"><ElegirEstrellas valor={o.estrellas} onChange={(n) => poner(k, { estrellas: n })} nombre={x.nombre} /></div>
                </div>
              </div>
              {o.estrellas > 0 && (
                <div className="mt-4 space-y-3">
                  <fieldset>
                    <legend className="text-sm font-bold">¿Cómo te quedó el talle?</legend>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {CALCES.map((c) => (
                        <button key={c} type="button" aria-pressed={o.calce === c} onClick={() => poner(k, { calce: o.calce === c ? null : c })}
                          className={`rounded-full border px-4 py-2 text-sm font-bold ${o.calce === c ? "border-tinta bg-tinta text-white" : "border-linea hover:border-tinta"}`}>
                          {c === "chico" ? "Chico" : c === "justo" ? "Justo" : "Grande"}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  <label className="block">
                    <span className="text-sm font-bold">Contanos (opcional)</span>
                    <textarea value={o.texto} onChange={(e) => poner(k, { texto: e.target.value.slice(0, 1000) })} rows={3} maxLength={1000}
                      placeholder="¿Cómo es la tela? ¿Para qué la usás?" className="mt-1 w-full rounded-2xl border border-linea p-3 text-[15px]" />
                    <span className="text-xs text-tinta-tenue">{o.texto.length}/1000</span>
                  </label>
                </div>
              )}
            </li>
          );
        })}
        {!pedido.generalYaOpino && (
          <li className="rounded-[var(--radius-foto)] bg-fondo-suave p-4 sm:p-5">
            <p className="font-bold">¿Y la compra en general?</p>
            <p className="text-sm text-tinta-tenue">La atención, el envío, el empaque.</p>
            <div className="mt-2"><ElegirEstrellas valor={de("general").estrellas} onChange={(n) => poner("general", { estrellas: n })} nombre="la compra" /></div>
            {de("general").estrellas > 0 && (
              <textarea value={de("general").texto} onChange={(e) => poner("general", { texto: e.target.value.slice(0, 1000) })} rows={2} maxLength={1000}
                aria-label="Contanos de la compra (opcional)" placeholder="Contanos (opcional)" className="mt-3 w-full rounded-2xl border border-linea bg-white p-3 text-[15px]" />
            )}
          </li>
        )}
      </ul>

      {error && <p className="mt-4 text-sm font-bold text-oferta" role="alert">{error}</p>}
      <button type="submit" disabled={enviando} className="boton-primario mt-6 w-full py-4 text-base disabled:opacity-60">{enviando ? "Enviando…" : "Enviar mi opinión"}</button>
      <p className="mt-3 text-center text-xs text-tinta-tenue">Publicamos las opiniones buenas y las malas, sin editarlas. Sólo sacamos insultos o datos personales.</p>
    </form>
  );
}
