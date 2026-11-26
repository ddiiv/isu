"use client";
import { useEffect, useMemo, useState } from "react";
import { api, fotoUrl, useDatos } from "@/lib/api";
import { Boton, Cargando, Casilla, claseEntrada, Mensaje, Tarjeta, Titulo, useAviso } from "@/components/ui";
import { puede, useYo } from "@/components/Marco";

/*
 * Catálogo en PDF para uso interno: elegís qué productos entran (queda guardado) y lo descargás. Compacto: 16 por hoja, cada uno con foto
 * de frente y de espalda (las de la web), nombre, SKU padre, colores y talles. Las fotos de frente/espalda salen de isu-fotos; si un producto no las tiene, se usan sus dos primeras fotos.
 */
interface Producto { id: number; nombre: string; sku: string; visible: boolean; enCatalogo: boolean; foto: string | null; fotos: number }

export default function CatalogoPdf() {
  const operador = puede(useYo(), "operador");
  const { datos, error, recargar } = useDatos<{ productos: Producto[] }>("catalogo");
  const aviso = useAviso();
  const [elegidos, setElegidos] = useState<Set<number>>(new Set());
  const [q, setQ] = useState("");
  const [soloPublicados, setSoloPublicados] = useState(true);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => { if (datos) setElegidos(new Set(datos.productos.filter((p) => p.enCatalogo).map((p) => p.id))); }, [datos]);

  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (datos?.productos ?? []).filter((p) => (!soloPublicados || p.visible) && (!t || p.nombre.toLowerCase().includes(t) || p.sku.toLowerCase().includes(t)));
  }, [datos, q, soloPublicados]);
  if (error) return <Mensaje>{error}</Mensaje>;
  if (!datos) return <Cargando />;

  const guardados = new Set(datos.productos.filter((p) => p.enCatalogo).map((p) => p.id));
  const cambios = elegidos.size !== guardados.size || [...elegidos].some((id) => !guardados.has(id));
  const marcar = (ids: number[], v: boolean) => setElegidos((e) => { const n = new Set(e); for (const id of ids) { if (v) n.add(id); else n.delete(id); } return n; });

  async function guardar() {
    setGuardando(true);
    try { await api("catalogo", { metodo: "PUT", cuerpo: { ids: [...elegidos] } }); aviso.ok("Selección guardada."); await recargar(); } catch (e) { aviso.error(e); } finally { setGuardando(false); }
  }

  return (
    <>
      <Titulo acciones={<>
        {operador && <Boton variante="borde" disabled={!cambios || guardando} onClick={() => void guardar()}>Guardar selección</Boton>}
        {/* Descarga lo guardado: con cambios sin guardar, primero hay que guardarlos. */}
        <a href="/api/a/catalogo/pdf" download aria-disabled={cambios || !guardados.size}
          className={`inline-flex items-center rounded-full bg-tinta px-5 py-2.5 text-sm font-bold text-white ${cambios || !guardados.size ? "pointer-events-none opacity-40" : ""}`}>Descargar PDF ({guardados.size})</a>
      </>}>Catálogo PDF</Titulo>
      <p className="mb-4 max-w-3xl text-sm text-tinta-suave">
        Elegí qué productos entran al catálogo interno y guardá la selección. Sale compacto: 16 productos por hoja, cada uno con su foto de frente y de espalda (las de la web), el nombre, el SKU padre, los colores y los talles.
        {cambios && <b className="ml-1 text-oferta">Tenés cambios sin guardar.</b>}
      </p>
      <div className="mb-4"><aviso.Aviso /></div>
      <Tarjeta>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <input className={`${claseEntrada} max-w-xs`} placeholder="Buscar por nombre o SKU" value={q} onChange={(e) => setQ(e.target.value)} />
          <Casilla etiqueta="Sólo publicados" marcada={soloPublicados} onChange={setSoloPublicados} />
          {operador && <>
            <Boton variante="texto" onClick={() => marcar(filtrados.map((p) => p.id), true)}>Elegir los {filtrados.length} de la lista</Boton>
            <Boton variante="texto" onClick={() => marcar(filtrados.map((p) => p.id), false)}>Sacar los de la lista</Boton>
          </>}
          <span className="ml-auto text-sm text-tinta-tenue">{elegidos.size} elegidos</span>
        </div>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {filtrados.map((p) => (
            <li key={p.id}>
              <label className={`flex cursor-pointer items-center gap-3 rounded-xl border p-2 ${elegidos.has(p.id) ? "border-marca bg-marca-claro" : "border-linea"}`}>
                <input type="checkbox" className="size-4 accent-marca" disabled={!operador} checked={elegidos.has(p.id)} onChange={(e) => marcar([p.id], e.target.checked)} />
                {p.foto ? <img src={fotoUrl(p.foto)} alt="" className="size-14 shrink-0 rounded-lg object-cover" loading="lazy" /> : <span className="size-14 shrink-0 rounded-lg bg-fondo-suave" />}
                <span className="min-w-0 text-sm">
                  <span className="block truncate font-bold">{p.nombre}</span>
                  <span className="block text-xs text-tinta-tenue">{p.sku}{!p.visible ? " · no publicado" : ""}{p.fotos < 2 ? ` · ${p.fotos === 0 ? "sin fotos" : "1 foto"}` : ""}</span>
                </span>
              </label>
            </li>
          ))}
          {!filtrados.length && <li className="py-8 text-center text-tinta-tenue">No hay productos con ese filtro.</li>}
        </ul>
      </Tarjeta>
    </>
  );
}
