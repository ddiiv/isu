"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  FAMILIAS, MEDIDAS, MUESTRA_FAMILIA, NOMBRE_FAMILIA, NOMBRE_PARTE, PARTES, TALLES_ADULTO, TALLES_NINO_HABITUALES, formatearPesos,
  type Familia, type MedidasCliente, type Parte, type PedidoOutfits, type PiezaOutfit, type RespuestaOutfits,
} from "@isu/shared";
import { api, ErrorApi } from "@/lib/cliente-api";
import { useMedidas } from "@/lib/medidas";
import { evento } from "@/lib/ga";
import { useCarrito } from "../carrito/Carrito";
import { Foto } from "../Foto";

/*
 * "Armá tu outfit" en UNA pantalla, sin cuestionario de diez pasos:
 * para quién, talle (o medidas), cuánto gastar y qué sumar. Los colores son
 * opcionales. Cada outfit se puede ajustar prenda por prenda ("Cambiar") y va
 * entero al carrito con un toque.
 */
type Para = "mujer" | "hombre" | "ninos";
const PARA: Array<[Para, string]> = [["mujer", "Mujer"], ["hombre", "Hombre"], ["ninos", "Niñas y niños"]];
const RAPIDOS = [40_000, 70_000, 100_000, 150_000];
type Outfit = RespuestaOutfits["outfits"][number];

const Chip = ({ activo, children, ...r }: React.ButtonHTMLAttributes<HTMLButtonElement> & { activo: boolean }) => (
  <button type="button" aria-pressed={activo} {...r}
    className={`rounded-full border px-4 py-2 text-[15px] font-bold transition ${activo ? "border-tinta bg-tinta text-white" : "border-linea hover:border-tinta"} ${r.className ?? ""}`}>
    {children}
  </button>
);

export function ArmadorOutfits({ descuento }: { descuento: number }) {
  const carrito = useCarrito();
  const { medidas: guardadas, guardar } = useMedidas();
  const [para, setPara] = useState<Para>("mujer");
  const [modo, setModo] = useState<"talle" | "medidas">("talle");
  const [talle, setTalle] = useState<string | null>(null);
  const [medidas, setMedidas] = useState<Record<string, string>>({});
  const [presupuesto, setPresupuesto] = useState("70000");
  const [partes, setPartes] = useState<Parte[]>(["arriba", "abajo"]);
  const [familias, setFamilias] = useState<Familia[]>([]);
  const [semilla, setSemilla] = useState(0);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<RespuestaOutfits | null>(null);
  const [outfits, setOutfits] = useState<Outfit[]>([]);
  const [vistos, setVistos] = useState<Record<string, number[]>>({});
  const [aviso, setAviso] = useState<string | null>(null);
  const resultados = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (Object.keys(guardadas).length) setMedidas(Object.fromEntries(Object.entries(guardadas).map(([k, v]) => [k, String(v)])));
  }, [guardadas]);

  const talles = para === "ninos" ? TALLES_NINO_HABITUALES : TALLES_ADULTO;
  const camposMedidas = (para === "ninos" ? ["altura", "edad", "pecho", "cintura"] : ["altura", "pecho", "cintura", "cadera"]) as Array<keyof typeof MEDIDAS>;
  const leidas: MedidasCliente = Object.fromEntries(
    Object.entries(medidas).filter(([k]) => camposMedidas.includes(k as keyof typeof MEDIDAS))
      .map(([k, v]) => [k, Number(v.replace(",", "."))]).filter(([, v]) => Number.isFinite(v) && (v as number) > 0 && (v as number) < 300),
  );
  const pesos = Math.round(Number(presupuesto.replace(/\D/g, "")) || 0);

  const cuerpo = (extra: Partial<PedidoOutfits> = {}): PedidoOutfits => ({
    para, presupuesto: pesos * 100, partes, familias, semilla,
    ...(modo === "talle" ? { talle } : { medidas: leidas }),
    ...extra,
  });

  async function armar(nuevaSemilla = semilla) {
    setError(null); setAviso(null);
    if (modo === "talle" && !talle) { setError("Elegí tu talle (o cargá tus medidas)."); return; }
    if (modo === "medidas" && !Object.keys(leidas).length) { setError("Cargá al menos una medida."); return; }
    if (pesos < 1000) { setError("Poné cuánto querés gastar."); return; }
    if (!partes.length) { setError("Elegí al menos una parte del outfit."); return; }
    if (modo === "medidas") guardar({ ...guardadas, ...leidas });
    setCargando(true);
    try {
      const r = await api<RespuestaOutfits>("outfits", { cuerpo: cuerpo({ semilla: nuevaSemilla }) });
      setRes(r); setOutfits(r.outfits); setVistos({}); setSemilla(nuevaSemilla);
      evento("view_item_list", { item_list_name: "Outfits", items: r.outfits.flatMap((o) => o.piezas).slice(0, 20).map((p) => ({ item_id: p.slug, item_name: p.nombre, item_variant: p.sku, price: p.precio / 100 })) });
      requestAnimationFrame(() => resultados.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (e) {
      setError(e instanceof ErrorApi ? e.message : "No pudimos armar los outfits. Probá de nuevo.");
    } finally {
      setCargando(false);
    }
  }

  async function cambiar(i: number, pieza: PiezaOutfit) {
    const o = outfits[i]!;
    const clave = `${i}:${pieza.parte}`;
    const excluir = [...(vistos[clave] ?? []), pieza.productoId];
    setAviso(null);
    try {
      const r = await api<RespuestaOutfits>("outfits", {
        cuerpo: cuerpo({ reemplazar: { parte: pieza.parte, fijos: o.piezas.filter((p) => p.sku !== pieza.sku).map((p) => p.sku), excluir: excluir.slice(-200) } }),
      });
      const otra = r.alternativas?.[0];
      if (!otra) { setAviso(`No encontramos otra opción de "${NOMBRE_PARTE[pieza.parte].toLowerCase()}" para ese presupuesto.`); setVistos((v) => ({ ...v, [clave]: [] })); return; }
      setVistos((v) => ({ ...v, [clave]: excluir }));
      setOutfits((os) => os.map((x, j) => {
        if (j !== i) return x;
        const piezas = x.piezas.map((p) => (p.sku === pieza.sku ? otra : p));
        return { piezas, total: piezas.reduce((s, p) => s + p.precio, 0) };
      }));
    } catch (e) {
      setAviso(e instanceof ErrorApi ? e.message : "No pudimos cambiar esa prenda.");
    }
  }

  function llevar(o: Outfit) {
    for (const p of o.piezas) {
      carrito.agregar({ sku: p.sku, nombre: p.nombre, slug: p.slug, color: p.color?.nombre ?? null, talle: p.talle, precio: p.precio, foto: p.foto?.clave ?? null });
    }
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[380px_minmax(0,1fr)] lg:gap-14">
      <form className="space-y-7 lg:sticky lg:top-28 lg:self-start" onSubmit={(e) => { e.preventDefault(); void armar(0); }} noValidate>
        <fieldset>
          <legend className="text-sm font-bold">¿Para quién?</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {PARA.map(([k, t]) => <Chip key={k} activo={para === k} onClick={() => { setPara(k); setTalle(null); }}>{t}</Chip>)}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-bold">{modo === "talle" ? "Tu talle" : "Tus medidas"}</legend>
          {modo === "talle" ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {talles.map((t) => <Chip key={t} activo={talle === t} className="min-w-12 px-3" onClick={() => setTalle(t)}>{t}</Chip>)}
            </div>
          ) : (
            <div className="mt-2 grid grid-cols-2 gap-3">
              {camposMedidas.map((k) => (
                <label key={k} className="text-sm">
                  <span className="text-tinta-suave">{MEDIDAS[k].nombre.replace("Contorno de ", "")}</span>
                  <span className="relative mt-1 block">
                    <input inputMode="decimal" value={medidas[k] ?? ""} onChange={(e) => setMedidas((m) => ({ ...m, [k]: e.target.value.replace(/[^\d.,]/g, "").slice(0, 5) }))}
                      className="w-full rounded-xl border border-linea px-3 py-2.5 pr-12 text-base" title={MEDIDAS[k].ayuda} />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-tinta-tenue">{k === "edad" ? "años" : "cm"}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
          <button type="button" className="mt-2 text-sm font-bold text-marca underline underline-offset-2" onClick={() => setModo(modo === "talle" ? "medidas" : "talle")}>
            {modo === "talle" ? "No sé mi talle: usar mis medidas" : "Prefiero elegir el talle"}
          </button>
          {modo === "medidas" && <p className="mt-1 text-xs text-tinta-tenue">Con tus medidas elegimos el talle de cada prenda según su guía. Quedan sólo en este dispositivo.</p>}
        </fieldset>

        <fieldset>
          <legend className="text-sm font-bold">¿Cuánto querés gastar como máximo?</legend>
          <label className="relative mt-2 block">
            <span className="sr-only">Presupuesto en pesos</span>
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-lg text-tinta-tenue">$</span>
            <input inputMode="numeric" value={pesos ? pesos.toLocaleString("es-AR") : ""} onChange={(e) => setPresupuesto(e.target.value.replace(/\D/g, "").slice(0, 9))}
              className="w-full rounded-xl border border-linea py-3 pl-9 pr-4 text-lg font-bold" />
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            {RAPIDOS.map((v) => <Chip key={v} activo={pesos === v} className="px-3 py-1.5 text-sm" onClick={() => setPresupuesto(String(v))}>{formatearPesos(v * 100)}</Chip>)}
          </div>
          {descuento > 0 && <p className="mt-2 text-xs text-ahorro">Pagando con transferencia tenés {descuento}% OFF sobre ese total.</p>}
        </fieldset>

        <fieldset>
          <legend className="text-sm font-bold">¿Qué sumamos?</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {PARTES.map((p) => (
              <Chip key={p} activo={partes.includes(p)} onClick={() => setPartes((ps) => (ps.includes(p) ? ps.filter((x) => x !== p) : PARTES.filter((x) => x === p || ps.includes(x))))}>{NOMBRE_PARTE[p]}</Chip>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-bold">Colores que te gustan <span className="font-normal text-tinta-tenue">(opcional)</span></legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {FAMILIAS.map((f) => (
              <button key={f} type="button" aria-pressed={familias.includes(f)} onClick={() => setFamilias((fs) => (fs.includes(f) ? fs.filter((x) => x !== f) : [...fs, f]))}
                className={`inline-flex items-center gap-2 rounded-full border py-1.5 pl-1.5 pr-3 text-sm transition ${familias.includes(f) ? "border-tinta bg-fondo-suave font-bold" : "border-linea hover:border-tinta"}`}>
                <span aria-hidden="true" className="size-5 rounded-full border border-linea" style={{ background: f === "neutros" ? "linear-gradient(135deg,#111 0 33%,#fff 33% 66%,#d8c3a5 66%)" : MUESTRA_FAMILIA[f] }} />
                {NOMBRE_FAMILIA[f]}
              </button>
            ))}
          </div>
        </fieldset>

        {error && <p role="alert" className="text-sm font-bold text-oferta">{error}</p>}
        <button type="submit" disabled={cargando} className="boton-primario w-full py-4 text-base disabled:opacity-60">
          {cargando ? "Armando…" : "Armar mis outfits"}
        </button>
      </form>

      <div ref={resultados} className="scroll-mt-28" aria-live="polite">
        {!res ? (
          <div className="grid min-h-80 place-items-center rounded-[var(--radius-foto)] border border-dashed border-linea p-8 text-center">
            <div>
              <p className="font-display text-3xl">Tu outfit en un minuto</p>
              <p className="mt-2 text-tinta-suave">Completá lo de la izquierda y te mostramos combinaciones con lo que hay en tu talle.</p>
            </div>
          </div>
        ) : !outfits.length ? (
          <div className="rounded-[var(--radius-foto)] bg-fondo-suave p-8 text-center">
            <p className="font-display text-3xl">
              {res.motivo === "presupuesto" ? "Con ese presupuesto no llegamos" : res.motivo === "sin_talle" ? "No encontramos tu talle con esas medidas" : "No hay prendas para armar ese outfit"}
            </p>
            <p className="mt-2 text-tinta-suave">
              {res.motivo === "presupuesto" && res.minimo ? <>Un outfit así arranca en <span className="font-bold text-tinta">{formatearPesos(res.minimo)}</span>. Probá subir el presupuesto o sacar una parte.</>
                : res.motivo === "sin_talle" ? "Probá elegir el talle directamente o escribinos por WhatsApp."
                : "Probá con otro talle, sacando una parte o sin filtro de colores."}
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-3xl">Te armamos {outfits.length} {outfits.length === 1 ? "outfit" : "outfits"}</h2>
              <button type="button" className="boton-borde py-2" disabled={cargando} onClick={() => void armar(semilla + 1)}>Ver otras ideas</button>
            </div>
            {aviso && <p className="mt-3 text-sm font-bold text-oferta">{aviso}</p>}
            <ul className="mt-6 grid gap-6 xl:grid-cols-2">
              {outfits.map((o, i) => (
                <li key={o.piezas.map((p) => p.sku).join("|") + i} className="rounded-[var(--radius-foto)] border border-linea p-4">
                  <ul className={`grid gap-3 ${o.piezas.length === 3 ? "grid-cols-3" : o.piezas.length === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
                    {o.piezas.map((p) => (
                      <li key={p.sku} className="flex flex-col">
                        <Link href={`/producto/${p.slug}${p.color ? `?color=${p.color.clave}` : ""}`} className="block aspect-[4/5] overflow-hidden rounded-xl bg-fondo-suave">
                          <Foto foto={p.foto} alt={p.nombre} sizes="(min-width:1280px) 15vw, 30vw" tono={p.color?.hex} />
                        </Link>
                        <p className="mt-2 text-xs font-bold uppercase tracking-wide text-tinta-tenue">{NOMBRE_PARTE[p.parte]}</p>
                        <Link href={`/producto/${p.slug}`} className="text-sm leading-snug hover:underline">{p.nombre}</Link>
                        <p className="text-xs text-tinta-suave">{[p.color?.nombre, p.talle ? `Talle ${p.talle}` : null].filter(Boolean).join(" · ")}{p.talleRecomendado && <span className="text-marca"> (por tus medidas)</span>}</p>
                        <p className="mt-0.5 text-sm font-bold">
                          {p.precioLista && <s className="mr-1 font-normal text-tinta-tenue">{formatearPesos(p.precioLista)}</s>}
                          {formatearPesos(p.precio)}
                        </p>
                        <button type="button" onClick={() => void cambiar(i, p)} className="mt-1 self-start text-xs font-bold text-marca underline underline-offset-2">Cambiar</button>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-linea pt-4">
                    <p><span className="text-sm text-tinta-suave">Total</span> <span className="font-display text-2xl">{formatearPesos(o.total)}</span></p>
                    <button type="button" className="boton-primario" onClick={() => llevar(o)}>Agregar todo al carrito</button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
