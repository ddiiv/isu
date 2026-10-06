"use client";
import { useState } from "react";
import { api, useDatos } from "@/lib/api";
import { Boton, Campo, Cargando, Casilla, claseEntrada, Insignia, Mensaje, Tarjeta, Titulo, useAviso } from "@/components/ui";
import { puede, useYo } from "@/components/Marco";

/*
 * Portada (etapa 8): los banners del carrusel del inicio. Cada uno con su
 * foto para compu (apaisada, ej. 1920 × 800) y, si se quiere, otra para
 * celular (vertical, ej. 1080 × 1350: si no hay, el celular usa la de compu).
 * Sin banners activos, el inicio muestra el título grande de siempre.
 */
interface Banner {
  id: number; alt: string; enlace: string | null; foto: string | null; fotoAncho: number | null; fotoAlto: number | null;
  fotoMovil: string | null; orden: number; activo: boolean; desde: string | null; hasta: string | null;
}
const CDN = (process.env.NEXT_PUBLIC_CDN_IMAGENES ?? "").split(",")[0]?.trim() || "/fotos";
const url = (clave: string) => `${CDN.replace(/\/+$/, "")}/${clave}-800.webp`;
const aLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");
const deLocal = (v: string) => (v ? new Date(v).toISOString() : null);
const vigente = (b: Banner) => b.activo && !!b.foto && (!b.desde || new Date(b.desde) <= new Date()) && (!b.hasta || new Date(b.hasta) > new Date());

export default function Portada() {
  const yo = useYo();
  const operador = puede(yo, "operador");
  const { datos, error, recargar } = useDatos<{ banners: Banner[] }>("banners");
  const [nuevo, setNuevo] = useState({ alt: "", enlace: "" });
  const [subiendo, setSubiendo] = useState<string | null>(null);
  const aviso = useAviso();
  if (error) return <Mensaje>{error}</Mensaje>;
  if (!datos) return <Cargando />;

  async function crear() {
    try {
      await api("banners", { cuerpo: { alt: nuevo.alt, enlace: nuevo.enlace.trim() || null, orden: (datos!.banners.at(-1)?.orden ?? 0) + 1 } });
      setNuevo({ alt: "", enlace: "" }); aviso.ok("Banner creado: ahora subile la foto."); await recargar();
    } catch (e) { aviso.error(e); }
  }
  async function cambiar(b: Banner, cuerpo: Record<string, unknown>, texto = "Guardado") {
    try { await api(`banners/${b.id}`, { metodo: "PATCH", cuerpo }); aviso.ok(texto); await recargar(); } catch (e) { aviso.error(e); }
  }
  async function subir(b: Banner, tipo: "escritorio" | "movil", archivo: File | undefined) {
    if (!archivo) return;
    setSubiendo(`${b.id}-${tipo}`);
    try { await api(`banners/${b.id}/foto?tipo=${tipo}`, { archivo }); aviso.ok("Foto subida."); await recargar(); }
    catch (e) { aviso.error(e); } finally { setSubiendo(null); }
  }
  async function borrar(b: Banner) {
    if (!confirm(`¿Borrar el banner «${b.alt}»? Se borran también sus fotos.`)) return;
    try { await api(`banners/${b.id}`, { metodo: "DELETE" }); aviso.ok("Banner borrado."); await recargar(); } catch (e) { aviso.error(e); }
  }
  async function sacarMovil(b: Banner) {
    try { await api(`banners/${b.id}/foto-movil`, { metodo: "DELETE" }); aviso.ok("Ahora el celular usa la foto de compu."); await recargar(); } catch (e) { aviso.error(e); }
  }

  const ordenados = [...datos.banners].sort((a, b) => a.orden - b.orden || a.id - b.id);
  return (
    <>
      <Titulo>Portada</Titulo>
      <p className="-mt-2 mb-5 max-w-3xl text-sm text-tinta-suave">
        El carrusel de arriba del inicio. Pasa solo cada 6 segundos. Foto para compu apaisada (ej. 1920 × 800 px) y, opcional, una vertical para celular
        (ej. 1080 × 1350). Si no hay ninguno activo, el inicio muestra el título grande.
      </p>
      <aviso.Aviso />
      {operador && (
        <Tarjeta titulo="Banner nuevo" className="mb-5">
          <div className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
            <Campo etiqueta="Qué se ve en la foto" ayuda="Lo leen quienes no ven la imagen, y Google. Ej.: «Packs de remeras básicas, hasta 20% OFF».">
              <input className={claseEntrada} maxLength={160} value={nuevo.alt} onChange={(e) => setNuevo({ ...nuevo, alt: e.target.value })} />
            </Campo>
            <Campo etiqueta="A dónde lleva (opcional)" ayuda="Una dirección de la tienda: /packs, /mujer…">
              <input className={claseEntrada} maxLength={300} placeholder="/packs" value={nuevo.enlace} onChange={(e) => setNuevo({ ...nuevo, enlace: e.target.value })} />
            </Campo>
            <Boton onClick={() => void crear()} disabled={nuevo.alt.trim().length < 2}>Crear</Boton>
          </div>
        </Tarjeta>
      )}
      <ul className="space-y-4">
        {ordenados.map((b, i) => (
          <li key={b.id}>
            <Tarjeta>
              <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.4fr)]">
                <div>
                  <p className="mb-1 text-xs font-bold uppercase tracking-wider text-tinta-tenue">Compu</p>
                  {b.foto ? <img src={url(b.foto)} alt={b.alt} className="aspect-[12/5] w-full rounded-xl object-cover" /> : <div className="grid aspect-[12/5] w-full place-items-center rounded-xl border border-dashed border-linea text-sm text-tinta-tenue">Sin foto: no se muestra</div>}
                  {operador && (
                    <label className="mt-2 inline-block cursor-pointer text-sm font-bold text-marca hover:underline">
                      {subiendo === `${b.id}-escritorio` ? "Subiendo…" : b.foto ? "Cambiar foto" : "Subir foto"}
                      <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/avif" className="sr-only" onChange={(e) => void subir(b, "escritorio", e.target.files?.[0])} />
                    </label>
                  )}
                </div>
                <div>
                  <p className="mb-1 text-xs font-bold uppercase tracking-wider text-tinta-tenue">Celular (opcional)</p>
                  {b.fotoMovil ? <img src={url(b.fotoMovil)} alt="" className="aspect-[4/5] w-32 rounded-xl object-cover" /> : <div className="grid aspect-[4/5] w-32 place-items-center rounded-xl border border-dashed border-linea p-2 text-center text-xs text-tinta-tenue">Usa la de compu</div>}
                  {operador && (
                    <div className="mt-2 flex flex-col items-start gap-1 text-sm">
                      <label className="cursor-pointer font-bold text-marca hover:underline">
                        {subiendo === `${b.id}-movil` ? "Subiendo…" : b.fotoMovil ? "Cambiar" : "Subir"}
                        <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/avif" className="sr-only" onChange={(e) => void subir(b, "movil", e.target.files?.[0])} />
                      </label>
                      {b.fotoMovil && <button type="button" className="text-tinta-tenue hover:underline" onClick={() => void sacarMovil(b)}>Sacar</button>}
                    </div>
                  )}
                </div>
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {vigente(b) ? <Insignia clase="bg-ahorro-claro text-ahorro">Se ve en el inicio</Insignia> : <Insignia>No se ve{!b.foto ? " (falta la foto)" : !b.activo ? " (apagado)" : " (fuera de fecha)"}</Insignia>}
                  </div>
                  <Campo etiqueta="Qué se ve">
                    <input className={claseEntrada} maxLength={160} disabled={!operador} defaultValue={b.alt} onBlur={(e) => e.target.value.trim() !== b.alt && void cambiar(b, { alt: e.target.value.trim() })} />
                  </Campo>
                  <Campo etiqueta="Enlace">
                    <input className={claseEntrada} maxLength={300} disabled={!operador} defaultValue={b.enlace ?? ""} placeholder="(sin enlace)" onBlur={(e) => (e.target.value.trim() || null) !== b.enlace && void cambiar(b, { enlace: e.target.value.trim() || null })} />
                  </Campo>
                  <div className="grid grid-cols-2 gap-2">
                    <Campo etiqueta="Desde (opcional)"><input type="datetime-local" className={claseEntrada} disabled={!operador} defaultValue={aLocal(b.desde)} onBlur={(e) => void cambiar(b, { desde: deLocal(e.target.value) })} /></Campo>
                    <Campo etiqueta="Hasta (opcional)"><input type="datetime-local" className={claseEntrada} disabled={!operador} defaultValue={aLocal(b.hasta)} onBlur={(e) => void cambiar(b, { hasta: deLocal(e.target.value) })} /></Campo>
                  </div>
                  {operador && (
                    <div className="flex flex-wrap items-center gap-3">
                      <Casilla etiqueta="Activo" marcada={b.activo} onChange={(v) => void cambiar(b, { activo: v }, v ? "Prendido" : "Apagado")} />
                      <Boton variante="borde" disabled={i === 0} onClick={() => void cambiar(b, { orden: ordenados[i - 1]!.orden - 1 }, "Movido")}>↑</Boton>
                      <Boton variante="borde" disabled={i === ordenados.length - 1} onClick={() => void cambiar(b, { orden: ordenados[i + 1]!.orden + 1 }, "Movido")}>↓</Boton>
                      <button type="button" className="ml-auto text-sm text-oferta hover:underline" onClick={() => void borrar(b)}>Borrar</button>
                    </div>
                  )}
                </div>
              </div>
            </Tarjeta>
          </li>
        ))}
        {!ordenados.length && <li className="rounded-2xl border border-dashed border-linea p-10 text-center text-tinta-tenue">Todavía no hay banners: el inicio muestra el título grande.</li>}
      </ul>
    </>
  );
}
