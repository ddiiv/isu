"use client";
import { useState } from "react";
import { api, useDatos } from "@/lib/api";
import { aSlug, arbol, type Categoria } from "@/lib/catalogo";
import { Boton, Campo, Cargando, Casilla, claseEntrada, Insignia, Mensaje, Tarjeta, Titulo, useAviso } from "@/components/ui";
import { puede, useYo } from "@/components/Marco";

/* Árbol de dos niveles (Mujer › Remeras). La dirección (slug) es la que se ve en la URL. */
type Borrador = Partial<Categoria> & { padreId: number | null };

export default function Categorias() {
  const yo = useYo();
  const operador = puede(yo, "operador");
  const { datos, error, recargar } = useDatos<{ categorias: Categoria[] }>("categorias");
  const [editando, setEditando] = useState<Borrador | null>(null);
  const aviso = useAviso();
  if (error) return <Mensaje>{error}</Mensaje>;
  if (!datos) return <Cargando />;

  async function guardar() {
    if (!editando) return;
    const cuerpo = { nombre: editando.nombre ?? "", slug: editando.slug || aSlug(editando.nombre ?? ""), padreId: editando.padreId, orden: editando.orden ?? 0, visible: editando.visible ?? true, seoTitulo: editando.seoTitulo || null, seoDescripcion: editando.seoDescripcion || null };
    try {
      if (editando.id) await api(`categorias/${editando.id}`, { metodo: "PATCH", cuerpo });
      else await api("categorias", { cuerpo });
      aviso.ok("Categoría guardada."); setEditando(null); await recargar();
    } catch (e) { aviso.error(e); }
  }
  async function borrar(c: Categoria) {
    if (!confirm(`¿Borrar "${c.nombre}"?`)) return;
    try { await api(`categorias/${c.id}`, { metodo: "DELETE" }); aviso.ok("Borrada."); await recargar(); } catch (e) { aviso.error(e); }
  }
  const Fila = ({ c, hija }: { c: Categoria; hija?: boolean }) => (
    <li className={`flex flex-wrap items-center justify-between gap-2 py-2.5 ${hija ? "pl-6" : ""}`}>
      <span className={hija ? "" : "font-bold"}>{c.nombre} <span className="text-xs font-normal text-tinta-tenue">/{c.slug} · {c.productos} productos</span> {!c.visible && <Insignia>Oculta</Insignia>}</span>
      {operador && <span className="flex flex-wrap gap-2">
        {!hija && <Boton variante="texto" onClick={() => setEditando({ padreId: c.id, visible: true, orden: 0 })}>+ Subcategoría</Boton>}
        <Boton variante="texto" onClick={() => setEditando({ ...c })}>Editar</Boton>
        <Boton variante="texto" className="text-oferta" onClick={() => void borrar(c)}>Borrar</Boton>
      </span>}
    </li>
  );

  return (
    <>
      <Titulo acciones={operador && <Boton onClick={() => setEditando({ padreId: null, visible: true, orden: 0 })}>Nueva categoría</Boton>}>Categorías</Titulo>
      <div className="mb-4"><aviso.Aviso /></div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Tarjeta>
          <ul className="divide-y divide-linea">
            {arbol(datos.categorias).map((p) => (
              <li key={p.id}><ul className="divide-y divide-linea"><Fila c={p} />{p.hijas.map((h) => <Fila key={h.id} c={h} hija />)}</ul></li>
            ))}
          </ul>
        </Tarjeta>
        {editando && (
          <Tarjeta titulo={editando.id ? "Editar categoría" : editando.padreId ? "Nueva subcategoría" : "Nueva categoría"}>
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void guardar(); }}>
              <Campo etiqueta="Nombre"><input required maxLength={60} className={claseEntrada} value={editando.nombre ?? ""} onChange={(e) => setEditando({ ...editando, nombre: e.target.value, ...(editando.id ? {} : { slug: aSlug(e.target.value) }) })} /></Campo>
              <Campo etiqueta="Dirección" ayuda="Minúsculas, números y guiones. Cambiarla rompe los enlaces viejos."><input required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={80} className={claseEntrada} value={editando.slug ?? ""} onChange={(e) => setEditando({ ...editando, slug: e.target.value })} /></Campo>
              <Campo etiqueta="Dentro de">
                <select className={claseEntrada} value={editando.padreId ?? ""} onChange={(e) => setEditando({ ...editando, padreId: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">— (categoría principal)</option>
                  {datos.categorias.filter((c) => !c.padreId && c.id !== editando.id).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </Campo>
              <Campo etiqueta="Orden" ayuda="Más chico = más a la izquierda en el menú."><input type="number" min={0} max={1000} className={`${claseEntrada} w-28`} value={editando.orden ?? 0} onChange={(e) => setEditando({ ...editando, orden: Number(e.target.value) || 0 })} /></Campo>
              <Casilla etiqueta="Visible" marcada={editando.visible ?? true} onChange={(v) => setEditando({ ...editando, visible: v })} />
              <Campo etiqueta="Título para Google"><input maxLength={70} className={claseEntrada} value={editando.seoTitulo ?? ""} onChange={(e) => setEditando({ ...editando, seoTitulo: e.target.value })} /></Campo>
              <Campo etiqueta="Descripción para Google"><input maxLength={160} className={claseEntrada} value={editando.seoDescripcion ?? ""} onChange={(e) => setEditando({ ...editando, seoDescripcion: e.target.value })} /></Campo>
              <div className="flex gap-2"><Boton type="submit">Guardar</Boton><Boton variante="borde" onClick={() => setEditando(null)}>Cancelar</Boton></div>
            </form>
          </Tarjeta>
        )}
      </div>
    </>
  );
}
