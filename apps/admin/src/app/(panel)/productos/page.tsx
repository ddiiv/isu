"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { api, fotoUrl, pesos, useDatos } from "@/lib/api";
import { Boton, Cargando, claseEntrada, Insignia, Mensaje, Paginador, Titulo, useAviso } from "@/components/ui";
import { puede, useYo } from "@/components/Marco";
import { nombresCategorias, type Categoria, type FilaProducto } from "@/lib/catalogo";

const FILTROS: Array<[string, string]> = [
  ["todos", "Todos"], ["visibles", "Publicados"], ["ocultos", "Ocultos"], ["destacados", "Destacados"], ["nuevos", "Nuevos"], ["packs", "Se venden en pack"], ["sin_descripcion", "Sin descripción"],
  ["sin_fotos", "Sin fotos"], ["agotados", "Agotados"], ["de_baja", "Dados de baja en Stocker"],
];

function Productos() {
  const yo = useYo();
  const operador = puede(yo, "operador");
  const sp = useSearchParams();
  const router = useRouter();
  const filtro = sp.get("filtro") ?? "todos";
  const categoria = sp.get("categoria") ?? "";
  const pagina = Number(sp.get("pagina") ?? 1) || 1;
  const [q, setQ] = useState(sp.get("q") ?? "");
  const { datos, error, cargando, setDatos } = useDatos<{ productos: FilaProducto[]; total: number; porPagina: number }>("productos", { filtro, categoria, q: sp.get("q"), pagina });
  const { datos: cats } = useDatos<{ categorias: Categoria[] }>("categorias");
  const { datos: guias } = useDatos<{ guias: Array<{ id: number; nombre: string; tipo: string }> }>("guias-talles");
  const [elegidos, setElegidos] = useState<Set<number>>(new Set());
  const aviso = useAviso();
  const nombres = nombresCategorias(cats?.categorias ?? []);

  const ir = (c: Record<string, string | number | null>) => {
    const n = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(c)) { if (v === null || v === "") n.delete(k); else n.set(k, String(v)); }
    setElegidos(new Set());
    router.replace(`/productos?${n}`);
  };

  // Casilla de una fila: se guarda al instante (y se deshace si la API dice que no).
  async function alternar(p: FilaProducto, campo: "visible" | "destacado" | "nuevo" | "pack") {
    const valor = !p[campo];
    setDatos((d) => d && { ...d, productos: d.productos.map((x) => (x.id === p.id ? { ...x, [campo]: valor } : x)) });
    try { await api(`productos/${p.id}`, { metodo: "PATCH", cuerpo: { [campo]: valor } }); }
    catch (e) {
      setDatos((d) => d && { ...d, productos: d.productos.map((x) => (x.id === p.id ? { ...x, [campo]: !valor } : x)) });
      aviso.error(e);
    }
  }

  async function masivo(cambios: Record<string, unknown>, texto: string) {
    try {
      const r = await api<{ productos: number }>("productos/masivo", { cuerpo: { ids: [...elegidos], cambios } });
      aviso.ok(`${texto} (${r.productos} productos).`);
      setElegidos(new Set());
      const d = await api<{ productos: FilaProducto[]; total: number; porPagina: number }>("productos", { query: { filtro, categoria, q: sp.get("q"), pagina } });
      setDatos(d);
    } catch (e) { aviso.error(e); }
  }

  const todos = datos?.productos ?? [];
  const todosElegidos = todos.length > 0 && todos.every((p) => elegidos.has(p.id));
  return (
    <>
      <Titulo acciones={operador && <Boton variante="borde" onClick={() => api("sincronizar-catalogo", { metodo: "POST" }).then(() => aviso.ok("Se pidió el catálogo a Stocker: en un minuto está al día."), aviso.error)}>Traer cambios de Stocker</Boton>}>Productos</Titulo>
      <div className="mb-4 flex flex-wrap gap-2">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); ir({ q, pagina: null }); }}>
          <input className={`${claseEntrada} w-64`} placeholder="Nombre o artículo" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" />
        </form>
        <select className={`${claseEntrada} max-w-72`} value={filtro} onChange={(e) => ir({ filtro: e.target.value, pagina: null })} aria-label="Filtro">
          {FILTROS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
        </select>
        <select className={`${claseEntrada} max-w-72`} value={categoria} onChange={(e) => ir({ categoria: e.target.value, pagina: null })} aria-label="Categoría">
          <option value="">Todas las categorías</option>
          {(cats?.categorias ?? []).map((c) => <option key={c.id} value={c.id}>{nombres.get(c.id)}</option>)}
        </select>
      </div>
      <div className="mb-4"><aviso.Aviso /></div>

      {operador && elegidos.size > 0 && (
        <div className="sticky top-2 z-10 mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-marca bg-marca-claro p-3 text-sm">
          <span className="mr-2 font-bold">{elegidos.size} elegidos:</span>
          <Boton variante="borde" onClick={() => void masivo({ nuevo: true }, "Marcados como nuevos")}>Marcar Nuevo</Boton>
          <Boton variante="borde" onClick={() => void masivo({ nuevo: false }, "Sacados de Nuevos")}>Quitar Nuevo</Boton>
          <Boton variante="borde" onClick={() => void masivo({ destacado: true }, "Destacados")}>Marcar Destacado</Boton>
          <Boton variante="borde" onClick={() => void masivo({ destacado: false }, "Sacados de Destacados")}>Quitar Destacado</Boton>
          <Boton variante="borde" onClick={() => void masivo({ pack: true }, "Se venden en pack (2 a 5)")}>Vender en pack</Boton>
          <Boton variante="borde" onClick={() => void masivo({ pack: false }, "Sacados de Packs")}>Quitar de Packs</Boton>
          <Boton variante="borde" onClick={() => void masivo({ visible: true }, "Publicados")}>Publicar</Boton>
          <Boton variante="borde" onClick={() => void masivo({ visible: false }, "Ocultados")}>Ocultar</Boton>
          <select className="rounded-full border border-linea bg-white px-3 py-2 font-bold" value="" aria-label="Agregar a categoría"
            onChange={(e) => e.target.value && void masivo({ agregarCategoria: Number(e.target.value) }, "Agregados a la categoría")}>
            <option value="">Agregar a categoría…</option>
            {(cats?.categorias ?? []).map((c) => <option key={c.id} value={c.id}>{nombres.get(c.id)}</option>)}
          </select>
          <select className="rounded-full border border-linea bg-white px-3 py-2 font-bold" value="" aria-label="Asignar guía de talles"
            onChange={(e) => e.target.value && void masivo({ guiaTallesId: e.target.value === "ninguna" ? null : Number(e.target.value) }, "Guía de talles asignada")}>
            <option value="">Guía de talles…</option>
            {(guias?.guias ?? []).map((g) => <option key={g.id} value={g.id}>{g.nombre}</option>)}
            <option value="ninguna">Sin guía</option>
          </select>
          <Boton variante="texto" onClick={() => setElegidos(new Set())}>Deseleccionar</Boton>
        </div>
      )}

      <Mensaje>{error}</Mensaje>
      {cargando && !datos ? <Cargando /> : datos && (
        <>
          <div className="overflow-x-auto rounded-2xl border border-linea bg-white">
            <table className="tabla-apilada w-full min-w-[900px] text-left text-sm">
              <thead className="border-b border-linea text-tinta-tenue"><tr>
                {operador && <th className="w-10 px-3 py-3"><input type="checkbox" aria-label="Elegir todos" checked={todosElegidos} onChange={() => setElegidos(todosElegidos ? new Set() : new Set(todos.map((p) => p.id)))} /></th>}
                <th className="px-3 py-3">Producto</th><th className="px-3 py-3">Categorías</th><th className="px-3 py-3 text-right">Precio</th><th className="px-3 py-3 text-right">Stock</th><th className="px-3 py-3">Fotos</th>
                <th className="px-3 py-3 text-center">Visible</th><th className="px-3 py-3 text-center">Destacado</th><th className="px-3 py-3 text-center">Nuevo</th><th className="px-3 py-3 text-center">Pack</th>
              </tr></thead>
              <tbody className="divide-y divide-linea">
                {todos.map((p) => (
                  <tr key={p.id} className={elegidos.has(p.id) ? "bg-marca-claro/50" : "hover:bg-fondo-suave"}>
                    {operador && <td className="px-3 py-2"><input type="checkbox" aria-label={`Elegir ${p.nombre}`} checked={elegidos.has(p.id)} onChange={() => setElegidos((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })} /></td>}
                    <td className="px-3 py-2">
                      <Link href={`/productos/${p.id}`} className="flex items-center gap-3">
                        <span className="size-12 shrink-0 overflow-hidden rounded-lg bg-fondo-suave">{p.foto && <img src={fotoUrl(p.foto)} alt="" className="size-full object-cover" />}</span>
                        <span><span className="font-bold text-marca hover:underline">{p.nombre}</span><br /><span className="text-xs text-tinta-tenue">{p.sku}{!p.enStocker && " · baja en Stocker"}{p.resenas > 0 && ` · ★ ${p.estrellas?.toFixed(1)} (${p.resenas})`}</span></span>
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-xs" data-etiqueta="Categorías">{p.categorias.map((c) => nombres.get(c)).filter(Boolean).join(", ") || <span className="text-oferta">Sin categoría</span>}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right" data-etiqueta="Precio">{pesos(p.precio)}</td>
                    <td className="px-3 py-2 text-right" data-etiqueta="Stock">{p.stock}</td>
                    <td className="px-3 py-2" data-etiqueta="Fotos">{p.fotos ? `${p.fotos}/${p.colores * 5}` : <Insignia clase="bg-red-50 text-oferta">Sin fotos</Insignia>}</td>
                    {(["visible", "destacado", "nuevo", "pack"] as const).map((campo) => (
                      <td key={campo} className="celdas-casillas px-3 py-2 text-center" data-etiqueta={{ visible: "Visible", destacado: "Destacado", nuevo: "Nuevo", pack: "Pack" }[campo]}>
                        <input type="checkbox" className="size-4 accent-[var(--color-marca)]" aria-label={`${campo} ${p.nombre}`} checked={p[campo]} disabled={!operador} onChange={() => void alternar(p, campo)} />
                      </td>
                    ))}
                  </tr>
                ))}
                {!todos.length && <tr><td colSpan={10} className="px-4 py-10 text-center text-tinta-tenue">No hay productos con ese filtro.</td></tr>}
              </tbody>
            </table>
          </div>
          <Paginador pagina={pagina} total={datos.total} porPagina={datos.porPagina} onCambiar={(n) => ir({ pagina: n })} />
        </>
      )}
    </>
  );
}

export default function Pagina() { return <Suspense fallback={<Cargando />}><Productos /></Suspense>; }
