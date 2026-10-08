"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import {
  CLAVES_MEDIDA, MEDIDA_LIBRE, TALLES_ADULTO, TALLES_NINO, TALLES_NINO_HABITUALES, infoMedida, normalizarTalle, tallesDeTipo,
  type TipoGuia,
} from "@isu/shared";
import { api, fotoUrl, useDatos } from "@/lib/api";
import { Boton, Campo, Cargando, claseEntrada, Insignia, Mensaje, Paginador, Tarjeta, Titulo, useAviso } from "@/components/ui";
import { puede, useYo } from "@/components/Marco";

/*
 * Editor de una guía de talles: tipo (niños 4–16 o adulto XS–5XL), qué
 * medidas muestra, qué talles tiene y un rango en cm por celda (desde–hasta;
 * si es un solo número, se deja "hasta" vacío). Abajo, los productos
 * asociados y el buscador para asociar más: por defecto sólo ofrece los que
 * "coinciden" (todos sus talles están en la guía).
 *
 * Etapa 10: tipo "Talles propios" (1 a 8 de pantalón, "3 (L)"…: se escriben
 * y quedan en ese orden) y medidas con nombre propio ("Ancho muslo"), que
 * sólo se muestran. También se cargan desde Excel (Guías de talles → Importar).
 */
type Celda = [string, string];
interface Guardada { id: number; slug: string; nombre: string; tipo: TipoGuia; medidas: string[]; filas: Array<{ talle: string; valores: Array<[number, number] | null> }>; nota: string | null }
interface Asociado { id: number; nombre: string; sku: string; slug: string; visible: boolean; talles: string[]; coincide: boolean }
interface Candidato { id: number; nombre: string; sku: string; visible: boolean; foto: string | null; talles: string[]; coincide: boolean; guiaActual: { id: number; nombre: string } | null }

const PREDETERMINADAS: Record<TipoGuia, string[]> = { adulto: ["pecho", "cintura", "cadera", "largo"], nino: ["altura", "edad", "pecho", "cintura"], otro: ["ancho", "largo"] };
const INICIALES: Record<TipoGuia, readonly string[]> = { adulto: ["XS", "S", "M", "L", "XL", "XXL"], nino: TALLES_NINO_HABITUALES, otro: ["1", "2", "3", "4", "5"] };
const numero = (s: string) => { const n = Number(s.replace(",", ".")); return s.trim() !== "" && Number.isFinite(n) ? n : null; };

export default function EditorGuia({ params }: { params: Promise<{ slug: string }> }) {
  // La dirección lleva el nombre de la guía (/guias-talles/remera-regular-adulto), no el id. Las viejas (/guias-talles/12) se pasan a la nueva.
  const { slug } = use(params);
  const nueva = slug === "nueva";
  const router = useRouter();
  const yo = useYo();
  const operador = puede(yo, "operador");
  const { datos, error, recargar } = useDatos<{ guia: Guardada; productos: Asociado[] }>(nueva ? null : /^\d+$/.test(slug) ? `guias-talles/${slug}` : `guias-talles/s/${slug}`);
  const id = datos?.guia.id;
  useEffect(() => { if (datos && datos.guia.slug !== slug) router.replace(`/guias-talles/${datos.guia.slug}`); }, [datos, slug, router]);
  const aviso = useAviso();

  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState<TipoGuia>("adulto");
  const [medidas, setMedidas] = useState<string[]>(PREDETERMINADAS.adulto);
  const [talleNuevo, setTalleNuevo] = useState("");
  const [medidaNueva, setMedidaNueva] = useState("");
  const [talles, setTalles] = useState<string[]>([...INICIALES.adulto]);
  const [celdas, setCeldas] = useState<Record<string, Partial<Record<string, Celda>>>>({});
  const [nota, setNota] = useState("Medidas del cuerpo, en centímetros.");
  const [errores, setErrores] = useState<string[]>([]);

  useEffect(() => {
    if (!datos) return;
    const g = datos.guia;
    setNombre(g.nombre); setTipo(g.tipo); setMedidas(g.medidas); setNota(g.nota ?? "");
    setTalles(g.filas.map((f) => f.talle));
    setCeldas(Object.fromEntries(g.filas.map((f) => [f.talle, Object.fromEntries(g.medidas.map((m, i) => {
      const v = f.valores[i];
      return [m, v ? [String(v[0]), v[1] === v[0] ? "" : String(v[1])] : ["", ""]];
    }))])));
  }, [datos]);

  if (!nueva && error) return <Mensaje>{error}</Mensaje>;
  if (!nueva && !datos) return <Cargando />;

  const libre = tipo === "otro";
  // Talles propios: los que se escribieron, en ese orden. Si no, los de la escala.
  const escala = libre ? talles : tallesDeTipo(tipo);
  const filas = escala.filter((t) => talles.includes(t));
  const propias = medidas.filter((m) => !(CLAVES_MEDIDA as readonly string[]).includes(m));
  function agregarTalle() {
    const t = talleNuevo.trim().slice(0, 10);
    if (!t || talles.some((x) => normalizarTalle(x) === normalizarTalle(t))) { setTalleNuevo(""); return; }
    setTalles((ts) => [...ts, t]); setTalleNuevo("");
  }
  function agregarMedida() {
    const m = medidaNueva.replace(/\s+/g, " ").trim().slice(0, 40);
    if (!m) return;
    if (!MEDIDA_LIBRE.test(m)) { aviso.error(new Error("El nombre de la medida lleva letras y números (por ejemplo: Ancho muslo).")); return; }
    if (medidas.length >= 8) { aviso.error(new Error("Como mucho 8 medidas por guía.")); return; }
    if (!medidas.some((x) => x.toLowerCase() === m.toLowerCase())) setMedidas((ms) => [...ms, m]);
    setMedidaNueva("");
  }
  const poner = (talle: string, m: string, i: 0 | 1, v: string) =>
    setCeldas((c) => { const fila = { ...(c[talle] ?? {}) }; const celda: Celda = [...(fila[m] ?? ["", ""])] as Celda; celda[i] = v.replace(/[^\d.,]/g, "").slice(0, 5); fila[m] = celda; return { ...c, [talle]: fila }; });

  function cambiarTipo(t: TipoGuia) {
    if (t === tipo) return;
    if (filas.length && Object.keys(celdas).length && !confirm("Cambiar el tipo borra los talles cargados. ¿Seguir?")) return;
    setTipo(t); setTalles([...INICIALES[t]]); setMedidas(PREDETERMINADAS[t]); setCeldas({});
  }

  async function guardar() {
    const problemas: string[] = [];
    if (nombre.trim().length < 2) problemas.push("Poné un nombre (por ejemplo: Remera regular adulto).");
    if (!medidas.length) problemas.push("Elegí al menos una medida.");
    if (!filas.length) problemas.push("Elegí al menos un talle.");
    const cuerpo = {
      nombre: nombre.trim(), tipo, medidas, nota: nota.trim() || null,
      filas: filas.map((t) => ({
        talle: t,
        valores: medidas.map((m) => {
          const [a, b] = celdas[t]?.[m] ?? ["", ""];
          const desde = numero(a), hasta = numero(b);
          if (desde === null && hasta === null) return null;
          const r: [number, number] = [desde ?? hasta!, hasta ?? desde!];
          if (r[1] < r[0]) problemas.push(`Talle ${t}, ${infoMedida(m).nombre}: "hasta" es menor que "desde".`);
          return r;
        }),
      })),
    };
    if (filas.length && cuerpo.filas.every((f) => f.valores.every((v) => v === null))) problemas.push("Cargá las medidas de al menos un talle.");
    setErrores(problemas);
    if (problemas.length) return;
    try {
      if (nueva) {
        const r = await api<{ id: number; slug: string }>("guias-talles", { cuerpo });
        router.replace(`/guias-talles/${r.slug}`);
      } else {
        const r = await api<{ slug: string }>(`guias-talles/${id}`, { metodo: "PUT", cuerpo });
        // Con otro nombre, otra dirección.
        if (r.slug !== slug) router.replace(`/guias-talles/${r.slug}`);
        aviso.ok("Guía guardada. Las fichas de sus productos se actualizan solas.");
        await recargar();
      }
    } catch (e) { aviso.error(e); }
  }

  async function borrar() {
    if (!confirm(`¿Borrar la guía "${nombre}"? Sus ${datos?.productos.length ?? 0} productos quedan sin guía.`)) return;
    try { await api(`guias-talles/${id}`, { metodo: "DELETE" }); router.replace("/guias-talles"); } catch (e) { aviso.error(e); }
  }

  return (
    <>
      <p className="mb-2 text-sm"><Link href="/guias-talles" className="text-marca hover:underline">← Guías de talles</Link></p>
      <Titulo acciones={operador && <>
        {!nueva && <Boton variante="peligro" onClick={() => void borrar()}>Borrar</Boton>}
        <Boton onClick={() => void guardar()}>{nueva ? "Crear guía" : "Guardar guía"}</Boton>
      </>}>{nueva ? "Nueva guía de talles" : nombre}</Titulo>
      <div className="mb-4 space-y-2"><aviso.Aviso />{errores.map((e) => <Mensaje key={e}>{e}</Mensaje>)}</div>

      <div className="space-y-6">
        <Tarjeta>
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
            <Campo etiqueta="Nombre" ayuda="Para encontrarla vos. El cliente lo ve chiquito arriba de la tabla.">
              <input className={claseEntrada} maxLength={80} disabled={!operador} value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Remera regular adulto" />
            </Campo>
            <div className="text-sm">
              <span className="font-bold">Tipo</span>
              <div className="mt-1 inline-flex rounded-full border border-linea bg-white p-1">
                {([["adulto", "Adulto (XS a 5XL)"], ["nino", "Niños (4 a 16)"], ["otro", "Talles propios"]] as const).map(([k, t]) => (
                  <button key={k} type="button" disabled={!operador} aria-pressed={tipo === k} onClick={() => cambiarTipo(k)}
                    className={`rounded-full px-4 py-1.5 font-bold ${tipo === k ? "bg-tinta text-white" : "text-tinta-suave"}`}>{t}</button>
                ))}
              </div>
            </div>
          </div>

          <fieldset className="mt-5">
            <legend className="text-sm font-bold">Talles de la guía</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {escala.map((t) => (
                <button key={t} type="button" disabled={!operador} aria-pressed={talles.includes(t)} onClick={() => setTalles((ts) => (ts.includes(t) ? ts.filter((x) => x !== t) : [...ts, t]))}
                  title={libre ? "Tocá para sacarlo" : undefined}
                  className={`min-w-12 rounded-full border px-3 py-1.5 text-sm font-bold ${talles.includes(t) ? "border-tinta bg-tinta text-white" : "border-linea bg-white"}`}>{t}{libre && <span aria-hidden="true" className="ml-1 opacity-60">×</span>}</button>
              ))}
              {libre && operador && (
                <span className="inline-flex gap-1">
                  <input className="w-28 rounded-full border border-linea px-3 py-1.5 text-sm" maxLength={10} placeholder="Talle (ej: 3 (L))" aria-label="Talle nuevo" value={talleNuevo}
                    onChange={(e) => setTalleNuevo(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); agregarTalle(); } }} />
                  <Boton variante="borde" className="py-1.5" onClick={agregarTalle}>Agregar</Boton>
                </span>
              )}
            </div>
            {libre && <p className="mt-1 text-xs text-tinta-tenue">Se muestran en el orden en que los agregás.</p>}
            {tipo === "nino" && <p className="mt-1 text-xs text-tinta-tenue">Los habituales son los pares; si alguna prenda viene en impares, sumalos.</p>}
          </fieldset>

          <fieldset className="mt-5">
            <legend className="text-sm font-bold">Medidas que muestra</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {[...CLAVES_MEDIDA, ...propias].map((m) => (
                <button key={m} type="button" disabled={!operador || (!medidas.includes(m) && medidas.length >= 8)} aria-pressed={medidas.includes(m)} title={infoMedida(m).ayuda || undefined}
                  onClick={() => setMedidas((ms) => (ms.includes(m) ? ms.filter((x) => x !== m) : [...ms, m]))}
                  className={`rounded-full border px-3 py-1.5 text-sm ${medidas.includes(m) ? "border-marca bg-marca-claro font-bold text-marca-fuerte" : "border-linea bg-white"}`}>
                  {infoMedida(m).nombre} <span className="text-xs font-normal text-tinta-tenue">{infoMedida(m).tipo === "cuerpo" ? "cuerpo" : "prenda"}</span>
                </button>
              ))}
              {operador && (
                <span className="inline-flex gap-1">
                  <input className="w-44 rounded-full border border-linea px-3 py-1.5 text-sm" maxLength={40} placeholder="Medida propia (ej: Ancho muslo)" aria-label="Medida nueva" value={medidaNueva}
                    onChange={(e) => setMedidaNueva(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); agregarMedida(); } }} />
                  <Boton variante="borde" className="py-1.5" onClick={agregarMedida}>Agregar</Boton>
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-tinta-tenue">Las del cuerpo sirven para recomendarle el talle al cliente según sus medidas. Las de la prenda (y las propias) sólo se muestran. Se muestran en el orden en que las elegís.</p>
          </fieldset>
        </Tarjeta>

        <Tarjeta titulo="Medidas por talle (cm)">
          {!filas.length || !medidas.length ? <p className="text-sm text-tinta-tenue">Elegí talles y medidas arriba.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-max text-sm">
                <thead><tr className="text-left text-tinta-tenue">
                  <th className="py-2 pr-3">Talle</th>
                  {medidas.map((m) => <th key={m} className="px-2 py-2">{infoMedida(m).nombre}<span className="block text-xs font-normal">desde – hasta{m === "edad" ? " (años)" : ""}</span></th>)}
                </tr></thead>
                <tbody className="divide-y divide-linea">
                  {filas.map((t) => (
                    <tr key={t}>
                      <th scope="row" className="py-2 pr-3 text-left text-base">{t}</th>
                      {medidas.map((m) => {
                        const [a, b] = celdas[t]?.[m] ?? ["", ""];
                        return (
                          <td key={m} className="px-2 py-2">
                            <span className="flex items-center gap-1">
                              <input aria-label={`${t} ${infoMedida(m).nombre} desde`} inputMode="decimal" disabled={!operador} className="w-16 rounded-lg border border-linea px-2 py-1.5 text-center" value={a} onChange={(e) => poner(t, m, 0, e.target.value)} />
                              <span className="text-tinta-tenue">–</span>
                              <input aria-label={`${t} ${infoMedida(m).nombre} hasta`} inputMode="decimal" disabled={!operador} className="w-16 rounded-lg border border-linea px-2 py-1.5 text-center" value={b} onChange={(e) => poner(t, m, 1, e.target.value)} placeholder={a} />
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Campo etiqueta="Nota para el cliente" className="mt-4" ayuda="Se muestra debajo de la tabla.">
            <input className={claseEntrada} maxLength={500} disabled={!operador} value={nota} onChange={(e) => setNota(e.target.value)} />
          </Campo>
        </Tarjeta>

        {!nueva && datos && <Asociar guiaId={datos.guia.id} tipo={datos.guia.tipo} tallesGuia={datos.guia.filas.map((f) => f.talle)} asociados={datos.productos} operador={operador} alCambiar={recargar} aviso={aviso} />}
        {nueva && <Mensaje tipo="info">Después de crearla vas a poder asociarle productos.</Mensaje>}
      </div>
    </>
  );
}

function Asociar({ guiaId, tipo, tallesGuia, asociados, operador, alCambiar, aviso }: {
  guiaId: number; tipo: TipoGuia; tallesGuia: string[]; asociados: Asociado[]; operador: boolean; alCambiar: () => Promise<void>; aviso: ReturnType<typeof useAviso>;
}) {
  const [q, setQ] = useState("");
  const [buscado, setBuscado] = useState("");
  const [solo, setSolo] = useState<"coinciden" | "sin_guia" | "todos">("coinciden");
  const [pagina, setPagina] = useState(1);
  const [elegidos, setElegidos] = useState<Set<number>>(new Set());
  const [quitar, setQuitar] = useState<Set<number>>(new Set());
  const { datos, cargando, recargar } = useDatos<{ productos: Candidato[]; total: number; porPagina: number }>(`guias-talles/${guiaId}/candidatos`, { q: buscado, solo, pagina });
  const guia = new Set(tallesGuia.map(normalizarTalle));
  const escala = new Set<string>(tipo === "nino" ? TALLES_NINO : tipo === "adulto" ? TALLES_ADULTO : tallesGuia.map(normalizarTalle));
  const libres = (datos?.productos ?? []).filter((p) => p.guiaActual?.id !== guiaId);

  async function aplicar(agregar: number[], sacar: number[]) {
    try {
      const r = await api<{ cambiados: number }>(`guias-talles/${guiaId}/productos`, { cuerpo: { agregar, quitar: sacar } });
      aviso.ok(`${r.cambiados} productos actualizados.`);
      setElegidos(new Set()); setQuitar(new Set());
      await Promise.all([alCambiar(), recargar()]);
    } catch (e) { aviso.error(e); }
  }
  const alternar = (s: Set<number>, id: number) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; };
  const Talles = ({ ts }: { ts: string[] }) => (
    <span className="flex flex-wrap gap-1">{ts.map((t) => {
      const n = normalizarTalle(t);
      return <span key={t} className={`rounded px-1.5 text-xs ${guia.has(n) ? "bg-ahorro-claro text-ahorro" : escala.has(n) ? "bg-amber-50 text-amber-800" : "bg-red-50 text-oferta"}`} title={guia.has(n) ? "Está en la guía" : "No está en la guía"}>{t}</span>;
    })}</span>
  );

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Tarjeta titulo={`Productos con esta guía (${asociados.length})`} acciones={operador && quitar.size > 0 && <Boton variante="peligro" onClick={() => void aplicar([], [...quitar])}>Quitar {quitar.size}</Boton>}>
        {!asociados.length ? <p className="text-sm text-tinta-tenue">Ninguno todavía. Asocialos desde el buscador.</p> : (
          <ul className="max-h-[520px] divide-y divide-linea overflow-y-auto text-sm">
            {asociados.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2">
                {operador && <input type="checkbox" aria-label={`Quitar ${p.nombre}`} checked={quitar.has(p.id)} onChange={() => setQuitar((s) => alternar(s, p.id))} />}
                <span className="min-w-0 flex-1"><Link href={`/productos/${p.slug}`} className="font-bold hover:underline">{p.nombre}</Link> <span className="text-xs text-tinta-tenue">{p.sku}</span><Talles ts={p.talles} /></span>
                {!p.coincide && <Insignia clase="bg-amber-50 text-amber-800">Talles distintos</Insignia>}
              </li>
            ))}
          </ul>
        )}
      </Tarjeta>

      <Tarjeta titulo="Asociar productos">
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); setBuscado(q); setPagina(1); }}>
          <input className={`${claseEntrada} min-w-0 flex-1`} placeholder="Buscar por nombre o artículo" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar productos" />
          <select className={`${claseEntrada} max-w-72`} value={solo} onChange={(e) => { setSolo(e.target.value as typeof solo); setPagina(1); }} aria-label="Mostrar">
            <option value="coinciden">Que coinciden con los talles</option>
            <option value="sin_guia">Sin guía</option>
            <option value="todos">Todos</option>
          </select>
        </form>
        <p className="mt-2 text-xs text-tinta-tenue"><span className="rounded bg-ahorro-claro px-1 text-ahorro">verde</span> talle en la guía · <span className="rounded bg-amber-50 px-1 text-amber-800">amarillo</span> falta en la guía · <span className="rounded bg-red-50 px-1 text-oferta">rojo</span> {tipo === "otro" ? "no está en la guía" : `no es de ${tipo === "nino" ? "niños" : "adulto"}`}</p>
        {operador && libres.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Boton variante="borde" className="py-1.5" onClick={() => setElegidos(new Set(libres.map((p) => p.id)))}>Elegir los {libres.length} de esta página</Boton>
            {elegidos.size > 0 && <Boton className="py-1.5" onClick={() => void aplicar([...elegidos], [])}>Asociar {elegidos.size}</Boton>}
          </div>
        )}
        {cargando && !datos ? <Cargando /> : (
          <ul className="mt-3 max-h-[520px] divide-y divide-linea overflow-y-auto text-sm">
            {(datos?.productos ?? []).map((p) => {
              const ya = p.guiaActual?.id === guiaId;
              return (
                <li key={p.id} className="flex items-center gap-3 py-2">
                  {operador && <input type="checkbox" disabled={ya} aria-label={`Elegir ${p.nombre}`} checked={ya || elegidos.has(p.id)} onChange={() => setElegidos((s) => alternar(s, p.id))} />}
                  <span className="size-10 shrink-0 overflow-hidden rounded bg-fondo-suave">{p.foto && <img src={fotoUrl(p.foto)} alt="" className="size-full object-cover" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="font-bold">{p.nombre}</span> <span className="text-xs text-tinta-tenue">{p.sku}</span>
                    <Talles ts={p.talles} />
                    {p.guiaActual && !ya && <span className="text-xs text-amber-800">Hoy tiene: {p.guiaActual.nombre} (se reemplaza)</span>}
                  </span>
                  {ya && <Insignia clase="bg-ahorro-claro text-ahorro">Asociado</Insignia>}
                </li>
              );
            })}
            {datos && !datos.productos.length && <li className="py-6 text-center text-tinta-tenue">{solo === "coinciden" ? "Ningún producto tiene todos sus talles en esta guía. Probá con \"Todos\"." : "No hay resultados."}</li>}
          </ul>
        )}
        {datos && <Paginador pagina={pagina} total={datos.total} porPagina={datos.porPagina} onCambiar={setPagina} />}
      </Tarjeta>
    </div>
  );
}
