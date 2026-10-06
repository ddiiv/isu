"use client";
import { useEffect, useMemo, useState } from "react";
import { compararTalles, esClaro, type AjustePacks, type ProductoTarjeta } from "@isu/shared";
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
  productos, lista, descuento, cuotas, filtros = true, packs,
}: { productos: ProductoTarjeta[]; lista: string; descuento: number; cuotas: number; filtros?: boolean; packs?: AjustePacks }) {
  const [talles, setTalles] = useState<string[]>([]);
  const [colores, setColores] = useState<string[]>([]);
  const [orden, setOrden] = useState<Orden>("destacados");
  const [soloStock, setSoloStock] = useState(false);
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
    setLeido(true);
  }, []);

  useEffect(() => {
    if (!filtros || !leido) return;
    const q = new URLSearchParams(window.location.search);
    const poner = (k: string, v: string) => (v ? q.set(k, v) : q.delete(k));
    poner("talle", talles.join(","));
    poner("color", colores.join(","));
    poner("orden", orden === "destacados" ? "" : orden);
    poner("stock", soloStock ? "1" : "");
    const s = q.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${s ? `?${s}` : ""}`);
  }, [talles, colores, orden, soloStock, filtros, leido]);

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
      (!talles.length || talles.some((t) => p.talles.includes(t))) &&
      (!colores.length || p.colores.some((c) => c.hay && colores.includes(c.clave))),
    );
    if (orden === "precio") r = [...r].sort((a, b) => a.precio - b.precio);
    if (orden === "precio-desc") r = [...r].sort((a, b) => b.precio - a.precio);
    if (orden === "nuevos") r = [...r].sort((a, b) => b.creadoEn.localeCompare(a.creadoEn));
    return r;
  }, [productos, talles, colores, orden, soloStock]);

  useEffect(() => {
    if (!productos.length) return;
    evento("view_item_list", { item_list_name: lista, items: productos.slice(0, 20).map((p, i) => item(p, { index: i, item_list_name: lista })) });
  }, [productos, lista]);

  const alternar = (arr: string[], set: (v: string[]) => void, v: string) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const activos = talles.length + colores.length + (soloStock ? 1 : 0);
  const chip = (activo: boolean) =>
    `rounded-full border px-3.5 py-1.5 text-sm transition ${activo ? "border-tinta bg-tinta text-white" : "border-linea hover:border-tinta"}`;

  return (
    <div>
      {filtros && (
        <div className="sticky top-16 z-30 -mx-4 border-b border-linea bg-white/95 px-4 py-3 sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0">
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
                <button type="button" onClick={() => { setTalles([]); setColores([]); setSoloStock(false); }} className="text-sm font-bold text-marca underline">
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
            <li key={p.id}><TarjetaProducto p={p} descuento={descuento} cuotas={cuotas} lista={lista} indice={i} prioridad={i < 2} packs={packs} /></li>
          ))}
        </ul>
      ) : (
        <div className="mt-10 rounded-[var(--radius-foto)] border border-dashed border-linea px-6 py-14 text-center">
          <p className="font-display text-2xl">No hay prendas con esos filtros</p>
          <button type="button" onClick={() => { setTalles([]); setColores([]); setSoloStock(false); }} className="boton-borde mt-5">Ver todo</button>
        </div>
      )}
    </div>
  );
}
