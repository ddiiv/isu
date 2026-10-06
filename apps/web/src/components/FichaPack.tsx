"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  CANTIDADES_PACK, centavos, compararTalles, conDescuento, esClaro, formatearPesos, porcentajePack, rutaPack,
  type ConfigPublica, type ProductoDetalle, type VariantePublica,
} from "@isu/shared";
import { Foto, SinFoto } from "./Foto";
import { useCarrito } from "./carrito/Carrito";
import { ResumenEstrellas } from "./Estrellas";

/*
 * Página del pack: /producto/pack-x3-<slug>. Se eligen cuántas (2 a 5) y,
 * para cada prenda, el talle y el color (como las tiendas de referencia:
 * primero el talle, después los colores que hay en ese talle). Cambiar la
 * cantidad cambia la dirección sin recargar.
 *
 * El precio que se muestra es el que va a calcular la API en el carrito
 * (mismo % y mismo redondeo): la rebaja de la prenda y el pack no se suman,
 * gana el mayor.
 */
interface Eleccion { talle: string | null; color: string | null }
const VACIA: Eleccion = { talle: null, color: null };

export function FichaPack({ p, config, unidades: inicial }: { p: ProductoDetalle; config: ConfigPublica; unidades: number }) {
  const [n, setN] = useState(inicial);
  const [elecciones, setElecciones] = useState<Eleccion[]>(Array.from({ length: 5 }, () => VACIA));
  const [aviso, setAviso] = useState<string | null>(null);
  const carrito = useCarrito();

  const sinColor = p.colores.length <= 1 && (p.colores[0]?.nombre ?? "Único") === "Único";
  const conTalle = p.variantes.some((v) => v.talle);
  const talles = useMemo(() => [...new Set(p.variantes.filter((v) => v.stock > 0 && v.talle).map((v) => v.talle!))].sort(compararTalles), [p.variantes]);
  const nombreColor = (clave: string | null) => p.colores.find((c) => c.clave === clave)?.nombre ?? "";

  const varianteDe = (e: Eleccion): VariantePublica | undefined =>
    p.variantes.find((v) => (!conTalle || v.talle === e.talle) && (sinColor || v.color === e.color));
  const elegidas = elecciones.slice(0, n);
  const variantes = elegidas.map(varianteDe);
  // Cuántas de cada SKU se piden: no más de las que hay.
  const pedidasDe = (sku: string, salvo: number) => elegidas.filter((e, i) => i !== salvo && varianteDe(e)?.sku === sku).length;

  const rebaja = p.descuento ?? 0;
  const pctDe = (k: number) => Math.max(rebaja, porcentajePack(config.packs, k));
  const base = (v: VariantePublica) => v.precioLista ?? v.precio;
  const unitario = (v: VariantePublica, k: number) => { const pct = pctDe(k); return pct ? conDescuento(centavos(base(v)), pct) : base(v); };
  const masBarata = p.variantes.filter((v) => v.stock > 0).sort((a, b) => base(a) - base(b))[0] ?? p.variantes[0]!;
  const completas = variantes.every((v) => !!v);
  const total = completas ? variantes.reduce((a, v) => a + unitario(v!, n), 0) : unitario(masBarata, n) * n;
  const sueltas = completas ? variantes.reduce((a, v) => a + v!.precio, 0) : masBarata.precio * n;

  function cambiarCantidad(k: number) {
    setN(k);
    setAviso(null);
    // La dirección acompaña a la cantidad (se puede compartir el pack de 4).
    window.history.replaceState(window.history.state, "", rutaPack(p.slug, k));
    document.title = document.title.replace(/Pack x\d/, `Pack x${k}`);
  }
  function elegir(i: number, cambio: Partial<Eleccion>) {
    setAviso(null);
    setElecciones((es) => es.map((e, j) => {
      if (j !== i) return e;
      const nueva = { ...e, ...cambio };
      // Otro talle: el color sigue sólo si hay en ese talle.
      if (cambio.talle !== undefined && nueva.color && !p.variantes.some((v) => v.talle === cambio.talle && v.color === nueva.color && v.stock > 0)) nueva.color = null;
      return nueva;
    }));
  }
  function agregar() {
    const falta = elegidas.findIndex((e) => !varianteDe(e));
    if (falta >= 0) { setAviso(`Elegí ${conTalle ? "talle" : ""}${conTalle && !sinColor ? " y " : ""}${sinColor ? "" : "color"} de la prenda ${falta + 1}.`); document.getElementById(`prenda-${falta + 1}`)?.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
    const foto = (v: VariantePublica) => p.colores.find((c) => c.clave === v.color)?.fotos[0] ?? p.exhibicion[0] ?? null;
    carrito.agregarVarias(variantes.map((v) => ({
      sku: v!.sku, nombre: p.nombre, slug: p.slug,
      color: sinColor ? null : nombreColor(v!.color), talle: v!.talle, precio: unitario(v!, n), foto: foto(v!)?.clave ?? null,
    })));
  }

  const fotos = [...p.exhibicion, ...p.colores.flatMap((c) => c.fotos)].filter((f, i, a) => a.findIndex((g) => g.clave === f.clave) === i).slice(0, 8);

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:gap-14">
      <section aria-label="Fotos" className="-mx-4 sm:mx-0">
        <ul className="flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 sm:px-0 lg:grid lg:grid-cols-2 lg:gap-3 lg:overflow-visible">
          {fotos.length ? fotos.map((f, i) => (
            <li key={f.clave} className={`aspect-[4/5] w-[85%] shrink-0 snap-center overflow-hidden rounded-[var(--radius-foto)] bg-fondo-suave sm:w-[60%] lg:w-auto ${i === 0 ? "lg:col-span-2" : ""}`}>
              <Foto foto={f} alt={p.nombre} sizes={i === 0 ? "(min-width:1024px) 50vw, 85vw" : "(min-width:1024px) 25vw, 85vw"} prioridad={i === 0} />
            </li>
          )) : <li className="aspect-[4/5] w-full overflow-hidden rounded-[var(--radius-foto)]"><SinFoto alt={p.nombre} /></li>}
        </ul>
      </section>

      <section aria-label="Armar el pack" className="lg:self-start">
        <p className="text-sm font-bold uppercase tracking-widest text-ahorro">📦 Pack · Llevá más, pagá menos</p>
        <h1 className="mt-1 text-[clamp(1.9rem,4vw,2.8rem)] leading-[1.05]">Pack x{n} {p.nombre}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <Link href={`/producto/${p.slug}`} className="text-tinta-tenue underline underline-offset-2 hover:text-tinta">Ver la prenda suelta</Link>
          <ResumenEstrellas promedio={p.resenas.promedio} cantidad={p.resenas.cantidad} />
        </div>

        <fieldset className="mt-6">
          <legend className="text-sm font-bold">¿Cuántas querés?</legend>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {CANTIDADES_PACK.map((k) => {
              const c = unitario(masBarata, k);
              return (
                <button key={k} type="button" onClick={() => cambiarCantidad(k)} aria-pressed={k === n}
                  className={`relative rounded-2xl border-2 p-3 text-left transition ${k === n ? "border-tinta bg-tinta text-white" : "border-linea hover:border-tinta"}`}>
                  {k === 5 && <span className={`absolute -top-2.5 right-2 rounded-full px-2 py-0.5 text-[11px] font-bold ${k === n ? "bg-ahorro text-white" : "bg-ahorro text-white"}`}>Más barato</span>}
                  <span className="block text-lg font-bold leading-tight">{k} unidades</span>
                  <span className="block text-sm">{formatearPesos(c)} c/u</span>
                  <span className={`block text-xs ${k === n ? "text-white/80" : "text-ahorro"}`}>{pctDe(k)}% OFF</span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <ol className="mt-6 space-y-3">
          {Array.from({ length: n }, (_, i) => {
            const e = elecciones[i]!;
            const v = varianteDe(e);
            const coloresDelTalle = p.colores.filter((c) => p.variantes.some((x) => x.color === c.clave && (!conTalle || x.talle === e.talle) && x.stock > 0));
            const lleno = (x?: VariantePublica) => !!x && pedidasDe(x.sku, i) >= x.stock;
            return (
              <li key={i} id={`prenda-${i + 1}`} className={`rounded-2xl border p-4 ${v ? "border-ahorro" : "border-linea"}`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-bold">Prenda {i + 1}</p>
                  {v ? <span className="text-sm font-bold text-ahorro">✓ {[!sinColor && nombreColor(v.color), v.talle].filter(Boolean).join(" · ")}</span>
                    : i > 0 && varianteDe(elecciones[i - 1]!) && (
                      <button type="button" onClick={() => elegir(i, { ...elecciones[i - 1]! })} className="text-sm text-marca underline underline-offset-2">Igual a la anterior</button>
                    )}
                </div>
                {conTalle && (
                  <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={`Talle de la prenda ${i + 1}`}>
                    {talles.map((t) => (
                      <button key={t} type="button" onClick={() => elegir(i, { talle: t })} aria-pressed={e.talle === t}
                        className={`min-w-11 rounded-full border px-3 py-1.5 text-sm font-bold ${e.talle === t ? "border-tinta bg-tinta text-white" : "border-linea hover:border-tinta"}`}>{t}</button>
                    ))}
                  </div>
                )}
                {!sinColor && (!conTalle || e.talle) && (
                  <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={`Color de la prenda ${i + 1}`}>
                    {coloresDelTalle.map((c) => {
                      const x = p.variantes.find((y) => y.color === c.clave && (!conTalle || y.talle === e.talle));
                      const sinMas = lleno(x) && e.color !== c.clave;
                      return (
                        <button key={c.clave} type="button" disabled={sinMas} onClick={() => elegir(i, { color: c.clave })} aria-pressed={e.color === c.clave}
                          aria-label={`${c.nombre}${sinMas ? " (no quedan más)" : ""}`} title={c.nombre}
                          className={`relative size-12 overflow-hidden rounded-xl border-2 disabled:opacity-40 ${e.color === c.clave ? "border-tinta" : "border-transparent hover:border-linea"}`}>
                          {c.fotos[0] ? <Foto foto={c.fotos[0]} alt="" sizes="48px" /> : <span className={`block size-full ${c.hex && esClaro(c.hex) ? "border border-linea" : ""}`} style={{ background: c.hex ?? "#ccc" }} />}
                        </button>
                      );
                    })}
                    {!coloresDelTalle.length && <p className="text-sm text-oferta">No hay colores en este talle.</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        <div className="mt-5 rounded-2xl bg-fondo-suave p-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-sm text-tinta-tenue">{completas ? "Total del pack" : "Desde"}</p>
              <p className="font-display text-3xl">{formatearPesos(total)}</p>
              {sueltas > total && <p className="text-sm text-tinta-tenue"><s>{formatearPesos(sueltas)}</s> sueltas · <b className="text-ahorro">ahorrás {formatearPesos(sueltas - total)}</b></p>}
            </div>
            {config.descuentoTransferencia > 0 && (
              <p className="text-right text-sm font-bold text-ahorro">{formatearPesos(conDescuento(centavos(total), config.descuentoTransferencia))}<br /><span className="font-normal">con transferencia</span></p>
            )}
          </div>
          <button type="button" onClick={agregar} className="boton mt-4 w-full bg-tinta py-4 text-base text-white hover:bg-marca-fuerte">
            Agregar pack x{n} al carrito
          </button>
          {aviso && <p className="mt-2 text-center text-sm font-bold text-oferta" role="alert">{aviso}</p>}
          <p className="mt-2 text-center text-xs text-tinta-tenue">El descuento se aplica solo en el carrito: vale aunque sumes unidades sueltas de esta prenda.</p>
        </div>
      </section>
    </div>
  );
}
