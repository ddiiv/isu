"use client";
import { useEffect, useMemo, useState } from "react";
import { compararTalles, esClaro, formatearPesos, type AjustePacks, type ProductoTarjeta } from "@isu/shared/puro";
import { TarjetaProducto } from "./TarjetaProducto";
import { evento, item } from "@/lib/ga";

/*
 * Grilla con filtros (talle, color, disponibilidad) y orden.
 *
 * Los productos de la categoría llegan TODOS en el HTML (Google los ve, la
 * página es estática): filtrar y ordenar es instantáneo porque no va al
 * servidor. El estado queda en la URL (?talle=M&color=negro&orden=precio)
 * para poder compartir el enlace, sin recargar.
 */
type Orden = "destacados" | "precio" | "precio-desc" | "nuevos";
const ORDENES: Array<[Orden, string]> = [["destacados", "Destacados"], ["precio", "Menor precio"], ["precio-desc", "Mayor precio"], ["nuevos", "Más nuevos"]];

export function Grilla({
  productos, lista, descuento, cuotas, filtros = true, packs, prioridad = true, presupuestos,
}: {
  productos: ProductoTarjeta[]; lista: string; descuento: number; cuotas: number; filtros?: boolean; packs?: AjustePacks;
  /** Topes de presupuesto (centavos) para ofrecer «Hasta $X» arriba de la grilla (ej.: Amigo invisible). Sólo salen los que filtran algo. */
  presupuestos?: number[];
  /** false en las grillas de abajo del pliegue: que no le peleen la red al banner (el LCP). */
  prioridad?: boolean;
}) {
  const [talles, setTalles] = useState<string[]>([]);
  const [colores, setColores] = useState<string[]>([]);
  const [orden, setOrden] = useState<Orden>("destacados");
  const [soloStock, setSoloStock] = useState(false);
  // Presupuesto elegido (centavos): el precio que se paga hoy no pasa de esto. null = sin tope.
  const [hasta, setHasta] = useState<number | null>(null);
  const [abierto, setAbierto] = useState(false);
  // La URL se escribe recién después de leerla (si no, el estado vacío inicial la borra).
  const [leido, setLeido] = useState(false);

  // Estado inicial desde la URL (después de hidratar: la página es estática).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const lista = (k: string) => (q.get(k) ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20);
    setTalles(lista("talle"));
    setColores(lista("color"));
    const o = q.get("orden") as Orden | null;
    if (o && ORDENES.some(([v]) => v === o)) setOrden(o);
    setSoloStock(q.get("stock") === "1");
    // En la URL va en pesos (?hasta=15000); sólo vale si es uno de los topes que ofrece la página.
    const h = Number(q.get("hasta")) * 100;
    if (presupuestos?.includes(h)) setHasta(h);
    setLeido(true);
  }, [presupuestos]);

  useEffect(() => {
    if (!filtros || !leido) return;
    const q = new URLSearchParams(window.location.search);
    const poner = (k: string, v: string) => (v ? q.set(k, v) : q.delete(k));
    poner("talle", talles.join(","));
    poner("color", colores.join(","));
    poner("orden", orden === "destacados" ? "" : orden);
    poner("stock", soloStock ? "1" : "");
    poner("hasta", hasta ? String(hasta / 100) : "");
    const s = q.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${s ? `?${s}` : ""}`);
  }, [talles, colores, orden, soloStock, hasta, filtros, leido]);

  const opciones = useMemo(() => {
    const t = new Set<string>();
    const c = new Map<string, { nombre: string; hex: string | null }>();
    for (const p of productos) {
      p.talles.forEach((x) => t.add(x));
      p.colores.forEach((x) => { if (x.hay && !c.has(x.clave)) c.set(x.clave, { nombre: x.nombre, hex: x.hex }); });
    }
    return { talles: [...t].sort(compararTalles), colores: [...c.entries()].sort((a, b) => a[1].nombre.localeCompare(b[1].nombre, "es")) };
  }, [productos]);

  const visibles = useMemo(() => {
    let r = productos.filter((p) =>
      (!soloStock || !p.agotado) &&
      (hasta === null || p.precio <= hasta) &&
      (!talles.length || talles.some((t) => p.talles.includes(t))) &&
      (!colores.length || p.colores.some((c) => c.hay && colores.includes(c.clave))),
    );
    if (orden === "precio") r = [...r].sort((a, b) => a.precio - b.precio);
    if (orden === "precio-desc") r = [...r].sort((a, b) => b.precio - a.precio);
    if (orden === "nuevos") r = [...r].sort((a, b) => b.creadoEn.localeCompare(a.creadoEn));
    return r;
  }, [productos, talles, colores, orden, soloStock, hasta]);

  // Los topes que de verdad filtran: dejan al menos una prenda y no las dejan a todas.
  const topes = useMemo(() => (presupuestos ?? []).filter((t) => { const n = productos.filter((p) => p.precio <= t).length; return n > 0 && n < productos.length; }), [presupuestos, productos]);

  useEffect(() => {
    if (!productos.length) return;
    evento("view_item_list", { item_list_name: lista, items: productos.slice(0, 20).map((p, i) => item(p, { index: i, item_list_name: lista })) });
  }, [productos, lista]);

  const alternar = (arr: string[], set: (v: string[]) => void, v: string) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const activos = talles.length + colores.length + (soloStock ? 1 : 0) + (hasta ? 1 : 0);
  const limpiar = () => { setTalles([]); setColores([]); setSoloStock(false); setHasta(null); };
  const chip = (activo: boolean) =>
    `rounded-full border px-3.5 py-1.5 text-sm transition ${activo ? "border-tinta bg-tinta text-white" : "border-linea hover:border-tinta"}`;

  return (
    <div>
      {filtros && (
        <div className="sticky top-29 z-30 -mx-4 border-b border-linea bg-white/95 px-4 py-3 sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0">
          {topes.length > 0 && (
            <div role="group" aria-label="Mi presupuesto" className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-sm font-bold">Mi presupuesto</span>
              {topes.map((t) => <button key={t} type="button" aria-pressed={hasta === t} onClick={() => setHasta(hasta === t ? null : t)} className={chip(hasta === t)}>Hasta {formatearPesos(t)}</button>)}
              {hasta !== null && <button type="button" onClick={() => setHasta(null)} className="text-sm font-bold text-marca underline">Ver todo</button>}
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <button type="button" onClick={() => setAbierto(!abierto)} aria-expanded={abierto} aria-controls="panel-filtros"
              className="inline-flex items-center gap-2 rounded-full border border-tinta px-4 py-2 text-sm font-bold">
              Filtrar{activos ? ` (${activos})` : ""}
            </button>
            <p className="text-sm text-tinta-tenue" aria-live="polite">{visibles.length} {visibles.length === 1 ? "prenda" : "prendas"}</p>
            <label className="flex items-center gap-2 text-sm">
              <span className="sr-only sm:not-sr-only">Ordenar</span>
              <select value={orden} onChange={(e) => setOrden(e.target.value as Orden)} className="rounded-full border border-linea bg-white px-3 py-2 font-bold">
                {ORDENES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </label>
          </div>
          <div id="panel-filtros" hidden={!abierto} className="mt-4 space-y-4 pb-1">
            {opciones.talles.length > 0 && (
              <fieldset>
                <legend className="mb-2 text-sm font-bold">Talle</legend>
                <div className="flex flex-wrap gap-2">
                  {opciones.talles.map((t) => (
                    <button key={t} type="button" aria-pressed={talles.includes(t)} onClick={() => alternar(talles, setTalles, t)} className={chip(talles.includes(t))}>{t}</button>
                  ))}
                </div>
              </fieldset>
            )}
            {opciones.colores.length > 0 && (
              <fieldset>
                <legend className="mb-2 text-sm font-bold">Color</legend>
                <div className="flex flex-wrap gap-2">
                  {opciones.colores.map(([clave, c]) => (
                    <button key={clave} type="button" aria-pressed={colores.includes(clave)} onClick={() => alternar(colores, setColores, clave)} className={`${chip(colores.includes(clave))} inline-flex items-center gap-2`}>
                      <span className={`size-3.5 rounded-full ${c.hex && esClaro(c.hex) ? "border border-linea" : ""}`} style={{ background: c.hex ?? "#bbb" }} />
                      {c.nombre}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}
            <div className="flex flex-wrap items-center gap-4">
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={soloStock} onChange={(e) => setSoloStock(e.target.checked)} className="size-4 accent-tinta" />
                Sólo con stock
              </label>
              {activos > 0 && (
                <button type="button" onClick={limpiar} className="text-sm font-bold text-marca underline">
                  Limpiar filtros
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {filtros && <h2 className="sr-only">Prendas</h2>}
      {visibles.length ? (
        <ul className="mt-6 grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-5 md:grid-cols-3 lg:grid-cols-4">
          {visibles.map((p, i) => (
            <li key={p.id}><TarjetaProducto p={p} descuento={descuento} cuotas={cuotas} lista={lista} indice={i} prioridad={prioridad && i < 2} packs={packs} /></li>
          ))}
        </ul>
      ) : (
        <div className="mt-10 rounded-[var(--radius-foto)] border border-dashed border-linea px-6 py-14 text-center">
          <p className="font-display text-2xl">No hay prendas con esos filtros</p>
          <button type="button" onClick={limpiar} className="boton-borde mt-5">Ver todo</button>
        </div>
      )}
    </div>
  );
}
