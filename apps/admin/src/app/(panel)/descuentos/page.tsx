"use client";
import { useState } from "react";
import { api, fecha, useDatos } from "@/lib/api";
import { nombresCategorias, type Categoria, type FilaProducto } from "@/lib/catalogo";
import { Boton, Campo, Cargando, Casilla, claseEntrada, Insignia, Mensaje, Tarjeta, Titulo, useAviso } from "@/components/ui";
import { puede, useYo } from "@/components/Marco";

/*
 * Descuentos masivos sobre el precio de Stocker: a todo, a categorías o a
 * productos, con fechas opcionales. Si a un producto le tocan varios, gana
 * el mayor. El de transferencia se suma aparte, sobre el precio rebajado.
 */
interface Descuento { id?: number; nombre: string; porcentaje: number; alcance: "todo" | "categorias" | "productos"; categoriaIds: number[]; productoIds: number[]; desde: string | null; hasta: string | null; activo: boolean; vigente?: boolean; creadoPor?: string }
const vacio: Descuento = { nombre: "", porcentaje: 10, alcance: "todo", categoriaIds: [], productoIds: [], desde: null, hasta: null, activo: true };
// <input type="datetime-local"> trabaja en hora local, sin zona.
const aLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");
const deLocal = (v: string) => (v ? new Date(v).toISOString() : null);

export default function Descuentos() {
  const yo = useYo();
  const operador = puede(yo, "operador");
  const { datos, error, recargar } = useDatos<{ descuentos: Descuento[] }>("descuentos");
  const { datos: cats } = useDatos<{ categorias: Categoria[] }>("categorias");
  const [f, setF] = useState<Descuento | null>(null);
  const [q, setQ] = useState("");
  const [encontrados, setEncontrados] = useState<FilaProducto[]>([]);
  const [nombresProd, setNombresProd] = useState<Record<number, string>>({});
  const aviso = useAviso();
  const nombres = nombresCategorias(cats?.categorias ?? []);
  if (error) return <Mensaje>{error}</Mensaje>;
  if (!datos) return <Cargando />;

  async function guardar() {
    if (!f) return;
    const { id, vigente: _v, creadoPor: _c, ...cuerpo } = f;
    try {
      if (id) await api(`descuentos/${id}`, { metodo: "PUT", cuerpo }); else await api("descuentos", { cuerpo });
      aviso.ok("Descuento guardado. Los precios de la tienda se actualizan en unos segundos."); setF(null); await recargar();
    } catch (e) { aviso.error(e); }
  }
  async function buscar() {
    try { setEncontrados((await api<{ productos: FilaProducto[] }>("productos", { query: { q, filtro: "visibles" } })).productos.slice(0, 20)); } catch (e) { aviso.error(e); }
  }
  const alcance = (d: Descuento) => d.alcance === "todo" ? "Toda la tienda" : d.alcance === "categorias" ? d.categoriaIds.map((c) => nombres.get(c) ?? `#${c}`).join(", ") : `${d.productoIds.length} productos`;

  return (
    <>
      <Titulo acciones={operador && <Boton onClick={() => setF({ ...vacio })}>Nuevo descuento</Boton>}>Descuentos</Titulo>
      <div className="mb-4"><aviso.Aviso /></div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <Tarjeta>
          <ul className="divide-y divide-linea">
            {datos.descuentos.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <span><span className="font-bold">{d.nombre}</span> <Insignia clase="bg-oferta text-white">-{d.porcentaje}%</Insignia> {d.vigente ? <Insignia clase="bg-ahorro-claro text-ahorro">Vigente</Insignia> : <Insignia>{d.activo ? "Fuera de fecha" : "Pausado"}</Insignia>}
                  <br /><span className="text-xs text-tinta-tenue">{alcance(d)} · {d.desde ? `desde ${fecha(d.desde)}` : "desde ya"} · {d.hasta ? `hasta ${fecha(d.hasta)}` : "sin fin"}</span></span>
                {operador && <span className="flex flex-wrap gap-2">
                  <Boton variante="texto" onClick={() => setF({ ...d })}>Editar</Boton>
                  <Boton variante="texto" className="text-oferta" onClick={() => confirm(`¿Borrar "${d.nombre}"?`) && void api(`descuentos/${d.id}`, { metodo: "DELETE" }).then(recargar, aviso.error)}>Borrar</Boton>
                </span>}
              </li>
            ))}
            {!datos.descuentos.length && <li className="py-8 text-center text-tinta-tenue">No hay descuentos.</li>}
          </ul>
        </Tarjeta>
        {f && (
          <Tarjeta titulo={f.id ? "Editar descuento" : "Nuevo descuento"}>
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void guardar(); }}>
              <Campo etiqueta="Nombre" ayuda="Para vos (ej.: Hot Sale buzos)."><input required maxLength={80} className={claseEntrada} value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></Campo>
              <Campo etiqueta="Porcentaje"><input type="number" required min={1} max={90} className={`${claseEntrada} w-28`} value={f.porcentaje} onChange={(e) => setF({ ...f, porcentaje: Math.max(1, Math.min(90, Number(e.target.value) || 1)) })} /></Campo>
              <Campo etiqueta="Se aplica a">
                <select className={claseEntrada} value={f.alcance} onChange={(e) => setF({ ...f, alcance: e.target.value as Descuento["alcance"] })}>
                  <option value="todo">Toda la tienda</option><option value="categorias">Categorías</option><option value="productos">Productos elegidos</option>
                </select>
              </Campo>
              {f.alcance === "categorias" && (
                <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-linea p-3">
                  {(cats?.categorias ?? []).map((c) => <Casilla key={c.id} etiqueta={<span className="font-normal">{nombres.get(c.id)}</span>} marcada={f.categoriaIds.includes(c.id)} onChange={(v) => setF({ ...f, categoriaIds: v ? [...f.categoriaIds, c.id] : f.categoriaIds.filter((x) => x !== c.id) })} />)}
                  <p className="text-xs text-tinta-tenue">Una categoría principal incluye sus subcategorías.</p>
                </div>
              )}
              {f.alcance === "productos" && (
                <div className="space-y-2 rounded-xl border border-linea p-3">
                  <div className="flex gap-2"><input className={claseEntrada} placeholder="Buscar producto" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void buscar(); } }} /><Boton variante="borde" onClick={() => void buscar()}>Buscar</Boton></div>
                  <ul className="max-h-40 overflow-y-auto text-sm">{encontrados.map((p) => (
                    <li key={p.id}><Casilla etiqueta={<span className="font-normal">{p.nombre} <span className="text-xs text-tinta-tenue">{p.sku}</span></span>} marcada={f.productoIds.includes(p.id)}
                      onChange={(v) => { setNombresProd((n) => ({ ...n, [p.id]: p.nombre })); setF({ ...f, productoIds: v ? [...f.productoIds, p.id] : f.productoIds.filter((x) => x !== p.id) }); }} /></li>
                  ))}</ul>
                  <p className="text-xs text-tinta-tenue">Elegidos: {f.productoIds.length ? f.productoIds.map((id) => nombresProd[id] ?? `#${id}`).join(", ") : "ninguno"}</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Campo etiqueta="Desde"><input type="datetime-local" className={claseEntrada} value={aLocal(f.desde)} onChange={(e) => setF({ ...f, desde: deLocal(e.target.value) })} /></Campo>
                <Campo etiqueta="Hasta"><input type="datetime-local" className={claseEntrada} value={aLocal(f.hasta)} onChange={(e) => setF({ ...f, hasta: deLocal(e.target.value) })} /></Campo>
              </div>
              <Casilla etiqueta="Activo" marcada={f.activo} onChange={(v) => setF({ ...f, activo: v })} />
              <div className="flex gap-2"><Boton type="submit">Guardar</Boton><Boton variante="borde" onClick={() => setF(null)}>Cancelar</Boton></div>
            </form>
          </Tarjeta>
        )}
      </div>
    </>
  );
}
