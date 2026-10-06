"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  cantidadesPack, centavos, compararTalles, conDescuento, esClaro, formatearPesos, PACK_TOPE, porcentajePack, rutaPack,
  type ConfigPublica, type ProductoDetalle, type VariantePublica,
} from "@isu/shared";
import { Foto, SinFoto } from "./Foto";
import { useCarrito } from "./carrito/Carrito";
import { ResumenEstrellas } from "./Estrellas";
import { BarraEnvioGratis } from "./BarraEnvioGratis";

/*
 * Página del pack: /producto/pack-x3-<slug>. No es un pack armado de Stocker:
 * es la prenda padre (por ejemplo CAIRO) vendida en cantidad. Se eligen
 * cuántas (del mínimo al máximo de Ajustes → Packs, 2 a 10 de fábrica) y,
 * para cada prenda, el talle y el color (primero el talle, después los
 * colores que hay en ese talle). Cambiar la cantidad cambia la dirección sin
 * recargar.
 *
 * Stock: no se ofrece una cantidad mayor a lo que hay entre todas las
 * variantes, y una variante deja de ofrecerse cuando las otras prendas del
 * pack ya se llevaron todas las que hay (el carrito lo vuelve a controlar).
 *
 * El precio que se muestra es el que va a calcular la API en el carrito
 * (mismo % y mismo redondeo): la rebaja de la prenda y el pack no se suman,
 * gana el mayor.
 */
interface Eleccion { talle: string | null; color: string | null }
const VACIA: Eleccion = { talle: null, color: null };

export function FichaPack({ p, config, unidades: inicial }: { p: ProductoDetalle; config: ConfigPublica; unidades: number }) {
  const cantidades = cantidadesPack(config.packs);
  // Lo que hay entre todas las variantes (la API manda hasta 10 por variante: alcanza para cualquier pack).
  const disponibles = p.variantes.reduce((a, v) => a + v.stock, 0);
  const tope = Math.min(config.packs.maximo, disponibles);
  const [n, setN] = useState(Math.max(config.packs.minimo, Math.min(inicial, tope)));
  const [elecciones, setElecciones] = useState<Eleccion[]>(Array.from({ length: PACK_TOPE }, () => VACIA));
  const [aviso, setAviso] = useState<string | null>(null);
  const carrito = useCarrito();
  const router = useRouter();

  const sinColor = p.colores.length <= 1 && (p.colores[0]?.nombre ?? "Único") === "Único";
  const conTalle = p.variantes.some((v) => v.talle);
  const talles = useMemo(() => [...new Set(p.variantes.filter((v) => v.stock > 0 && v.talle).map((v) => v.talle!))].sort(compararTalles), [p.variantes]);
  const nombreColor = (clave: string | null) => p.colores.find((c) => c.clave === clave)?.nombre ?? "";

  const varianteDe = (e: Eleccion): VariantePublica | undefined =>
    p.variantes.find((v) => (!conTalle || v.talle === e.talle) && (sinColor || v.color === e.color));
  const elegidas = elecciones.slice(0, n);
  const variantes = elegidas.map(varianteDe);
  // Cuántas de cada SKU se llevan las otras prendas del pack: no más de las que hay.
  const pedidasDe = (sku: string, salvo: number) => elegidas.filter((e, i) => i !== salvo && varianteDe(e)?.sku === sku).length;
  const quedaPara = (v: VariantePublica | undefined, i: number) => !!v && v.stock > 0 && pedidasDe(v.sku, i) < v.stock;

  const rebaja = p.descuento ?? 0;
  const pctDe = (k: number) => Math.max(rebaja, porcentajePack(config.packs, k));
  const base = (v: VariantePublica) => v.precioLista ?? v.precio;
  const unitario = (v: VariantePublica, k: number) => { const pct = pctDe(k); return pct ? conDescuento(centavos(base(v)), pct) : base(v); };
  const masBarata = p.variantes.filter((v) => v.stock > 0).sort((a, b) => base(a) - base(b))[0] ?? p.variantes[0]!;
  const completas = variantes.every((v) => !!v);
  const total = completas ? variantes.reduce((a, v) => a + unitario(v!, n), 0) : unitario(masBarata, n) * n;
  const sueltas = completas ? variantes.reduce((a, v) => a + v!.precio, 0) : masBarata.precio * n;

  // La dirección acompaña a la cantidad (se puede compartir el pack de 4). Si pidieron más de lo que hay, queda la que se puede.
  useEffect(() => {
    const ruta = rutaPack(p.slug, n);
    if (window.location.pathname !== ruta) window.history.replaceState(window.history.state, "", ruta);
    document.title = document.title.replace(/Pack x\d+/, `Pack x${n}`);
  }, [n, p.slug]);

  function cambiarCantidad(k: number) {
    if (k > tope) return;
    setN(k);
    setAviso(null);
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
  /** La prenda 1 en todas las vacías, mientras haya stock de esa variante. */
  function copiarATodas() {
    const primera = varianteDe(elecciones[0]!);
    if (!primera) { setAviso("Primero elegí la prenda 1."); return; }
    let usadas = elegidas.filter((e) => varianteDe(e)?.sku === primera.sku).length;
    let faltaron = 0;
    // Se arma acá y no dentro de setElecciones: React corre ese actualizador más tarde y el aviso contaría 0.
    const nuevas = elecciones.map((e, j) => {
      if (j === 0 || j >= n || varianteDe(e)) return e;
      if (usadas < primera.stock) { usadas++; return { ...elecciones[0]! }; }
      faltaron++;
      return e;
    });
    setElecciones(nuevas);
    setAviso(faltaron ? `No alcanzan para todas: quedan ${faltaron} por elegir con otro talle o color.` : null);
  }
  function agregar(comprarYa = false) {
    const falta = elegidas.findIndex((e) => !varianteDe(e));
    if (falta >= 0) { setAviso(`Elegí ${conTalle ? "talle" : ""}${conTalle && !sinColor ? " y " : ""}${sinColor ? "" : "color"} de la prenda ${falta + 1}.`); document.getElementById(`prenda-${falta + 1}`)?.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
    const foto = (v: VariantePublica) => p.colores.find((c) => c.clave === v.color)?.fotos[0] ?? p.exhibicion[0] ?? null;
    // Va como UN pack (aparte de las sueltas de esta prenda): las prendas iguales se agrupan.
    const prendas = new Map<string, { sku: string; cantidad: number; color: string | null; talle: string | null; foto: string | null }>();
    for (const v of variantes) {
      const ya = prendas.get(v!.sku);
      if (ya) ya.cantidad++;
      else prendas.set(v!.sku, { sku: v!.sku, cantidad: 1, color: sinColor ? null : nombreColor(v!.color), talle: v!.talle, foto: foto(v!)?.clave ?? null });
    }
    carrito.agregarPack({ slug: p.slug, nombre: p.nombre, foto: (p.exhibicion[0] ?? foto(variantes[0]!))?.clave ?? null, precio: total, prendas: [...prendas.values()] }, { abrir: !comprarYa });
    if (comprarYa) router.push("/checkout");
  }

  const fotos = [...p.exhibicion, ...p.colores.flatMap((c) => c.fotos)].filter((f, i, a) => a.findIndex((g) => g.clave === f.clave) === i).slice(0, 8);
  const sinStockParaPack = disponibles < config.packs.minimo;

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

        {sinStockParaPack ? (
          <p className="mt-6 rounded-2xl bg-fondo-suave p-4" role="status">No hay stock para armar un pack de esta prenda ahora. <Link href={`/producto/${p.slug}`} className="font-bold underline">Mirá la prenda suelta</Link>.</p>
        ) : (
          <>
            <fieldset className="mt-6">
              <legend className="text-sm font-bold">¿Cuántas querés? <span className="font-normal text-tinta-tenue">De {config.packs.minimo} a {config.packs.maximo}, con tus talles y colores</span></legend>
              <div className="mt-2 grid grid-cols-5 gap-1.5 sm:gap-2">
                {cantidades.map((k) => {
                  const sinStock = k > tope;
                  return (
                    <button key={k} type="button" onClick={() => cambiarCantidad(k)} aria-pressed={k === n} disabled={sinStock}
                      aria-label={`${k} unidades, ${pctDe(k)}% OFF${sinStock ? " (no hay stock para tantas)" : ""}`}
                      className={`relative rounded-xl border-2 px-1 py-2 text-center transition disabled:cursor-not-allowed disabled:opacity-35 ${k === n ? "border-tinta bg-tinta text-white" : "border-linea hover:border-tinta"}`}>
                      {k === config.packs.maximo && !sinStock && <span className="absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-ahorro px-1.5 text-[10px] font-bold leading-4 text-white">+ barato</span>}
                      <span className="block text-base font-bold leading-tight">x{k}</span>
                      <span className={`block text-[11px] font-bold ${k === n ? "text-white/85" : "text-ahorro"}`}>-{pctDe(k)}%</span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-sm"><b>{n} unidades</b> · {formatearPesos(unitario(masBarata, n))} c/u · <b className="text-ahorro">{pctDe(n)}% OFF</b>{tope < config.packs.maximo && <span className="text-tinta-tenue"> · hay stock para {tope} como máximo</span>}</p>
            </fieldset>

            <div className="mt-6 flex items-center justify-between gap-3">
              <p className="text-sm font-bold">Elegí cada prenda</p>
              {n > 1 && varianteDe(elecciones[0]!) && elegidas.slice(1).some((e) => !varianteDe(e)) && (
                <button type="button" onClick={copiarATodas} className="text-sm text-marca underline underline-offset-2">Copiar la prenda 1 a todas</button>
              )}
            </div>
            <ol className="mt-2 space-y-3">
              {Array.from({ length: n }, (_, i) => {
                const e = elecciones[i]!;
                const v = varianteDe(e);
                const coloresDelTalle = p.colores.filter((c) => p.variantes.some((x) => x.color === c.clave && (!conTalle || x.talle === e.talle) && x.stock > 0));
                const anterior = i > 0 ? varianteDe(elecciones[i - 1]!) : undefined;
                return (
                  <li key={i} id={`prenda-${i + 1}`} className={`rounded-2xl border p-4 ${v ? "border-ahorro" : "border-linea"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-bold">Prenda {i + 1}</p>
                      {v ? <span className="text-sm font-bold text-ahorro">✓ {[!sinColor && nombreColor(v.color), v.talle].filter(Boolean).join(" · ")}</span>
                        : anterior && (quedaPara(anterior, i)
                          ? <button type="button" onClick={() => elegir(i, { ...elecciones[i - 1]! })} className="text-sm text-marca underline underline-offset-2">Igual a la anterior</button>
                          : <span className="text-xs text-tinta-tenue">No quedan más iguales a la anterior</span>)}
                    </div>
                    {conTalle && (
                      <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={`Talle de la prenda ${i + 1}`}>
                        {talles.map((t) => {
                          // Un talle se apaga si las otras prendas ya se llevaron todo lo que hay de él.
                          const agotado = e.talle !== t && !p.variantes.some((x) => x.talle === t && quedaPara(x, i));
                          return (
                            <button key={t} type="button" onClick={() => elegir(i, { talle: t })} aria-pressed={e.talle === t} disabled={agotado}
                              aria-label={`${t}${agotado ? " (no quedan más)" : ""}`}
                              className={`min-w-11 rounded-full border px-3 py-1.5 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-35 disabled:line-through ${e.talle === t ? "border-tinta bg-tinta text-white" : "border-linea hover:border-tinta"}`}>{t}</button>
                          );
                        })}
                      </div>
                    )}
                    {!sinColor && (!conTalle || e.talle) && (
                      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={`Color de la prenda ${i + 1}`}>
                        {coloresDelTalle.map((c) => {
                          const x = p.variantes.find((y) => y.color === c.clave && (!conTalle || y.talle === e.talle));
                          const sinMas = !quedaPara(x, i) && e.color !== c.clave;
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
              <button type="button" onClick={() => agregar()} className="boton mt-4 w-full bg-tinta py-4 text-base text-white hover:bg-marca-fuerte">
                Agregar pack x{n} al carrito
              </button>
              <button type="button" onClick={() => agregar(true)} className="boton mt-2 w-full border-2 border-tinta bg-white py-3.5 text-base hover:bg-tinta hover:text-white">
                Comprar ahora
              </button>
              {aviso && <p className="mt-2 text-center text-sm font-bold text-oferta" role="alert">{aviso}</p>}
              <p className="mt-2 text-center text-xs text-tinta-tenue">El pack va aparte en el carrito: las prendas sueltas van a su precio.</p>
            </div>
            <BarraEnvioGratis desde={config.envioGratisDesde} className="mt-4" />
          </>
        )}
      </section>
    </div>
  );
}
