"use client";
import { useState } from "react";
import { api, useDatos } from "@/lib/api";
import { Boton, Campo, Cargando, claseEntrada, Insignia, Mensaje, Tarjeta, Titulo, useAviso } from "@/components/ui";
import { puede, useYo } from "@/components/Marco";

/*
 * Direcciones viejas (la tienda anterior, links compartidos) que mandan a una
 * página de esta tienda con un 301: así Google pasa el posicionamiento a la
 * nueva en vez de mostrar un error.
 */
interface Redireccion {
  id: number; desde: string; sku: string | null; hacia: string; origen: "jumpseller" | "manual"; creadoEn: string;
  destino: string | null; producto: { nombre: string; slug: string; publicado: boolean } | null;
}
type Borrador = { id?: number; desde: string; sku: string; hacia: string };

function Estado({ r }: { r: Redireccion }) {
  if (!r.destino) return <Insignia clase="bg-red-50 text-oferta">Da vueltas: revisala</Insignia>;
  if (!r.sku) return null;
  if (r.producto?.publicado) return <Insignia clase="bg-ahorro-claro text-ahorro">A la ficha</Insignia>;
  return <Insignia clase="bg-amber-50 text-amber-800">{r.producto ? "Producto oculto: va al plan B" : "SKU sin producto: va al plan B"}</Insignia>;
}

export default function Redirecciones() {
  const yo = useYo();
  const operador = puede(yo, "operador");
  const { datos, error, recargar } = useDatos<{ redirecciones: Redireccion[] }>("redirecciones");
  const [editando, setEditando] = useState<Borrador | null>(null);
  const [filtro, setFiltro] = useState("");
  const aviso = useAviso();
  if (error) return <Mensaje>{error}</Mensaje>;
  if (!datos) return <Cargando />;

  async function guardar() {
    if (!editando) return;
    const cuerpo = { desde: editando.desde, hacia: editando.hacia, sku: editando.sku.trim() || null };
    try {
      if (editando.id) await api(`redirecciones/${editando.id}`, { metodo: "PUT", cuerpo });
      else await api("redirecciones", { cuerpo });
      aviso.ok("Guardada. Ya la usa la tienda."); setEditando(null); await recargar();
    } catch (e) { aviso.error(e); }
  }
  async function borrar(r: Redireccion) {
    if (!confirm(`¿Borrar la redirección de ${r.desde}? Esa dirección va a dar «página no encontrada».`)) return;
    try { await api(`redirecciones/${r.id}`, { metodo: "DELETE" }); aviso.ok("Borrada."); await recargar(); } catch (e) { aviso.error(e); }
  }

  const f = filtro.trim().toLowerCase();
  const lista = datos.redirecciones.filter((r) => !f || r.desde.includes(f) || (r.destino ?? r.hacia).includes(f) || r.sku?.toLowerCase().includes(f) || r.producto?.nombre.toLowerCase().includes(f));
  const aPlanB = datos.redirecciones.filter((r) => r.sku && !r.producto?.publicado).length;

  return (
    <>
      <Titulo acciones={operador && <Boton onClick={() => setEditando({ desde: "", sku: "", hacia: "/" })}>Nueva redirección</Boton>}>Redirecciones</Titulo>
      <p className="mb-4 max-w-3xl text-sm text-tinta-suave">
        Las direcciones de la tienda anterior que Google ya conoce. Cada una manda a su página nueva con una redirección permanente (301),
        y así no se pierde el posicionamiento. Si era un producto, va a su ficha mientras esté publicado; si no, a su <b>plan B</b> (su categoría).
      </p>
      {aPlanB > 0 && <div className="mb-4"><Mensaje tipo="info">{aPlanB} productos viejos todavía van a su categoría porque el producto no está publicado (sin fotos u oculto). Cuando lo publiques, la dirección vieja pasa a su ficha sola.</Mensaje></div>}
      <div className="mb-4"><aviso.Aviso /></div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Tarjeta>
          <input type="search" placeholder="Buscar dirección, SKU o producto" aria-label="Buscar" className={`${claseEntrada} mb-3`} value={filtro} onChange={(e) => setFiltro(e.target.value)} />
          <p className="mb-2 text-xs text-tinta-tenue">{lista.length} de {datos.redirecciones.length}</p>
          <ul className="divide-y divide-linea">
            {lista.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block break-all text-sm font-bold">{r.desde}</span>
                  <span className="block break-all text-sm text-tinta-suave">→ {r.destino ?? r.hacia}{r.producto && <span className="text-tinta-tenue"> · {r.producto.nombre}</span>}</span>
                  <span className="mt-1 flex flex-wrap gap-1.5">
                    <Estado r={r} />
                    {r.sku && <Insignia>{r.sku}</Insignia>}
                    {r.origen === "jumpseller" && <Insignia>Tienda anterior</Insignia>}
                  </span>
                </span>
                {operador && <span className="flex gap-2">
                  <Boton variante="texto" onClick={() => setEditando({ id: r.id, desde: r.desde, sku: r.sku ?? "", hacia: r.hacia })}>Editar</Boton>
                  <Boton variante="texto" className="text-oferta" onClick={() => void borrar(r)}>Borrar</Boton>
                </span>}
              </li>
            ))}
          </ul>
        </Tarjeta>
        {editando && (
          <Tarjeta titulo={editando.id ? "Editar redirección" : "Nueva redirección"}>
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void guardar(); }}>
              <Campo etiqueta="Dirección vieja" ayuda="Se puede pegar entera (https://www.isuwaya.com/…): se guarda sólo la ruta.">
                <input required maxLength={400} className={claseEntrada} placeholder="/abel-pantalon-hombre" value={editando.desde} onChange={(e) => setEditando({ ...editando, desde: e.target.value })} />
              </Campo>
              <Campo etiqueta="SKU del producto (opcional)" ayuda="Si era un producto: el SKU de Stocker. Va a su ficha mientras esté publicado, aunque le cambies el nombre.">
                <input maxLength={100} className={claseEntrada} placeholder="ISUABEPAN" value={editando.sku} onChange={(e) => setEditando({ ...editando, sku: e.target.value.toUpperCase() })} />
              </Campo>
              <Campo etiqueta={editando.sku.trim() ? "Plan B (si el producto no está publicado)" : "A dónde manda"} ayuda="Una página de esta tienda: /hombre/remeras, /locales, /buscar?q=lino…">
                <input required maxLength={400} className={claseEntrada} value={editando.hacia} onChange={(e) => setEditando({ ...editando, hacia: e.target.value })} />
              </Campo>
              <div className="flex gap-2"><Boton type="submit">Guardar</Boton><Boton variante="borde" onClick={() => setEditando(null)}>Cancelar</Boton></div>
            </form>
          </Tarjeta>
        )}
      </div>
    </>
  );
}
