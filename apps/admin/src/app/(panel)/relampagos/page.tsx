"use client";
import { useState } from "react";
import { api, fecha, pesos, useDatos } from "@/lib/api";
import type { FilaProducto } from "@/lib/catalogo";
import { Boton, Campo, Cargando, Casilla, claseEntrada, Insignia, Mensaje, Tarjeta, Titulo, useAviso } from "@/components/ui";
import { puede, useYo } from "@/components/Marco";

/*
 * Relámpagos: descuentos por tiempo limitado (24 o 48 h como máximo), aparte de los descuentos normales.
 * Se programan por adelantado: hasta que llega el inicio no se ven en la tienda. El mayorista es el piso
 * (la rebaja nunca lo baja) y es un dato interno: sólo se muestra acá, nunca en la tienda.
 */
interface Producto { id: number; nombre: string; precio: number | null; precioFinal: number | null; mayorista: number | null; margenSobrePiso: number | null }
interface Relampago { id: number; nombre: string; porcentaje: number; productoIds: number[]; desde: string; hasta: string; activo: boolean; estado: "programado" | "en_curso" | "terminado" | "desactivado"; productos: Producto[] }
interface Sugerencia { id: number; nombre: string; sku: string | null; stock: number; descuentoMaximo: number; porcentaje: number; precio: number; precioFinal: number; margenSobrePiso: number }
interface Form { id?: number; nombre: string; porcentaje: number; productoIds: number[]; desde: string; hasta: string; activo: boolean }

const HORA = 3_600_000;
// <input type="datetime-local"> trabaja en hora local, sin zona.
const aLocal = (ms: number) => new Date(ms - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const aMs = (v: string) => (v ? new Date(v).getTime() : Date.now());
const ESTADO: Record<Relampago["estado"], [string, string]> = {
  programado: ["Programado", "bg-fondo-suave text-tinta"], en_curso: ["En curso", "bg-ahorro-claro text-ahorro"],
  terminado: ["Terminado", ""], desactivado: ["Desactivado", ""],
};
const cuenta = (r: Relampago) => {
  const h = (ms: number) => { const m = Math.max(0, Math.round(ms / 60000)); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };
  return r.estado === "programado" ? `empieza en ${h(Date.parse(r.desde) - Date.now())}` : r.estado === "en_curso" ? `termina en ${h(Date.parse(r.hasta) - Date.now())}` : "";
};
const vacio = (): Form => { const d = Date.now(); return { nombre: "", porcentaje: 20, productoIds: [], desde: aLocal(d), hasta: aLocal(d + 24 * HORA), activo: true }; };

export default function Relampagos() {
  const yo = useYo();
  const operador = puede(yo, "operador");
  const { datos, error, recargar } = useDatos<{ relampagos: Relampago[] }>("relampagos");
  const { datos: sug, recargar: recargarSug } = useDatos<{ sugerencias: Sugerencia[] }>("relampagos/sugerencias");
  const [f, setF] = useState<Form | null>(null);
  const [q, setQ] = useState("");
  const [encontrados, setEncontrados] = useState<FilaProducto[]>([]);
  const [nombresProd, setNombresProd] = useState<Record<number, string>>({});
  const [elegidas, setElegidas] = useState<Set<number>>(new Set());
  const [prog, setProg] = useState({ desde: aLocal(Date.now()), horas: 24 });
  const aviso = useAviso();
  if (error) return <Mensaje>{error}</Mensaje>;
  if (!datos) return <Cargando />;

  const cuerpo = (x: Form) => ({ nombre: x.nombre, porcentaje: x.porcentaje, productoIds: x.productoIds, desde: new Date(x.desde).toISOString(), hasta: new Date(x.hasta).toISOString(), activo: x.activo });
  async function guardar() {
    if (!f) return;
    try {
      if (f.id) await api(`relampagos/${f.id}`, { metodo: "PUT", cuerpo: cuerpo(f) }); else await api("relampagos", { cuerpo: cuerpo(f) });
      aviso.ok("Relámpago guardado."); setF(null); await Promise.all([recargar(), recargarSug()]);
    } catch (e) { aviso.error(e); }
  }
  async function programar() {
    const elegidasLista = (sug?.sugerencias ?? []).filter((s) => elegidas.has(s.id));
    const desde = aMs(prog.desde), hasta = desde + prog.horas * HORA;
    const grupos = new Map<number, Sugerencia[]>();
    for (const s of elegidasLista) grupos.set(s.porcentaje, [...(grupos.get(s.porcentaje) ?? []), s]);
    try {
      for (const [porcentaje, ps] of grupos) {
        await api("relampagos", { cuerpo: { nombre: `Relámpago ${porcentaje}%`, porcentaje, productoIds: ps.map((p) => p.id), desde: new Date(desde).toISOString(), hasta: new Date(hasta).toISOString() } });
      }
      aviso.ok(`${grupos.size} ${grupos.size === 1 ? "relámpago programado" : "relámpagos programados"}.`); setElegidas(new Set()); await Promise.all([recargar(), recargarSug()]);
    } catch (e) { aviso.error(e); }
  }
  async function buscar() {
    try { setEncontrados((await api<{ productos: FilaProducto[] }>("productos", { query: { q, filtro: "visibles" } })).productos.slice(0, 20)); } catch (e) { aviso.error(e); }
  }
  const duracion = f ? Math.round((aMs(f.hasta) - aMs(f.desde)) / HORA * 10) / 10 : 0;
  const sugerencias = sug?.sugerencias ?? [];

  return (
    <>
      <Titulo acciones={operador && <Boton onClick={() => setF(vacio())}>Nuevo relámpago</Boton>}>Relámpagos</Titulo>
      <div className="mb-4"><aviso.Aviso /></div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-6">
          <Tarjeta>
            <ul className="divide-y divide-linea">
              {datos.relampagos.map((r) => (
                <li key={r.id} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span><span className="font-bold">{r.nombre}</span> <Insignia clase="bg-oferta text-white">-{r.porcentaje}%</Insignia> <Insignia clase={ESTADO[r.estado][1]}>{ESTADO[r.estado][0]}</Insignia>
                      <br /><span className="text-xs text-tinta-tenue">desde {fecha(r.desde)} · hasta {fecha(r.hasta)}{cuenta(r) && ` · ${cuenta(r)}`}</span></span>
                    {operador && <span className="flex flex-wrap gap-2">
                      <Boton variante="texto" onClick={() => setF({ id: r.id, nombre: r.nombre, porcentaje: r.porcentaje, productoIds: r.productoIds, desde: aLocal(Date.parse(r.desde)), hasta: aLocal(Date.parse(r.hasta)), activo: r.activo })}>Editar</Boton>
                      <Boton variante="texto" onClick={() => { const d = Date.now(); setNombresProd(Object.fromEntries(r.productos.map((p) => [p.id, p.nombre]))); setF({ nombre: r.nombre, porcentaje: r.porcentaje, productoIds: r.productoIds, desde: aLocal(d), hasta: aLocal(d + (Date.parse(r.hasta) - Date.parse(r.desde))), activo: true }); }}>Duplicar</Boton>
                      {r.activo && r.estado !== "terminado" && <Boton variante="texto" className="text-oferta" onClick={() => confirm(`¿Desactivar "${r.nombre}"?`) && void api(`relampagos/${r.id}`, { metodo: "PUT", cuerpo: { ...cuerpo({ ...r, desde: aLocal(Date.parse(r.desde)), hasta: aLocal(Date.parse(r.hasta)) }), activo: false } }).then(() => Promise.all([recargar(), recargarSug()]), aviso.error)}>Desactivar</Boton>}
                    </span>}
                  </div>
                  <table className="mt-2 w-full text-xs text-tinta-suave">
                    <thead><tr className="text-left text-tinta-tenue"><th className="font-normal">Producto</th><th className="font-normal">Precio</th><th className="font-normal">Final</th><th className="font-normal">Mayorista (piso)</th><th className="font-normal">Sobre el piso</th></tr></thead>
                    <tbody>{r.productos.map((p) => <tr key={p.id}><td>{p.nombre}</td><td>{pesos(p.precio)}</td><td className="font-bold">{pesos(p.precioFinal)}</td><td>{pesos(p.mayorista)}</td><td>{pesos(p.margenSobrePiso)}</td></tr>)}</tbody>
                  </table>
                </li>
              ))}
              {!datos.relampagos.length && <li className="py-8 text-center text-tinta-tenue">No hay relámpagos.</li>}
            </ul>
          </Tarjeta>
          {operador && (
            <Tarjeta titulo="Sugerencias" acciones={<Boton disabled={!elegidas.size} onClick={() => void programar()}>Programar seleccionados</Boton>}>
              <p className="mb-3 text-xs text-tinta-tenue">Productos visibles, con stock, sin otro descuento vigente o programado y con mayorista en todas sus variantes con stock. El % es el 80 % del máximo que permite el piso. Se agrupan por % (un relámpago cada uno) y nada se publica hasta que los programes.</p>
              <div className="mb-3 grid grid-cols-2 gap-3">
                <Campo etiqueta="Inicio"><input type="datetime-local" className={claseEntrada} value={prog.desde} onChange={(e) => setProg({ ...prog, desde: e.target.value })} /></Campo>
                <Campo etiqueta="Duración"><select className={claseEntrada} value={prog.horas} onChange={(e) => setProg({ ...prog, horas: Number(e.target.value) })}><option value={24}>24 horas</option><option value={48}>48 horas</option></select></Campo>
              </div>
              <ul className="divide-y divide-linea text-sm">
                {sugerencias.map((s) => (
                  <li key={s.id} className="py-2"><Casilla marcada={elegidas.has(s.id)} onChange={(v) => setElegidas((e) => { const n = new Set(e); if (v) n.add(s.id); else n.delete(s.id); return n; })}
                    etiqueta={<span className="font-normal"><b>{s.nombre}</b> <span className="text-xs text-tinta-tenue">{s.sku} · stock {s.stock}</span><br />
                      <span className="text-xs text-tinta-suave">-{s.porcentaje}% (máx. {s.descuentoMaximo}%) · {pesos(s.precio)} → <b>{pesos(s.precioFinal)}</b> · sobre el piso {pesos(s.margenSobrePiso)}</span></span>} /></li>
                ))}
                {!sugerencias.length && <li className="py-6 text-center text-tinta-tenue">No hay productos para sugerir.</li>}
              </ul>
            </Tarjeta>
          )}
        </div>
        {f && (
          <Tarjeta titulo={f.id ? "Editar relámpago" : "Nuevo relámpago"}>
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void guardar(); }}>
              <Campo etiqueta="Nombre" ayuda="Para vos (ej.: Viernes buzos)."><input required maxLength={80} className={claseEntrada} value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></Campo>
              <Campo etiqueta="Porcentaje"><input type="number" required min={1} max={90} className={`${claseEntrada} w-28`} value={f.porcentaje} onChange={(e) => setF({ ...f, porcentaje: Math.max(1, Math.min(90, Number(e.target.value) || 1)) })} /></Campo>
              <div className="space-y-2 rounded-xl border border-linea p-3">
                <div className="flex gap-2"><input className={claseEntrada} placeholder="Buscar producto" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void buscar(); } }} /><Boton variante="borde" onClick={() => void buscar()}>Buscar</Boton></div>
                <ul className="max-h-40 overflow-y-auto text-sm">{encontrados.map((p) => (
                  <li key={p.id}><Casilla etiqueta={<span className="font-normal">{p.nombre} <span className="text-xs text-tinta-tenue">{p.sku}</span></span>} marcada={f.productoIds.includes(p.id)}
                    onChange={(v) => { setNombresProd((n) => ({ ...n, [p.id]: p.nombre })); setF({ ...f, productoIds: v ? [...f.productoIds, p.id] : f.productoIds.filter((x) => x !== p.id) }); }} /></li>
                ))}</ul>
                <p className="text-xs text-tinta-tenue">Elegidos: {f.productoIds.length ? f.productoIds.map((id) => nombresProd[id] ?? datos.relampagos.flatMap((r) => r.productos).find((p) => p.id === id)?.nombre ?? `#${id}`).join(", ") : "ninguno"}</p>
              </div>
              <Campo etiqueta="Inicio" ayuda="Si es a futuro queda programado: no se ve en la tienda hasta entonces."><input type="datetime-local" required className={claseEntrada} value={f.desde} onChange={(e) => setF({ ...f, desde: e.target.value })} /></Campo>
              <div className="flex gap-2">{[24, 48].map((h) => <Boton key={h} variante="borde" onClick={() => setF({ ...f, hasta: aLocal(aMs(f.desde) + h * HORA) })}>{h} horas</Boton>)}</div>
              <Campo etiqueta="Fin" ayuda={`Dura ${duracion} h (máximo 48).`} error={duracion <= 0 || duracion > 48 ? "Tiene que durar entre más de 0 y 48 horas." : null}><input type="datetime-local" required className={claseEntrada} value={f.hasta} onChange={(e) => setF({ ...f, hasta: e.target.value })} /></Campo>
              <Casilla etiqueta="Activo" marcada={f.activo} onChange={(v) => setF({ ...f, activo: v })} />
              <div className="flex gap-2"><Boton type="submit" disabled={!f.productoIds.length || duracion <= 0 || duracion > 48}>Guardar</Boton><Boton variante="borde" onClick={() => setF(null)}>Cancelar</Boton></div>
            </form>
          </Tarjeta>
        )}
      </div>
    </>
  );
}
