"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useRef, useState, type DragEvent } from "react";
import { api, fotoUrl, pesos, useDatos, videoUrl } from "@/lib/api";
import { arbol, type Categoria, type GuiaResumen } from "@/lib/catalogo";
import { Boton, Campo, Cargando, Casilla, claseEntrada, Insignia, Mensaje, Tarjeta, Titulo, useAviso } from "@/components/ui";
import { puede, useYo } from "@/components/Marco";

interface Detalle {
  producto: {
    id: number; slug: string; nombre: string; nombreFijo: boolean; sku: string; visible: boolean; enStocker: boolean;
    descripcion: string | null; descripcionStocker: string | null; seoTitulo: string | null; seoDescripcion: string | null;
    categoriaStocker: string | null; generoStocker: string | null; categoriasFijas: boolean;
    destacado: boolean; destacadoOrden: number; nuevo: boolean; categorias: number[];
    guiaTallesId: number | null; parteOutfit: string | null; parteOutfitSugerida: string | null;
    pesoGramos: number | null; altoCm: number | null; anchoCm: number | null; largoCm: number | null;
    pack: boolean; packOrden: number; composicion: string | null; resenas: { cantidad: number; promedio: number | null };
    eliminadoEn: string | null; eliminadoPor: string | null;
    video: { clave: string; publicado: boolean } | null;
  };
  colores: Array<{ id: number; clave: string; nombre: string; hex: string | null; orden: number; activo: boolean; nombreFijo: boolean }>;
  fotos: Array<{ id: number; tipo: "color" | "exhibicion"; colorId: number | null; orden: number; clave: string; ancho: number; alto: number; alt: string | null }>;
  variantes: Array<{ sku: string; talle: string | null; precio: number; stock: number; activo: boolean; oculta: boolean; colorId: number | null }>;
  topeFotos: number;
}
type Form = Detalle["producto"];
const PARTES: Array<[string, string]> = [["", "Automático"], ["arriba", "Arriba (remeras, tops, camisas)"], ["abajo", "Abajo (pantalones, shorts, polleras)"], ["abrigo", "Abrigo (buzos, camperas)"], ["ninguna", "No sugerir en outfits"]];
const SITIO = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");

export default function EditarProducto({ params }: { params: Promise<{ slug: string }> }) {
  // La dirección lleva el nombre del producto (/productos/remera-basica), no el id. Las viejas (/productos/123) se pasan a la nueva.
  const { slug } = use(params);
  const router = useRouter();
  const yo = useYo();
  const operador = puede(yo, "operador");
  const { datos: d, error, recargar } = useDatos<Detalle>(/^\d+$/.test(slug) ? `productos/${slug}` : `productos/s/${slug}`);
  const id = d?.producto.id;
  useEffect(() => { if (d && d.producto.slug !== slug) router.replace(`/productos/${d.producto.slug}`); }, [d, slug, router]);
  const { datos: cats } = useDatos<{ categorias: Categoria[] }>("categorias");
  const { datos: guias } = useDatos<{ guias: GuiaResumen[] }>("guias-talles");
  const [f, setF] = useState<Form | null>(null);
  const [guardando, setGuardando] = useState(false);
  const aviso = useAviso();
  useEffect(() => { if (d) setF(d.producto); }, [d]);

  if (error) return <Mensaje>{error}</Mensaje>;
  if (!d || !f) return <Cargando />;
  const cambiar = <K extends keyof Form>(k: K, v: Form[K]) => setF({ ...f, [k]: v });
  const original = d.producto;
  const sucio = JSON.stringify(f) !== JSON.stringify(original);
  const faltanMedidas = [f.pesoGramos, f.altoCm, f.anchoCm, f.largoCm].some((v) => v === null);
  const medida = (k: "pesoGramos" | "altoCm" | "anchoCm" | "largoCm", etiqueta: string, max: number, ayuda?: string) => (
    <Campo etiqueta={etiqueta} ayuda={ayuda} error={f[k] === null ? "Falta" : null}>
      <input type="number" min={1} max={max} inputMode="numeric" required className={claseEntrada} disabled={!operador}
        value={f[k] ?? ""} onChange={(e) => cambiar(k, e.target.value ? Math.max(1, Math.round(Number(e.target.value))) : null)} />
    </Campo>
  );

  async function guardar() {
    if (!f) return;
    const cambios: Record<string, unknown> = {};
    // Etapa 15: todos los productos llevan peso y medidas (con eso se cotiza el envío con cada transporte).
    if (faltanMedidas) { aviso.error(new Error("Completá el peso y las tres medidas de la prenda doblada: con eso se cotiza el envío.")); return; }
    const campos = ["nombre", "descripcion", "seoTitulo", "seoDescripcion", "visible", "destacado", "destacadoOrden", "nuevo", "guiaTallesId", "parteOutfit", "pesoGramos", "altoCm", "anchoCm", "largoCm", "pack", "packOrden", "composicion"] as const;
    for (const k of campos) if (JSON.stringify(f[k]) !== JSON.stringify(original[k])) cambios[k] = f[k];
    if (JSON.stringify([...f.categorias].sort()) !== JSON.stringify([...original.categorias].sort())) cambios.categorias = f.categorias;
    if (!Object.keys(cambios).length) return;
    setGuardando(true);
    try { await api(`productos/${id}`, { metodo: "PATCH", cuerpo: cambios }); aviso.ok("Guardado. La tienda se actualiza en unos segundos."); await recargar(); }
    catch (e) { aviso.error(e); }
    finally { setGuardando(false); }
  }

  /** Etapa 10: eliminar (baja suave: sale de la tienda y Stocker no lo vuelve a publicar) o restaurar. */
  async function eliminarORestaurar(restaurar: boolean) {
    if (!restaurar && !window.confirm(`¿Eliminar «${original.nombre}»? Sale de la tienda y de la lista de productos, y Stocker no lo vuelve a publicar. Se puede restaurar desde Productos → «Eliminados».`)) return;
    try {
      await api(restaurar ? "productos/restaurar" : "productos/eliminar", { cuerpo: { ids: [original.id] } });
      aviso.ok(restaurar ? "Restaurado: quedó oculto. Publicalo cuando quieras." : "Eliminado.");
      await recargar();
    } catch (e) { aviso.error(e); }
  }

  const guiasDisponibles = guias?.guias ?? [];
  const tallesProducto = [...new Set(d.variantes.filter((v) => v.activo && v.talle).map((v) => v.talle!))];

  return (
    <>
      <p className="mb-2 text-sm"><Link href="/productos" className="text-marca hover:underline">← Productos</Link></p>
      <Titulo acciones={<>
        {SITIO && <a href={`${SITIO}/producto/${original.slug}`} target="_blank" rel="noopener" className="rounded-full border border-linea bg-white px-4 py-2 text-sm font-bold hover:border-tinta">Ver en la tienda ↗</a>}
        {operador && !original.eliminadoEn && <Boton variante="peligro" onClick={() => void eliminarORestaurar(false)}>Eliminar</Boton>}
        {operador && original.eliminadoEn && <Boton variante="borde" onClick={() => void eliminarORestaurar(true)}>Restaurar</Boton>}
        {operador && !original.eliminadoEn && <Boton onClick={() => void guardar()} disabled={!sucio || guardando}>{guardando ? "Guardando…" : "Guardar cambios"}</Boton>}
      </>}>{original.nombre}</Titulo>
      <div className="mb-4 space-y-2">
        <aviso.Aviso />
        {original.eliminadoEn && <Mensaje>Eliminado el {new Date(original.eliminadoEn).toLocaleString("es-AR")}{original.eliminadoPor ? ` por ${original.eliminadoPor}` : ""}: no se muestra en la tienda. Restauralo para volver a editarlo.</Mensaje>}
        {!original.enStocker && <Mensaje tipo="info">Este artículo ya no está en el catálogo de Stocker: no se muestra en la tienda.</Mensaje>}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Tarjeta titulo="Datos">
            <div className="space-y-4">
              <Campo etiqueta="Nombre en la tienda" ayuda={f.nombreFijo ? "Editado a mano: Stocker ya no lo cambia." : `Viene de Stocker (art. ${original.sku}). Si lo cambiás, queda fijo.`}>
                <input className={claseEntrada} maxLength={150} disabled={!operador} value={f.nombre} onChange={(e) => cambiar("nombre", e.target.value)} />
              </Campo>
              <Campo etiqueta="Descripción" ayuda={!f.descripcion ? (original.descripcionStocker ? "Vacía: se muestra la de Stocker." : "Vacía: la tienda arma una con los colores, los talles y la composición. Mejor escribirla: cómo es la tela, el calce, para qué sirve.") : undefined}>
                <textarea className={`${claseEntrada} min-h-32`} maxLength={5000} disabled={!operador} placeholder={original.descripcionStocker ?? "Remera corta al cuerpo, cuello redondo de ribb. Tela liviana y fresca, ideal para el día a día."} value={f.descripcion ?? ""} onChange={(e) => cambiar("descripcion", e.target.value || null)} />
              </Campo>
              <Campo etiqueta="Composición" ayuda="Va en la ficha, con los cuidados generales (Ajustes). Ej.: 100% algodón jersey.">
                <input className={claseEntrada} maxLength={200} disabled={!operador} value={f.composicion ?? ""} onChange={(e) => cambiar("composicion", e.target.value || null)} />
              </Campo>
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo etiqueta="Título para Google" ayuda={`${(f.seoTitulo ?? "").length}/70 · vacío = el nombre`}><input className={claseEntrada} maxLength={70} disabled={!operador} value={f.seoTitulo ?? ""} onChange={(e) => cambiar("seoTitulo", e.target.value || null)} /></Campo>
                <Campo etiqueta="Descripción para Google" ayuda={`${(f.seoDescripcion ?? "").length}/160`}><input className={claseEntrada} maxLength={160} disabled={!operador} value={f.seoDescripcion ?? ""} onChange={(e) => cambiar("seoDescripcion", e.target.value || null)} /></Campo>
              </div>
            </div>
          </Tarjeta>

          <Fotos d={d} operador={operador} recargar={recargar} aviso={aviso} />

          <Video d={d} operador={operador} recargar={recargar} aviso={aviso} />

          <Tarjeta titulo="Variantes (de Stocker)">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-tinta-tenue"><tr><th className="py-2 pr-3">SKU</th><th className="pr-3">Color</th><th className="pr-3">Talle</th><th className="text-right">Precio</th><th className="text-right">Stock</th><th className="pl-3 text-center">En la tienda</th></tr></thead>
                <tbody className="divide-y divide-linea">
                  {d.variantes.map((v) => (
                    <tr key={v.sku} className={v.activo ? "" : "text-tinta-tenue"}>
                      <td className={`py-1.5 ${v.activo ? "" : "line-through"}`}>{v.sku}</td><td>{d.colores.find((c) => c.id === v.colorId)?.nombre ?? "—"}</td><td>{v.talle ?? "—"}</td>
                      <td className="whitespace-nowrap text-right">{pesos(v.precio)}</td><td className={`text-right ${v.stock ? "" : "text-oferta"}`}>{v.stock}</td>
                      <td className="pl-3 text-center">
                        {/* Un talle que existe en Stocker pero no se vende online (ej. una musculosa sólo en talle Único). */}
                        <input type="checkbox" checked={!v.oculta} disabled={!operador} aria-label={`Vender ${v.sku} en la tienda`} className="size-4 accent-marca"
                          onChange={(e) => void api(`variantes/${encodeURIComponent(v.sku)}`, { metodo: "PATCH", cuerpo: { oculta: !e.target.checked } })
                            .then(() => { aviso.ok(e.target.checked ? "Talle a la venta." : "Talle oculto en la tienda (sigue en Stocker)."); return recargar(); }, aviso.error)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-tinta-tenue">Precio y stock se cambian en Stocker. Para rebajas usá Descuentos. Destildá «En la tienda» para no vender un talle online.</p>
          </Tarjeta>
        </div>

        <div className="space-y-6">
          <Tarjeta titulo="Publicación">
            <div className="space-y-3">
              <Casilla etiqueta="Visible en la tienda" marcada={f.visible} disabled={!operador} onChange={(v) => cambiar("visible", v)} />
              <Casilla etiqueta="Destacado" ayuda='Sale en "Destacados" del inicio y en /destacados.' marcada={f.destacado} disabled={!operador} onChange={(v) => cambiar("destacado", v)} />
              {f.destacado && (
                <Campo etiqueta="Posición en Destacados" ayuda="Más chico = más arriba. Iguales: el más nuevo primero." className="pl-7">
                  <input type="number" className={`${claseEntrada} w-28`} min={-1000} max={1000} disabled={!operador} value={f.destacadoOrden} onChange={(e) => cambiar("destacadoOrden", Math.max(-1000, Math.min(1000, Number(e.target.value) || 0)))} />
                </Campo>
              )}
              <Casilla etiqueta="Nuevo" ayuda='Lleva la etiqueta "Nuevo" y sale en "Nuevos" (barra de navegación e inicio).' marcada={f.nuevo} disabled={!operador} onChange={(v) => cambiar("nuevo", v)} />
              <Casilla etiqueta="Se vende en pack" ayuda='Sale en "Packs" del inicio y del menú (en su categoría: Hombre, Mujer, Niños). Se arma con esta prenda, de las cantidades y con el % de Ajustes → Packs, con el stock de cada talle y color (no se suma a una rebaja: gana el mayor).' marcada={f.pack} disabled={!operador} onChange={(v) => cambiar("pack", v)} />
              {f.pack && (
                <Campo etiqueta="Posición en Packs" ayuda="Más chico = más arriba." className="pl-7">
                  <input type="number" className={`${claseEntrada} w-28`} min={-1000} max={1000} disabled={!operador} value={f.packOrden} onChange={(e) => cambiar("packOrden", Math.max(-1000, Math.min(1000, Number(e.target.value) || 0)))} />
                </Campo>
              )}
              {original.resenas.cantidad > 0 && (
                <p className="text-sm text-tinta-suave">★ {original.resenas.promedio?.toFixed(1)} de 5 · {original.resenas.cantidad} {original.resenas.cantidad === 1 ? "reseña publicada" : "reseñas publicadas"} · <a href="/resenas?estado=publicada" className="text-marca hover:underline">Ver reseñas</a></p>
              )}
            </div>
          </Tarjeta>

          <Tarjeta titulo="Categorías">
            <p className="mb-3 text-xs text-tinta-tenue">
              Stocker: {[original.generoStocker, original.categoriaStocker].filter(Boolean).join(" · ") || "sin datos"}.{" "}
              {original.categoriasFijas ? "Corregidas a mano: la sincronización no las toca." : "Asignadas solas según Stocker."}
            </p>
            <ul className="space-y-2">
              {arbol(cats?.categorias ?? []).map((p) => (
                <li key={p.id}>
                  <Casilla etiqueta={p.nombre} marcada={f.categorias.includes(p.id)} disabled={!operador}
                    onChange={(v) => cambiar("categorias", v ? [...f.categorias, p.id] : f.categorias.filter((x) => x !== p.id))} />
                  <ul className="mt-1 grid grid-cols-2 gap-1 pl-6">
                    {p.hijas.map((h) => (
                      <li key={h.id}><Casilla etiqueta={<span className="font-normal">{h.nombre}</span>} marcada={f.categorias.includes(h.id)} disabled={!operador}
                        onChange={(v) => cambiar("categorias", v ? [...f.categorias, h.id] : f.categorias.filter((x) => x !== h.id))} /></li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </Tarjeta>

          <Tarjeta titulo="Guía de talles">
            <select className={claseEntrada} disabled={!operador} value={f.guiaTallesId ?? ""} onChange={(e) => cambiar("guiaTallesId", e.target.value ? Number(e.target.value) : null)} aria-label="Guía de talles">
              <option value="">Sin guía</option>
              {guiasDisponibles.map((g) => {
                // El tipo, salvo que el nombre ya lo diga («Niños (remeras…)» no repite «(niños)»).
                const tipo = g.tipo === "nino" ? "niños" : g.tipo === "adulto" ? "adulto" : "talles propios";
                return <option key={g.id} value={g.id}>{g.nombre}{g.nombre.toLowerCase().includes(tipo) ? "" : ` (${tipo})`}</option>;
              })}
            </select>
            <p className="mt-2 text-xs text-tinta-tenue">Talles de este producto: {tallesProducto.join(" · ") || "—"}</p>
            <p className="mt-1 text-xs"><Link href={f.guiaTallesId ? `/guias-talles/${f.guiaTallesId}` : "/guias-talles/nueva"} className="text-marca hover:underline">{f.guiaTallesId ? "Editar esta guía" : "Crear una guía nueva"}</Link></p>
          </Tarjeta>

          <Tarjeta titulo="Armá tu outfit">
            <select className={claseEntrada} disabled={!operador} value={f.parteOutfit ?? ""} onChange={(e) => cambiar("parteOutfit", e.target.value || null)} aria-label="Parte del outfit">
              {PARTES.map(([k, t]) => <option key={k} value={k}>{k === "" ? `${t}${original.parteOutfitSugerida ? ` (${original.parteOutfitSugerida})` : " (no entra)"}` : t}</option>)}
            </select>
          </Tarjeta>

          <Tarjeta titulo="Peso y medidas para el envío">
            <p className="mb-3 text-xs text-tinta-tenue">
              Una prenda doblada, como va en la bolsa. Con esto se cotiza el envío con todos los transportes: todo el pedido viaja en una sola bolsa.
            </p>
            {faltanMedidas && (
              <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900 ring-1 ring-amber-200">
                Faltan datos. Hasta que los cargues, se cotiza con la prenda por defecto de Ajustes → «Paquete: todo en una bolsa».
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              {medida("pesoGramos", "Peso (g)", 30000)}
              {medida("altoCm", "Grosor (cm)", 100, "Doblada, de alto")}
              {medida("anchoCm", "Ancho (cm)", 150)}
              {medida("largoCm", "Largo (cm)", 150)}
            </div>
          </Tarjeta>

          <Colores d={d} operador={operador} recargar={recargar} aviso={aviso} />
        </div>
      </div>
    </>
  );
}

type Aviso = ReturnType<typeof useAviso>;

/*
 * Video vertical del producto (uno). Entra como borrador: en la tienda se ve recién al publicarlo,
 * así se mira antes que la prenda sea la misma (los hechos con IA pueden cambiarla).
 */
function Video({ d, operador, recargar, aviso }: { d: Detalle; operador: boolean; recargar: () => Promise<void>; aviso: Aviso }) {
  const entrada = useRef<HTMLInputElement>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const v = d.producto.video;
  const ruta = `productos/${d.producto.id}/video`;
  async function hacer(texto: string, accion: () => Promise<unknown>, ok: string) {
    setOcupado(texto);
    try { await accion(); aviso.ok(ok); await recargar(); } catch (e) { aviso.error(e); }
    setOcupado(null);
    if (entrada.current) entrada.current.value = "";
  }
  const subir = (a: File | undefined) => a && void hacer("Subiendo el video…", () => api(ruta, { archivo: a }), "Video subido como borrador: miralo y publicalo cuando esté bien.");
  return (
    <Tarjeta titulo="Video" acciones={v && <Insignia clase={v.publicado ? "bg-ahorro-claro text-ahorro" : "bg-amber-50 text-amber-800"}>{v.publicado ? "Publicado" : "Borrador"}</Insignia>}>
      <input ref={entrada} type="file" accept="video/mp4" hidden onChange={(e) => subir(e.target.files?.[0])} />
      {ocupado && <p className="mb-3 text-sm font-bold text-marca" role="status">{ocupado}</p>}
      {v ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <video key={v.clave} src={videoUrl(v.clave)} controls muted playsInline preload="metadata" aria-label={`Video de ${d.producto.nombre}`}
            className="aspect-[9/16] w-44 shrink-0 rounded-lg bg-black object-contain" />
          <div className="flex flex-wrap gap-2">
            {operador && (v.publicado
              ? <Boton variante="borde" disabled={!!ocupado} onClick={() => void hacer("Guardando…", () => api(ruta, { metodo: "PATCH", cuerpo: { publicado: false } }), "Video oculto: ya no se ve en la tienda.")}>Ocultar de la tienda</Boton>
              : <Boton disabled={!!ocupado} onClick={() => void hacer("Guardando…", () => api(ruta, { metodo: "PATCH", cuerpo: { publicado: true } }), "Video publicado. La tienda se actualiza en unos segundos.")}>Publicar en la tienda</Boton>)}
            <a href={`/api/a/${ruta}/descarga`} download className="inline-flex items-center rounded-xl border border-linea bg-white px-4 py-2 text-sm font-bold shadow-sm hover:border-tinta">Descargar</a>
            {operador && <Boton variante="borde" disabled={!!ocupado} onClick={() => entrada.current?.click()}>Cambiar video</Boton>}
            {operador && <Boton variante="peligro" disabled={!!ocupado}
              onClick={() => window.confirm("¿Borrar el video? Sale de la tienda y no se puede recuperar (descargalo antes si lo querés guardar).") && void hacer("Borrando…", () => api(ruta, { metodo: "DELETE" }), "Video borrado.")}>Borrar</Boton>}
          </div>
        </div>
      ) : operador ? (
        <Boton variante="borde" disabled={!!ocupado} onClick={() => entrada.current?.click()}>+ Subir video</Boton>
      ) : <p className="text-sm text-tinta-tenue">Sin video.</p>}
      <p className="mt-3 text-xs text-tinta-tenue">MP4 vertical (9:16), de hasta 50 MB. Al subir o cambiar el video queda como borrador hasta que lo publiques. Va segundo en las fotos de la tienda, sin sonido.</p>
    </Tarjeta>
  );
}

function Colores({ d, operador, recargar, aviso }: { d: Detalle; operador: boolean; recargar: () => Promise<void>; aviso: Aviso }) {
  return (
    <Tarjeta titulo="Colores">
      <ul className="space-y-2">
        {d.colores.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0 flex-1">
              <label className="sr-only" htmlFor={`color-${c.id}`}>Nombre del color {c.nombre}</label>
              <input id={`color-${c.id}`} disabled={!operador} defaultValue={c.nombre} maxLength={60}
                className={`w-full rounded-lg border border-transparent bg-transparent px-1.5 py-1 hover:border-linea focus:border-marca focus:outline-none ${c.activo ? "" : "text-tinta-tenue line-through"}`}
                onBlur={(e) => { const v = e.target.value.trim(); if (v.length >= 2 && v !== c.nombre) void api(`colores/${c.id}`, { metodo: "PATCH", cuerpo: { nombre: v } }).then(() => { aviso.ok("Nombre guardado: Stocker ya no lo cambia."); return recargar(); }, aviso.error); }} />
              {c.nombreFijo && operador && (
                <button type="button" className="px-1.5 text-xs text-tinta-tenue underline"
                  onClick={() => void api(`colores/${c.id}`, { metodo: "PATCH", cuerpo: { nombre: null } }).then(() => { aviso.ok("Vuelve al nombre de Stocker en la próxima sincronización."); return recargar(); }, aviso.error)}>
                  Nombre puesto a mano · volver al de Stocker
                </button>
              )}
            </span>
            <label className="flex items-center gap-2">
              <span className="sr-only">Color de muestra de {c.nombre}</span>
              <input type="color" disabled={!operador} defaultValue={c.hex ?? "#cccccc"} className="h-8 w-12 cursor-pointer rounded border border-linea"
                onBlur={(e) => e.target.value !== (c.hex ?? "#cccccc") && void api(`colores/${c.id}`, { metodo: "PATCH", cuerpo: { hex: e.target.value } }).then(() => { aviso.ok("Color guardado."); return recargar(); }, aviso.error)} />
            </label>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-tinta-tenue">El circulito es la muestra que se ve en la grilla. Los colores salen de Stocker; si le cambiás el nombre acá (ej. «Único» → «Negro»), la tienda usa el tuyo.</p>
    </Tarjeta>
  );
}

/*
 * Fotos: hasta 5 por color. De "color" (la prenda sola, estirada o en
 * percha) y de "exhibición" (con modelo). El total del producto no pasa de
 * 5 × cantidad de colores. La base lo controla igual.
 */
function Fotos({ d, operador, recargar, aviso }: { d: Detalle; operador: boolean; recargar: () => Promise<void>; aviso: Aviso }) {
  const [subiendo, setSubiendo] = useState<string | null>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const destino = useRef<{ tipo: "color" | "exhibicion"; color: number | null }>({ tipo: "exhibicion", color: null });
  const total = d.fotos.length;

  async function subir(archivos: FileList | null) {
    if (!archivos?.length) return;
    const { tipo, color } = destino.current;
    for (const [i, a] of [...archivos].entries()) {
      setSubiendo(`Subiendo ${i + 1} de ${archivos.length}…`);
      try {
        await api(`productos/${d.producto.id}/fotos`, { archivo: a, query: { tipo, color: color ?? undefined } });
      } catch (e) { aviso.error(e); break; }
    }
    setSubiendo(null);
    if (entrada.current) entrada.current.value = "";
    await recargar();
  }
  const elegir = (tipo: "color" | "exhibicion", color: number | null) => { destino.current = { tipo, color }; entrada.current?.click(); };
  /*
   * Suelta la foto `id` en el grupo `g`, antes de la foto `antesDe` (o al final).
   * Si cambia de grupo se le cambia el color; a "Generales" va como exhibición sin
   * color. El orden se guarda para el producto entero, grupo por grupo.
   */
  async function soltar(id: number, g: Grupo, antesDe: number | null) {
    const f = d.fotos.find((x) => x.id === id);
    if (!f || id === antesDe) return;
    const listas = grupos.map((x) => ({ color: x.color, ids: x.fotos.map((y) => y.id).filter((y) => y !== id) }));
    const lista = listas.find((x) => x.color === g.color)!.ids;
    const en = antesDe === null ? -1 : lista.indexOf(antesDe);
    lista.splice(en < 0 ? lista.length : en, 0, id);
    try {
      if (!g.fotos.includes(f)) {
        await api(`fotos/${id}`, { metodo: "PATCH", cuerpo: g.color === null ? { colorId: null, tipo: "exhibicion" } : { colorId: g.color } });
      }
      await api(`productos/${d.producto.id}/fotos/orden`, { cuerpo: { ids: listas.flatMap((x) => x.ids) } });
    } catch (e) { aviso.error(e); }
    await recargar();
  }
  const mover = (g: Grupo, i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= g.fotos.length) return;
    // Hacia adelante hay que caer después del vecino: o sea, antes del que le sigue.
    void soltar(g.fotos[i]!.id, g, delta < 0 ? g.fotos[j]!.id : g.fotos[j + 1]?.id ?? null);
  };
  const borrar = async (id: number) => {
    if (!confirm("¿Borrar esta foto?")) return;
    try { await api(`fotos/${id}`, { metodo: "DELETE" }); await recargar(); } catch (e) { aviso.error(e); }
  };

  // Un grupo por color (con TODAS sus fotos, de prenda sola o con modelo) y uno de generales, sin color.
  type Grupo = { titulo: string; tipo: "color" | "exhibicion"; color: number | null; fotos: Detalle["fotos"]; lleno: boolean };
  const enOrden = [...d.fotos].sort((a, b) => a.orden - b.orden || a.id - b.id);
  const activos = d.colores.filter((c) => c.activo);
  const grupos: Grupo[] = [
    { titulo: "Generales (sin color)", tipo: "exhibicion", color: null, fotos: enOrden.filter((f) => f.colorId === null || !activos.some((c) => c.id === f.colorId)), lleno: false },
    ...activos.map((c) => {
      const fotos = enOrden.filter((f) => f.colorId === c.id);
      return { titulo: `Color ${c.nombre}`, tipo: "color" as const, color: c.id, fotos, lleno: fotos.filter((f) => f.tipo === "color").length >= 5 };
    }),
  ];
  const [arrastrada, setArrastrada] = useState<number | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  const alSoltar = (e: DragEvent, g: Grupo, antesDe: number | null) => {
    e.preventDefault(); e.stopPropagation();
    const id = arrastrada;
    setArrastrada(null); setSobre(null);
    if (id !== null) void soltar(id, g, antesDe);
  };

  return (
    <Tarjeta titulo="Fotos" acciones={<Insignia clase={total >= d.topeFotos ? "bg-amber-50 text-amber-800" : undefined}>{total} de {d.topeFotos}</Insignia>}>
      <input ref={entrada} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple hidden onChange={(e) => void subir(e.target.files)} />
      {subiendo && <p className="mb-3 text-sm font-bold text-marca" role="status">{subiendo}</p>}
      <div className="space-y-5">
        {grupos.map((g) => (
          <div key={g.titulo} className={`rounded-lg p-2 ${arrastrada !== null ? "outline-dashed outline-1 outline-gray-300" : ""} ${sobre === g.titulo ? "bg-fondo-suave" : ""}`}
            onDragOver={(e) => { if (arrastrada !== null) { e.preventDefault(); setSobre(g.titulo); } }} onDrop={(e) => alSoltar(e, g, null)}>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold">{g.titulo} <span className="font-normal text-tinta-tenue">({g.fotos.length})</span></h3>
              {operador && <Boton variante="borde" className="py-1.5" disabled={!!subiendo || total >= d.topeFotos || g.lleno} onClick={() => elegir(g.tipo, g.color)}>+ Subir</Boton>}
            </div>
            {g.fotos.length ? (
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {g.fotos.map((f, i) => (
                  <li key={f.id} draggable={operador} onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; setArrastrada(f.id); }} onDragEnd={() => { setArrastrada(null); setSobre(null); }}
                    onDrop={(e) => alSoltar(e, g, f.id)}
                    className={`group relative aspect-[4/5] overflow-hidden rounded-lg bg-fondo-suave ${operador ? "cursor-grab" : ""} ${arrastrada === f.id ? "opacity-40" : ""}`}>
                    <img src={fotoUrl(f.clave)} alt={f.alt ?? ""} draggable={false} className="size-full object-cover" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
                    {operador && (
                      <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/55 p-1 text-white opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                        <button type="button" className="px-1.5" aria-label="Mover antes" disabled={i === 0} onClick={() => mover(g, i, -1)}>←</button>
                        <button type="button" className="px-1.5 text-xs font-bold" onClick={() => void borrar(f.id)}>Borrar</button>
                        <button type="button" className="px-1.5" aria-label="Mover después" disabled={i === g.fotos.length - 1} onClick={() => mover(g, i, 1)}>→</button>
                      </div>
                    )}
                    {i === 0 && <span className="absolute left-1 top-1 rounded bg-white/90 px-1.5 text-[10px] font-bold">Principal</span>}
                  </li>
                ))}
              </ul>
            ) : <p className="text-xs text-tinta-tenue">{arrastrada !== null ? "Soltala acá." : "Sin fotos."}</p>}
          </div>
        ))}
      </div>
      {operador && <p className="mt-4 text-xs text-tinta-tenue">Arrastrá una foto para cambiarla de lugar o pasarla a otro color. En el celular, usá las flechas.</p>}
      <p className="mt-1 text-xs text-tinta-tenue">JPG, PNG, WEBP o HEIC (del iPhone) de hasta 25 MB. Se convierten solas a los tamaños de la tienda.</p>
    </Tarjeta>
  );
}
