"use client";
import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, fecha, useDatos } from "@/lib/api";
import { Boton, Cargando, claseEntrada, Insignia, Mensaje, Paginador, Tarjeta, Titulo, useAviso } from "@/components/ui";
import { puede, useYo } from "@/components/Marco";

/*
 * Reseñas de las compras entregadas (etapa 8). Entran pendientes: se
 * publican, se rechazan o se responden. Rechazar es para lo que no se puede
 * mostrar (insultos, datos personales, algo que no es de la compra), no para
 * esconder las malas: una tienda con todas 5 estrellas no es creíble, y la
 * respuesta de la tienda a una mala opinión vende más que esconderla.
 */
interface Resena {
  id: number; estrellas: number; texto: string | null; calce: string | null; talle: string | null; color: string | null; nombre: string;
  estado: "pendiente" | "publicada" | "rechazada"; respuesta: string | null; creadoEn: string; moderadaPor: string | null; moderadaEn: string | null;
  pedido: string; productoId: number | null; producto: string | null; slug: string | null;
}
const ESTADOS: Array<[string, string]> = [["pendiente", "Por revisar"], ["publicada", "Publicadas"], ["rechazada", "Rechazadas"], ["todas", "Todas"]];
const CALCE: Record<string, string> = { chico: "le quedó chico", justo: "talle justo", grande: "le quedó grande" };
const SITIO = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");

function Resenas() {
  const yo = useYo();
  const operador = puede(yo, "operador");
  const sp = useSearchParams();
  const router = useRouter();
  const estado = sp.get("estado") ?? "pendiente";
  const pagina = Number(sp.get("pagina") ?? 1) || 1;
  const [q, setQ] = useState(sp.get("q") ?? "");
  const { datos, error, recargar } = useDatos<{ resenas: Resena[]; total: number; porPagina: number; cuentas: Record<string, number> }>("resenas", { estado, pagina, q: sp.get("q") });
  const [respondiendo, setRespondiendo] = useState<{ id: number; texto: string } | null>(null);
  const [elegidas, setElegidas] = useState<Set<number>>(new Set());
  const aviso = useAviso();
  const ir = (cambios: Record<string, string | null>) => {
    const u = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(cambios)) { if (v) u.set(k, v); else u.delete(k); }
    setElegidas(new Set());
    router.push(`/resenas?${u}`);
  };

  async function cambiar(r: Resena, cuerpo: { estado?: string; respuesta?: string | null }, texto: string) {
    try { await api(`resenas/${r.id}`, { metodo: "PATCH", cuerpo }); aviso.ok(texto); setRespondiendo(null); await recargar(); } catch (e) { aviso.error(e); }
  }
  async function masivo(nuevo: "publicada" | "rechazada") {
    try {
      const r = await api<{ cambiadas: number }>("resenas/masivo", { cuerpo: { ids: [...elegidas], estado: nuevo } });
      aviso.ok(`${r.cambiadas} ${nuevo === "publicada" ? "publicadas" : "rechazadas"}`); setElegidas(new Set()); await recargar();
    } catch (e) { aviso.error(e); }
  }

  if (error) return <Mensaje>{error}</Mensaje>;
  if (!datos) return <Cargando />;
  return (
    <>
      <Titulo>Reseñas</Titulo>
      <p className="-mt-2 mb-5 max-w-3xl text-sm text-tinta-suave">
        Llegan de compras entregadas (el mail se manda solo a los días de entregado; se ajusta en <Link href="/ajustes" className="text-marca hover:underline">Ajustes → Reseñas</Link>).
        Rechazá sólo lo que no se puede publicar (insultos, datos personales); a una mala, mejor respondele.
      </p>
      <aviso.Aviso />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {ESTADOS.map(([k, t]) => (
          <button key={k} type="button" onClick={() => ir({ estado: k, pagina: null })} aria-pressed={estado === k}
            className={`rounded-full px-4 py-1.5 text-sm font-bold ${estado === k ? "bg-tinta text-white" : "bg-fondo-suave hover:bg-linea"}`}>
            {t}{k !== "todas" && datos.cuentas[k] ? ` (${datos.cuentas[k]})` : ""}
          </button>
        ))}
        <form className="ml-auto flex gap-2" onSubmit={(e) => { e.preventDefault(); ir({ q: q || null, pagina: null }); }}>
          <input className={`${claseEntrada} w-56`} placeholder="Texto, nombre, pedido o prenda" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" />
          <Boton variante="borde" type="submit">Buscar</Boton>
        </form>
      </div>
      {operador && elegidas.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl bg-marca-claro p-3 text-sm">
          <b>{elegidas.size} elegidas</b>
          <Boton onClick={() => void masivo("publicada")}>Publicar</Boton>
          <Boton variante="borde" onClick={() => void masivo("rechazada")}>Rechazar</Boton>
        </div>
      )}
      <ul className="space-y-3">
        {datos.resenas.map((r) => (
          <li key={r.id}>
            <Tarjeta>
              <div className="flex gap-3">
                {operador && r.estado === "pendiente" && (
                  <input type="checkbox" className="mt-1 size-4" aria-label={`Elegir la reseña de ${r.nombre}`} checked={elegidas.has(r.id)}
                    onChange={() => setElegidas((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-lg tracking-wider text-estrella" aria-label={`${r.estrellas} de 5`}>{"★".repeat(r.estrellas)}<span className="text-linea">{"★".repeat(5 - r.estrellas)}</span></span>
                    <b>{r.nombre}</b>
                    <Insignia clase={r.estado === "publicada" ? "bg-ahorro-claro text-ahorro" : r.estado === "rechazada" ? "bg-red-50 text-oferta" : "bg-marca-claro text-marca-fuerte"}>
                      {r.estado === "pendiente" ? "Por revisar" : r.estado === "publicada" ? "Publicada" : "Rechazada"}
                    </Insignia>
                    <span className="text-sm text-tinta-tenue">{fecha(r.creadoEn)} · <Link href={`/pedidos/${r.pedido}`} className="hover:underline">{r.pedido}</Link></span>
                  </div>
                  <p className="mt-1 text-sm">
                    {r.producto
                      ? <>{r.slug ? <a href={`${SITIO}/producto/${r.slug}#opiniones`} target="_blank" rel="noreferrer" className="font-bold text-marca hover:underline">{r.producto}</a> : <b>{r.producto}</b>}{[r.color, r.talle && `talle ${r.talle}`, r.calce && CALCE[r.calce]].filter(Boolean).map((x) => ` · ${x}`).join("")}</>
                      : <b>Sobre la compra en general</b>}
                  </p>
                  {r.texto ? <p className="mt-2 whitespace-pre-line">{r.texto}</p> : <p className="mt-2 text-sm italic text-tinta-tenue">Sólo estrellas, sin texto.</p>}
                  {r.respuesta && respondiendo?.id !== r.id && (
                    <div className="mt-3 rounded-xl bg-fondo-suave p-3 text-sm"><b>Respuesta de la tienda:</b> <span className="whitespace-pre-line">{r.respuesta}</span></div>
                  )}
                  {respondiendo?.id === r.id && (
                    <div className="mt-3">
                      <textarea className={`${claseEntrada} min-h-24`} maxLength={1000} value={respondiendo.texto} onChange={(e) => setRespondiendo({ id: r.id, texto: e.target.value })}
                        placeholder="¡Gracias por contarnos! …" aria-label="Respuesta" />
                      <div className="mt-2 flex gap-2">
                        <Boton onClick={() => void cambiar(r, { respuesta: respondiendo.texto.trim() || null }, respondiendo.texto.trim() ? "Respuesta guardada" : "Respuesta borrada")}>Guardar respuesta</Boton>
                        <Boton variante="borde" onClick={() => setRespondiendo(null)}>Cancelar</Boton>
                      </div>
                    </div>
                  )}
                  {operador && respondiendo?.id !== r.id && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {r.estado !== "publicada" && <Boton onClick={() => void cambiar(r, { estado: "publicada" }, "Publicada: ya se ve en la tienda")}>Publicar</Boton>}
                      {r.estado !== "rechazada" && <Boton variante="borde" onClick={() => void cambiar(r, { estado: "rechazada" }, "Rechazada")}>Rechazar</Boton>}
                      <Boton variante="borde" onClick={() => setRespondiendo({ id: r.id, texto: r.respuesta ?? "" })}>{r.respuesta ? "Editar respuesta" : "Responder"}</Boton>
                    </div>
                  )}
                  {r.moderadaPor && <p className="mt-2 text-xs text-tinta-tenue">Revisada por {r.moderadaPor} el {fecha(r.moderadaEn)}</p>}
                </div>
              </div>
            </Tarjeta>
          </li>
        ))}
        {!datos.resenas.length && <li className="rounded-2xl border border-dashed border-linea p-10 text-center text-tinta-tenue">{estado === "pendiente" ? "No hay reseñas por revisar." : "No hay reseñas con ese filtro."}</li>}
      </ul>
      <Paginador pagina={pagina} total={datos.total} porPagina={datos.porPagina} onCambiar={(p) => ir({ pagina: String(p) })} />
    </>
  );
}

export default function Pagina() { return <Suspense fallback={<Cargando />}><Resenas /></Suspense>; }
