"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Banner as DibujoBanner, type BannerVista } from "@isu/ui/banner";
import {
  conVariables, FONDOS_BANNER, formatearPesos, NOMBRE_FONDO, NOMBRE_PRODUCTO_AUTO, PRODUCTO_AUTO, VARIABLES_BANNER,
  type BannerPublico, type FondoBanner, type ProductoAuto, type ProductoBanner, type VariablesBanner,
} from "@isu/shared";
import { api, fotoUrl, useDatos } from "@/lib/api";
import type { Categoria, FilaProducto } from "@/lib/catalogo";
import { Boton, Campo, Cargando, Casilla, claseEntrada, Insignia, Mensaje, Tarjeta, Titulo, useAviso } from "@/components/ui";
import { puede, useYo } from "@/components/Marco";

/*
 * Portada: los banners del carrusel del inicio (etapa 8; interactivos desde
 * la etapa 12). Cada banner puede ser una foto, un texto sobre un fondo de
 * color o las dos cosas, con etiqueta, hasta 2 botones que llevan a una página
 * de la tienda y la tarjeta de un producto (uno elegido o uno automático).
 *
 * Al editar se ve cómo queda, en compu y en celular, con el mismo dibujo que
 * usa la tienda (@isu/ui/banner) y las variables ({descuento}…) ya puestas.
 */
interface BotonB { texto: string; enlace: string; estilo: "lleno" | "borde" }
type Alineacion = "izquierda" | "centro";
interface Fila {
  id: number; alt: string; enlace: string | null; foto: string | null; fotoAncho: number | null; fotoAlto: number | null;
  fotoMovil: string | null; movilAncho: number | null; movilAlto: number | null; orden: number; activo: boolean; desde: string | null; hasta: string | null;
  titulo: string | null; texto: string | null; etiqueta: string | null; botones: BotonB[]; fondo: FondoBanner; alineacion: Alineacion;
  producto: string | null; productoNombre: string | null; productoAuto: ProductoAuto | null; ocultarSinProducto: boolean; sugerido: string | null;
}
interface Vista { banner: BannerPublico | null; motivo: string | null }
interface Datos { banners: Fila[]; vistas: Record<number, Vista>; variables: VariablesBanner }

const TIPOS_FOTO = "image/jpeg,image/png,image/webp,image/heic,image/avif";
const srcBanner = (c: string) => fotoUrl(c, 1600);
const srcSetBanner = (c: string) => `${fotoUrl(c, 800)} 800w, ${fotoUrl(c, 1600)} 1600w`;
const srcProducto = (c: string) => fotoUrl(c, 800);
const aLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");
const deLocal = (v: string) => (v ? new Date(v).toISOString() : null);
const MUESTRA: Record<FondoBanner, string> = {
  marca: "bg-marca", tinta: "bg-tinta", ahorro: "bg-ahorro", oferta: "bg-oferta", crema: "bg-[#f6eee3]", rosa: "bg-[#fbe9ec]", arena: "bg-[#ebe2d2]",
};
/** Las páginas fijas de la tienda (para los botones y el link del banner). */
const PAGINAS: Array<[string, string]> = [
  ["/nuevos", "Lo nuevo"], ["/destacados", "Destacados"], ["/packs", "Packs"], ["/liquidacion", "Liquidación"],
  ["/outfits", "Armá tu outfit"], ["/locales", "Locales"], ["/", "Inicio"],
];
/** Hasta 8 banners se ven en el inicio (los primeros en el orden). */
const MAX_VISIBLES = 8;

/* ── Estado de cada banner en la lista ── */
function estado(b: Fila, v: Vista | undefined, lugar: number | null) {
  const ahora = new Date();
  if (!b.activo) return { sale: false, texto: "Apagado" };
  if (b.desde && new Date(b.desde) > ahora) return { sale: false, texto: `Programado: sale el ${new Date(b.desde).toLocaleDateString("es-AR")}` };
  if (b.hasta && new Date(b.hasta) <= ahora) return { sale: false, texto: "Ya terminó (fecha de fin)" };
  if (!v?.banner) return { sale: false, texto: `No sale: ${v?.motivo ?? "revisalo"}` };
  if (lugar !== null && lugar >= MAX_VISIBLES) return { sale: false, texto: `No entra: se ven los primeros ${MAX_VISIBLES}` };
  return { sale: true, texto: "Se ve en el inicio" };
}

export default function Portada() {
  const yo = useYo();
  const operador = puede(yo, "operador");
  const { datos, error, recargar } = useDatos<Datos>("banners");
  const { datos: cats } = useDatos<{ categorias: Categoria[] }>("categorias");
  const [editando, setEditando] = useState<number | "nuevo" | null>(null);
  const aviso = useAviso();
  if (error) return <Mensaje>{error}</Mensaje>;
  if (!datos) return <Cargando />;

  const ordenados = [...datos.banners].sort((a, b) => a.orden - b.orden || a.id - b.id);
  // El lugar en el carrusel de los que salen (para avisar si hay más de 8).
  const lugares = new Map<number, number>();
  let n = 0;
  for (const b of ordenados) if (estado(b, datos.vistas[b.id], null).sale) lugares.set(b.id, n++);

  async function cambiar(b: Fila, cuerpo: Record<string, unknown>, texto = "Guardado") {
    try { await api(`banners/${b.id}`, { metodo: "PATCH", cuerpo }); aviso.ok(texto); await recargar(); } catch (e) { aviso.error(e); }
  }
  async function borrar(b: Fila) {
    if (!confirm(`¿Borrar el banner «${b.titulo ?? b.alt}»? Se borran también sus fotos.`)) return;
    try { await api(`banners/${b.id}`, { metodo: "DELETE" }); aviso.ok("Banner borrado."); if (editando === b.id) setEditando(null); await recargar(); } catch (e) { aviso.error(e); }
  }
  async function sugeridos() {
    try {
      const r = await api<{ creados: number }>("banners/sugeridos", { metodo: "POST" });
      aviso.ok(r.creados ? `Se agregaron ${r.creados} banners sugeridos, apagados: revisalos y prendé los que quieras.` : "Ya están todos los banners sugeridos.");
      await recargar();
    } catch (e) { aviso.error(e); }
  }

  return (
    <>
      <Titulo acciones={operador && (
        <>
          <Boton variante="borde" onClick={() => void sugeridos()}>Agregar banners sugeridos</Boton>
          <Boton onClick={() => setEditando("nuevo")} disabled={editando === "nuevo"}>Nuevo banner</Boton>
        </>
      )}>Portada</Titulo>
      <p className="-mt-2 mb-5 max-w-3xl text-sm text-tinta-suave">
        El carrusel de arriba del inicio (pasa solo cada 6 segundos; se ven los primeros {MAX_VISIBLES}). Un banner puede ser una foto, un texto sobre
        un color o las dos cosas, con botones que llevan a una página de la tienda y la tarjeta de un producto. Si no hay ninguno activo, el inicio
        muestra el título grande.
      </p>
      <div className="mb-4"><aviso.Aviso /></div>

      {editando === "nuevo" && (
        <Editor fila={null} variables={datos.variables} cats={cats?.categorias ?? []} operador={operador}
          ordenNuevo={(ordenados[0]?.orden ?? 1) - 1}
          onListo={async (id, texto) => { aviso.ok(texto); await recargar(); setEditando(id); }}
          onError={aviso.error} onCerrar={() => setEditando(null)} recargar={recargar} />
      )}

      <ul className="space-y-4">
        {ordenados.map((b, i) => {
          const v = datos.vistas[b.id];
          const e = estado(b, v, lugares.get(b.id) ?? null);
          if (editando === b.id) {
            return (
              <li key={b.id}>
                <Editor fila={b} variables={datos.variables} cats={cats?.categorias ?? []} operador={operador} ordenNuevo={0}
                  onListo={async (_id, texto) => { aviso.ok(texto); await recargar(); }}
                  onError={aviso.error} onCerrar={() => setEditando(null)} recargar={recargar} />
              </li>
            );
          }
          return (
            <li key={b.id}>
              <Tarjeta>
                <div className="grid gap-4 md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] md:items-center">
                  <div>
                    {v?.banner ? (
                      <Escalado ancho={1200}>
                        <DibujoBanner b={vistaDe(v.banner)} srcBanner={srcBanner} srcSetBanner={srcSetBanner} srcProducto={srcProducto} pesos={formatearPesos} vista />
                      </Escalado>
                    ) : (
                      <div className="grid aspect-[12/5] place-items-center rounded-xl border border-dashed border-linea p-3 text-center text-sm text-tinta-tenue">
                        {v?.motivo ?? "Sin vista previa"}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Insignia clase={e.sale ? "bg-ahorro-claro text-ahorro" : undefined}>{e.texto}</Insignia>
                      {b.sugerido && <Insignia clase="bg-marca-claro text-marca-fuerte">Sugerido</Insignia>}
                      {b.desde || b.hasta ? <span className="text-xs text-tinta-tenue">
                        {b.desde && `desde ${new Date(b.desde).toLocaleDateString("es-AR")} `}{b.hasta && `hasta ${new Date(b.hasta).toLocaleDateString("es-AR")}`}
                      </span> : null}
                    </div>
                    {/* Con los datos de Ajustes ya puestos, si sale («20% OFF…» en vez de «{descuento}% OFF…»). */}
                    <p className="truncate text-lg font-bold">{v?.banner?.titulo ?? b.titulo ?? b.alt}</p>
                    <p className="line-clamp-2 text-sm text-tinta-suave">
                      {[b.foto ? "Con foto" : `Fondo ${NOMBRE_FONDO[b.fondo].toLowerCase()}`,
                        b.botones.length ? `${b.botones.length === 1 ? "1 botón" : "2 botones"} (${b.botones.map((x) => x.enlace).join(", ")})` : b.enlace ? `lleva a ${b.enlace}` : null,
                        b.productoNombre ? `producto: ${b.productoNombre}` : b.productoAuto ? `producto: ${NOMBRE_PRODUCTO_AUTO[b.productoAuto].toLowerCase()}` : null,
                      ].filter(Boolean).join(" · ")}
                    </p>
                    <div className="flex flex-wrap items-center gap-3 pt-1">
                      <Boton variante={operador ? "primario" : "borde"} onClick={() => setEditando(b.id)}>{operador ? "Editar" : "Ver"}</Boton>
                      {operador && (
                        <>
                          <Casilla etiqueta="Activo" marcada={b.activo} onChange={(x) => void cambiar(b, { activo: x }, x ? "Prendido" : "Apagado")} />
                          <Boton variante="borde" aria-label="Subir en el orden" disabled={i === 0} onClick={() => void cambiar(b, { orden: ordenados[i - 1]!.orden - 1 }, "Movido")}>↑</Boton>
                          <Boton variante="borde" aria-label="Bajar en el orden" disabled={i === ordenados.length - 1} onClick={() => void cambiar(b, { orden: ordenados[i + 1]!.orden + 1 }, "Movido")}>↓</Boton>
                          <button type="button" className="ml-auto text-sm text-oferta hover:underline" onClick={() => void borrar(b)}>Borrar</button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </Tarjeta>
            </li>
          );
        })}
        {!ordenados.length && (
          <li className="rounded-2xl border border-dashed border-linea p-10 text-center text-tinta-tenue">
            Todavía no hay banners: el inicio muestra el título grande. Probá con «Agregar banners sugeridos».
          </li>
        )}
      </ul>
    </>
  );
}

/** El banner que manda la API, en la forma del dibujo. */
const vistaDe = (b: BannerPublico): BannerVista => ({
  alt: b.alt, enlace: b.enlace, foto: b.foto, fotoMovil: b.fotoMovil, titulo: b.titulo, texto: b.texto, etiqueta: b.etiqueta,
  botones: b.botones, fondo: b.fondo, alineacion: b.alineacion, producto: b.producto,
});

/** Dibuja algo a un ancho fijo (el de una compu o un celular) y lo achica para que entre. */
function Escalado({ ancho, children }: { ancho: number; children: React.ReactNode }) {
  const caja = useRef<HTMLDivElement>(null);
  const dentro = useRef<HTMLDivElement>(null);
  const [m, setM] = useState({ escala: 0, alto: 0 });
  useEffect(() => {
    const c = caja.current, d = dentro.current;
    if (!c || !d) return;
    const medir = () => { const escala = Math.min(1, c.clientWidth / ancho); setM({ escala, alto: d.offsetHeight * escala }); };
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(c); ro.observe(d);
    return () => ro.disconnect();
  }, [ancho]);
  return (
    <div ref={caja} className="relative w-full overflow-hidden rounded-xl bg-fondo-suave ring-1 ring-linea" style={{ height: m.alto || 120 }}>
      <div ref={dentro} inert className="pointer-events-none absolute left-0 top-0 origin-top-left"
        style={{ width: ancho, transform: `scale(${m.escala || 0.0001})`, visibility: m.escala ? "visible" : "hidden" }}>
        {children}
      </div>
    </div>
  );
}

/* ── Editor ─────────────────────────────────────────────────────── */
interface Form {
  titulo: string; texto: string; etiqueta: string; botones: BotonB[]; fondo: FondoBanner; alineacion: Alineacion;
  modo: "ninguno" | "elegido" | "auto"; producto: { slug: string; nombre: string } | null; productoAuto: ProductoAuto; ocultarSinProducto: boolean;
  alt: string; enlace: string; desde: string; hasta: string; activo: boolean;
}
const formDe = (b: Fila | null): Form => ({
  titulo: b?.titulo ?? "", texto: b?.texto ?? "", etiqueta: b?.etiqueta ?? "", botones: b?.botones ?? [],
  fondo: b?.fondo ?? "marca", alineacion: b?.alineacion ?? "izquierda",
  modo: b?.producto ? "elegido" : b?.productoAuto ? "auto" : "ninguno",
  producto: b?.producto ? { slug: b.producto, nombre: b.productoNombre ?? b.producto } : null,
  productoAuto: b?.productoAuto ?? "nuevo", ocultarSinProducto: b?.ocultarSinProducto ?? false,
  alt: b?.alt ?? "", enlace: b?.enlace ?? "", desde: aLocal(b?.desde ?? null), hasta: aLocal(b?.hasta ?? null), activo: b?.activo ?? true,
});
type CampoTexto = "titulo" | "texto" | "etiqueta" | `boton${number}`;
const usadas = (t: string) => [...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);

function Editor({ fila, variables, cats, operador, ordenNuevo, onListo, onError, onCerrar, recargar }: {
  fila: Fila | null; variables: VariablesBanner; cats: Categoria[]; operador: boolean; ordenNuevo: number;
  onListo: (id: number, texto: string) => Promise<void>; onError: (e: unknown) => void; onCerrar: () => void; recargar: () => Promise<void>;
}) {
  const [f, setF] = useState<Form>(() => formDe(fila));
  const [enCelular, setEnCelular] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [subiendo, setSubiendo] = useState<string | null>(null);
  const [prod, setProd] = useState<{ cargando: boolean; producto: ProductoBanner | null }>({ cargando: false, producto: null });
  const foco = useRef<{ campo: CampoTexto; el: HTMLInputElement | HTMLTextAreaElement } | null>(null);
  const caja = useRef<HTMLDivElement>(null);
  const id = useId();
  const pon = (c: Partial<Form>) => setF((x) => ({ ...x, ...c }));

  useEffect(() => { caja.current?.scrollIntoView({ block: "start", behavior: "smooth" }); }, []);

  // El producto de la vista previa: el elegido o el automático, como lo elige la tienda.
  const claveProd = f.modo === "elegido" ? `p:${f.producto?.slug ?? ""}` : f.modo === "auto" ? `a:${f.productoAuto}` : "";
  useEffect(() => {
    if (!claveProd || claveProd === "p:") { setProd({ cargando: false, producto: null }); return; }
    let vivo = true;
    setProd((x) => ({ ...x, cargando: true }));
    const t = setTimeout(() => {
      api<{ producto: ProductoBanner | null }>("banners/producto", { query: claveProd.startsWith("p:") ? { producto: claveProd.slice(2) } : { auto: claveProd.slice(2) } })
        .then((r) => { if (vivo) setProd({ cargando: false, producto: r.producto }); })
        .catch(() => { if (vivo) setProd({ cargando: false, producto: null }); });
    }, 250);
    return () => { vivo = false; clearTimeout(t); };
  }, [claveProd]);

  // Variables: las desconocidas (error de tipeo) y las que hoy no tienen valor (el banner no saldría).
  const textos = [f.titulo, f.texto, f.etiqueta, f.alt, ...f.botones.map((b) => b.texto)];
  const desconocidas = [...new Set(textos.flatMap(usadas).filter((k) => !(k in VARIABLES_BANNER)))];
  const sinValor = [...new Set(textos.flatMap(usadas).filter((k) => k in VARIABLES_BANNER && !variables[k as keyof VariablesBanner]))];
  const con = (t: string) => { const v = conVariables(t.trim() || null, variables); return v === undefined ? t.trim() : v; };

  const tieneProducto = f.modo !== "ninguno";
  const vista: BannerVista = {
    alt: con(f.alt) ?? "", enlace: f.botones.length || tieneProducto ? null : f.enlace || null,
    foto: fila?.foto ? { clave: fila.foto, ancho: fila.fotoAncho, alto: fila.fotoAlto } : null,
    fotoMovil: fila?.fotoMovil ? { clave: fila.fotoMovil, ancho: fila.movilAncho, alto: fila.movilAlto } : null,
    titulo: con(f.titulo), texto: con(f.texto), etiqueta: con(f.etiqueta),
    botones: f.botones.filter((b) => b.texto.trim()).map((b) => ({ ...b, texto: con(b.texto) ?? "" })),
    fondo: f.fondo, alineacion: f.alineacion, producto: tieneProducto ? prod.producto : null,
  };
  const sinNada = !vista.foto && !vista.titulo;

  /** Pone {variable} donde está el cursor del último texto tocado (o al final del título). */
  function insertar(k: string) {
    const tok = `{${k}}`;
    const fc = foco.current;
    const campo: CampoTexto = fc?.campo ?? "titulo";
    const actual = campo.startsWith("boton") ? f.botones[Number(campo.slice(5))]?.texto ?? "" : f[campo as "titulo" | "texto" | "etiqueta"];
    const desde = fc?.el.selectionStart ?? actual.length;
    const hasta = fc?.el.selectionEnd ?? actual.length;
    const nuevo = actual.slice(0, desde) + tok + actual.slice(hasta);
    if (campo.startsWith("boton")) {
      const i = Number(campo.slice(5));
      pon({ botones: f.botones.map((b, j) => (j === i ? { ...b, texto: nuevo } : b)) });
    } else pon({ [campo]: nuevo } as Partial<Form>);
    requestAnimationFrame(() => { fc?.el.focus(); fc?.el.setSelectionRange(desde + tok.length, desde + tok.length); });
  }
  const alFoco = (campo: CampoTexto) => (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => { foco.current = { campo, el: e.currentTarget }; };

  async function guardar() {
    const alt = f.alt.trim() || f.titulo.trim();
    if (!fila?.foto && !f.titulo.trim()) { onError(new Error("Escribí un título (o guardalo y subile una foto).")); return; }
    if (alt.length < 2) { onError(new Error("Escribí qué se ve en el banner (lo leen quienes no ven la imagen, y Google).")); return; }
    if (f.botones.some((b) => !b.texto.trim() || !b.enlace)) { onError(new Error("Cada botón necesita un texto y a dónde lleva.")); return; }
    if (f.modo === "elegido" && !f.producto) { onError(new Error("Elegí el producto (o poné «Ninguno»).")); return; }
    const cuerpo = {
      alt, enlace: f.enlace.trim() || null, titulo: f.titulo.trim() || null, texto: f.texto.trim() || null, etiqueta: f.etiqueta.trim() || null,
      botones: f.botones.map((b) => ({ ...b, texto: b.texto.trim() })), fondo: f.fondo, alineacion: f.alineacion,
      producto: f.modo === "elegido" ? f.producto?.slug ?? null : null, productoAuto: f.modo === "auto" ? f.productoAuto : null,
      ocultarSinProducto: f.modo === "ninguno" ? false : f.ocultarSinProducto,
      desde: deLocal(f.desde), hasta: deLocal(f.hasta), activo: f.activo,
    };
    setGuardando(true);
    try {
      if (fila) {
        await api(`banners/${fila.id}`, { metodo: "PATCH", cuerpo });
        await onListo(fila.id, "Banner guardado.");
      } else {
        const r = await api<{ banner: Fila }>("banners", { cuerpo: { ...cuerpo, orden: ordenNuevo } });
        await onListo(r.banner.id, "Banner creado. Si querés, ahora subile una foto.");
      }
    } catch (e) { onError(e); } finally { setGuardando(false); }
  }
  async function subir(tipo: "escritorio" | "movil", archivo: File | undefined) {
    if (!archivo || !fila) return;
    setSubiendo(tipo);
    try { await api(`banners/${fila.id}/foto?tipo=${tipo}`, { archivo }); await recargar(); } catch (e) { onError(e); } finally { setSubiendo(null); }
  }
  async function sacar(tipo: "escritorio" | "movil") {
    if (!fila) return;
    try { await api(`banners/${fila.id}/${tipo === "movil" ? "foto-movil" : "foto"}`, { metodo: "DELETE" }); await recargar(); } catch (e) { onError(e); }
  }

  const leyenda = "mb-2 text-xs font-bold uppercase tracking-wider text-tinta-tenue";
  return (
    <div ref={caja} className="mb-5 scroll-mt-4">
      <Tarjeta titulo={fila ? `Editar banner${fila.titulo ? `: ${fila.titulo}` : ""}` : "Banner nuevo"}
        acciones={<Boton variante="texto" onClick={onCerrar}>Cerrar</Boton>}>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          {/* Vista previa (arriba en el celular, a la derecha en la compu) */}
          <div className="lg:order-2">
            <div className="space-y-3 lg:sticky lg:top-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-bold">Así se ve</p>
                <div className="inline-flex rounded-xl border border-linea bg-white p-0.5 text-sm" role="group" aria-label="Ver en">
                  {(["Compu", "Celular"] as const).map((x) => (
                    <button key={x} type="button" aria-pressed={(x === "Celular") === enCelular} onClick={() => setEnCelular(x === "Celular")}
                      className={`rounded-lg px-3 py-1.5 font-bold ${(x === "Celular") === enCelular ? "bg-tinta text-white" : "text-tinta-suave"}`}>{x}</button>
                  ))}
                </div>
              </div>
              {sinNada ? (
                <div className="grid aspect-[12/5] place-items-center rounded-xl border border-dashed border-linea p-4 text-center text-sm text-tinta-tenue">
                  Escribí un título o subile una foto para ver el banner.
                </div>
              ) : (
                <div className={enCelular ? "mx-auto max-w-[390px]" : ""}>
                  <Escalado ancho={enCelular ? 390 : 1280}>
                    <DibujoBanner b={vista} srcBanner={srcBanner} srcSetBanner={srcSetBanner} srcProducto={srcProducto} pesos={formatearPesos} vista movil={enCelular} />
                  </Escalado>
                </div>
              )}
              {sinValor.length > 0 && <Mensaje tipo="info">Usa {sinValor.map((k) => `{${k}}`).join(", ")}, que hoy no tiene valor en Ajustes: así el banner no sale en la tienda.</Mensaje>}
              {desconocidas.length > 0 && <Mensaje>{desconocidas.map((k) => `{${k}}`).join(", ")} no existe. Usá las de la lista.</Mensaje>}
              {tieneProducto && !prod.cargando && !prod.producto && (
                <Mensaje tipo="info">
                  {f.modo === "elegido" && !f.producto ? "Elegí el producto." : "No hay un producto con stock y foto para mostrar"}
                  {(f.modo === "auto" || f.producto) && (f.ocultarSinProducto ? ": el banner no sale hasta que haya." : ": el banner sale sin la tarjeta.")}
                </Mensaje>
              )}
              {vista.producto && f.alineacion === "centro" && <p className="text-xs text-tinta-tenue">Con producto, el texto va a la izquierda y la tarjeta a la derecha.</p>}
            </div>
          </div>

          {/* Formulario */}
          <fieldset disabled={!operador} className="min-w-0 space-y-6 lg:order-1">
            <section>
              <p className={leyenda}>Textos</p>
              <div className="space-y-3">
                <Campo etiqueta="Título" ayuda={fila?.foto ? "Opcional: sin título se ve sólo la foto." : "Lo grande del banner."}>
                  <input className={claseEntrada} maxLength={90} value={f.titulo} onFocus={alFoco("titulo")} onChange={(e) => pon({ titulo: e.target.value })} placeholder="Ej.: {descuento}% OFF pagando con transferencia" />
                </Campo>
                <Campo etiqueta="Texto (opcional)">
                  <textarea className={claseEntrada} rows={2} maxLength={220} value={f.texto} onFocus={alFoco("texto")} onChange={(e) => pon({ texto: e.target.value })} />
                </Campo>
                <Campo etiqueta="Etiqueta (opcional)" ayuda="Un cartelito arriba del título: «Nuevo», «Hasta 25% OFF»…">
                  <input className={claseEntrada} maxLength={40} value={f.etiqueta} onFocus={alFoco("etiqueta")} onChange={(e) => pon({ etiqueta: e.target.value })} />
                </Campo>
                <div className="rounded-xl bg-fondo-suave p-3 text-sm">
                  <p className="mb-2 text-tinta-suave">Datos que salen de Ajustes (si cambian, el banner cambia solo). Tocá uno para ponerlo donde está el cursor:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(Object.keys(VARIABLES_BANNER) as Array<keyof typeof VARIABLES_BANNER>).map((k) => (
                      <button key={k} type="button" title={VARIABLES_BANNER[k]} onMouseDown={(e) => e.preventDefault()} onClick={() => insertar(k)}
                        className="rounded-full border border-linea bg-white px-2.5 py-1 text-xs hover:border-tinta">
                        <code className="font-bold">{`{${k}}`}</code>
                        <span className={variables[k] ? "text-tinta-tenue" : "text-oferta"}> {variables[k] ?? "sin valor"}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section>
              <p className={leyenda}>Botones (hasta 2)</p>
              <div className="space-y-3">
                {f.botones.map((b, i) => (
                  <div key={i} className="rounded-xl border border-linea p-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Campo etiqueta={`Texto del botón ${i + 1}`}>
                        <input className={claseEntrada} maxLength={30} value={b.texto} onFocus={alFoco(`boton${i}`)}
                          onChange={(e) => pon({ botones: f.botones.map((x, j) => (j === i ? { ...x, texto: e.target.value } : x)) })} />
                      </Campo>
                      <Destino etiqueta="Lleva a" valor={b.enlace} cats={cats} onChange={(enlace) => pon({ botones: f.botones.map((x, j) => (j === i ? { ...x, enlace } : x)) })} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-4 text-sm">
                      {(["lleno", "borde"] as const).map((s) => (
                        <label key={s} className="flex cursor-pointer items-center gap-1.5">
                          <input type="radio" name={`${id}-estilo-${i}`} checked={b.estilo === s} onChange={() => pon({ botones: f.botones.map((x, j) => (j === i ? { ...x, estilo: s } : x)) })} />
                          {s === "lleno" ? "Relleno" : "Sólo borde"}
                        </label>
                      ))}
                      <button type="button" className="ml-auto text-oferta hover:underline" onClick={() => pon({ botones: f.botones.filter((_, j) => j !== i) })}>Quitar botón</button>
                    </div>
                  </div>
                ))}
                {f.botones.length < 2 && (
                  <Boton variante="borde" onClick={() => pon({ botones: [...f.botones, { texto: "", enlace: f.botones.length ? "/nuevos" : "/packs", estilo: f.botones.length ? "borde" : "lleno" }] })}>
                    + Agregar botón
                  </Boton>
                )}
              </div>
            </section>

            <section>
              <p className={leyenda}>Producto en el banner</p>
              <div className="space-y-3">
                <div className="flex flex-wrap gap-x-5 gap-y-2 text-[15px]">
                  {([["ninguno", "Ninguno"], ["elegido", "Uno que elijo"], ["auto", "Automático"]] as const).map(([v, t]) => (
                    <label key={v} className="flex cursor-pointer items-center gap-1.5">
                      <input type="radio" name={`${id}-modo`} checked={f.modo === v} onChange={() => pon({ modo: v })} /> {t}
                    </label>
                  ))}
                </div>
                {f.modo === "elegido" && (
                  f.producto ? (
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      <b>{f.producto.nombre}</b>
                      <Boton variante="texto" onClick={() => pon({ producto: null })}>Cambiar</Boton>
                    </p>
                  ) : <BuscarProducto etiqueta="Buscar el producto" onElegir={(p) => pon({ producto: p })} />
                )}
                {f.modo === "auto" && (
                  <Campo etiqueta="Cuál" ayuda="Se elige solo cada vez: siempre uno con stock y con foto, al precio de la tienda.">
                    <select className={claseEntrada} value={f.productoAuto} onChange={(e) => pon({ productoAuto: e.target.value as ProductoAuto })}>
                      {PRODUCTO_AUTO.map((a) => <option key={a} value={a}>{NOMBRE_PRODUCTO_AUTO[a]}</option>)}
                    </select>
                  </Campo>
                )}
                {f.modo !== "ninguno" && (
                  <Casilla etiqueta="Si no hay ninguno con stock, no mostrar el banner" marcada={f.ocultarSinProducto} onChange={(v) => pon({ ocultarSinProducto: v })}
                    ayuda="Si no, el banner sale igual, sin la tarjeta." />
                )}
              </div>
            </section>

            <section>
              <p className={leyenda}>Diseño</p>
              <div className="space-y-4">
                <fieldset>
                  <legend className="mb-2 text-sm font-bold">Color de fondo{fila?.foto ? " (con foto, el texto va sobre la foto)" : ""}</legend>
                  <div className="flex flex-wrap gap-2">
                    {FONDOS_BANNER.map((c) => (
                      <label key={c} className="cursor-pointer">
                        <input type="radio" name={`${id}-fondo`} className="peer sr-only" checked={f.fondo === c} onChange={() => pon({ fondo: c })} />
                        <span className="flex items-center gap-2 rounded-full border border-linea bg-white py-1 pl-1 pr-3 text-sm peer-checked:border-tinta peer-checked:ring-2 peer-checked:ring-tinta peer-focus-visible:outline-2 peer-focus-visible:outline-marca">
                          <span aria-hidden="true" className={`size-6 rounded-full ring-1 ring-black/10 ${MUESTRA[c]}`} />{NOMBRE_FONDO[c]}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <fieldset>
                  <legend className="mb-2 text-sm font-bold">Texto</legend>
                  <div className="flex gap-5 text-[15px]">
                    {([["izquierda", "A la izquierda"], ["centro", "Centrado"]] as const).map(([v, t]) => (
                      <label key={v} className="flex cursor-pointer items-center gap-1.5">
                        <input type="radio" name={`${id}-alineacion`} checked={f.alineacion === v} onChange={() => pon({ alineacion: v })} /> {t}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
            </section>

            <section>
              <p className={leyenda}>Fotos (opcional)</p>
              {!fila ? (
                <p className="text-sm text-tinta-tenue">Creá el banner y después le podés subir una foto.</p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                  <div>
                    <p className="mb-1 text-sm font-bold">Compu <span className="font-normal text-tinta-tenue">(apaisada, ej. 1920 × 800)</span></p>
                    {fila.foto ? <img src={fotoUrl(fila.foto, 800)} alt="" className="aspect-[12/5] w-full rounded-xl object-cover" />
                      : <div className="grid aspect-[12/5] w-full place-items-center rounded-xl border border-dashed border-linea text-sm text-tinta-tenue">Sin foto: se ve el color</div>}
                    {operador && (
                      <div className="mt-2 flex flex-wrap gap-4 text-sm">
                        <label className="cursor-pointer font-bold text-marca hover:underline">
                          {subiendo === "escritorio" ? "Subiendo…" : fila.foto ? "Cambiar foto" : "Subir foto"}
                          <input type="file" accept={TIPOS_FOTO} className="sr-only" onChange={(e) => void subir("escritorio", e.target.files?.[0])} />
                        </label>
                        {fila.foto && fila.titulo && <button type="button" className="text-tinta-tenue hover:underline" onClick={() => void sacar("escritorio")}>Sacar foto</button>}
                      </div>
                    )}
                  </div>
                  <div>
                    <p className="mb-1 text-sm font-bold">Celular <span className="font-normal text-tinta-tenue">(vertical)</span></p>
                    {fila.fotoMovil ? <img src={fotoUrl(fila.fotoMovil, 800)} alt="" className="aspect-[4/5] w-28 rounded-xl object-cover" />
                      : <div className="grid aspect-[4/5] w-28 place-items-center rounded-xl border border-dashed border-linea p-2 text-center text-xs text-tinta-tenue">{fila.foto ? "Usa la de compu" : "—"}</div>}
                    {operador && fila.foto && (
                      <div className="mt-2 flex flex-wrap gap-4 text-sm">
                        <label className="cursor-pointer font-bold text-marca hover:underline">
                          {subiendo === "movil" ? "Subiendo…" : fila.fotoMovil ? "Cambiar" : "Subir"}
                          <input type="file" accept={TIPOS_FOTO} className="sr-only" onChange={(e) => void subir("movil", e.target.files?.[0])} />
                        </label>
                        {fila.fotoMovil && <button type="button" className="text-tinta-tenue hover:underline" onClick={() => void sacar("movil")}>Sacar</button>}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </section>

            <section>
              <p className={leyenda}>Más</p>
              <div className="space-y-3">
                <Campo etiqueta="Qué se ve en el banner" ayuda={`Lo leen quienes no ven la imagen, y Google.${f.titulo.trim() ? " Si lo dejás vacío, se usa el título." : ""}`}>
                  <input className={claseEntrada} maxLength={160} value={f.alt} onChange={(e) => pon({ alt: e.target.value })} placeholder={f.titulo || "Ej.: Packs de remeras básicas, hasta 20% OFF"} />
                </Campo>
                {f.botones.length || tieneProducto ? (
                  <p className="text-sm text-tinta-tenue">Con botones o producto, se toca el botón o la tarjeta (el banner entero no lleva a otro lado).</p>
                ) : (
                  <Destino etiqueta="Al tocar el banner, lleva a" valor={f.enlace} cats={cats} opcional onChange={(enlace) => pon({ enlace })} />
                )}
                <div className="grid grid-cols-2 gap-3">
                  <Campo etiqueta="Desde (opcional)"><input type="datetime-local" className={claseEntrada} value={f.desde} onChange={(e) => pon({ desde: e.target.value })} /></Campo>
                  <Campo etiqueta="Hasta (opcional)"><input type="datetime-local" className={claseEntrada} value={f.hasta} onChange={(e) => pon({ hasta: e.target.value })} /></Campo>
                </div>
                <Casilla etiqueta="Activo" marcada={f.activo} onChange={(v) => pon({ activo: v })} ayuda="Apagado no se ve en la tienda." />
              </div>
            </section>

            {operador && (
              <div className="flex flex-wrap gap-3 border-t border-linea/70 pt-4">
                <Boton onClick={() => void guardar()} disabled={guardando || desconocidas.length > 0}>{guardando ? "Guardando…" : fila ? "Guardar cambios" : "Crear banner"}</Boton>
                <Boton variante="borde" onClick={onCerrar}>{fila ? "Cerrar" : "Cancelar"}</Boton>
              </div>
            )}
          </fieldset>
        </div>
      </Tarjeta>
    </div>
  );
}

/* ── A dónde lleva un botón (o el banner): páginas, categorías, un producto u otra dirección de la tienda ── */
function Destino({ etiqueta, valor, cats, onChange, opcional = false }: {
  etiqueta: string; valor: string; cats: Categoria[]; onChange: (v: string) => void; opcional?: boolean;
}) {
  const id = useId();
  const padres = cats.filter((c) => !c.padreId && c.visible).sort((a, b) => a.orden - b.orden);
  const hijas = (p: Categoria) => cats.filter((c) => c.padreId === p.id && c.visible).sort((a, b) => a.orden - b.orden);
  const conocidas = new Set<string>([...PAGINAS.map(([r]) => r), ...padres.map((p) => `/packs/${p.slug}`),
    ...padres.flatMap((p) => [`/${p.slug}`, ...hijas(p).map((h) => `/${p.slug}/${h.slug}`)])]);
  const modoDe = (v: string) => (!v ? "" : conocidas.has(v) ? v : v.startsWith("/producto/") ? "__producto" : "__otra");
  const [modo, setModo] = useState(() => modoDe(valor));
  // Las categorías llegan después: si el valor es una de ellas, se ve elegida.
  useEffect(() => { if (modo === "__otra" && conocidas.has(valor)) setModo(valor); }, [cats.length]);

  return (
    <div className="space-y-2 text-sm">
      <label className="block">
        <span className="font-bold">{etiqueta}</span>
        <select id={id} className={`${claseEntrada} mt-1`} value={modo} onChange={(e) => {
          const v = e.target.value;
          setModo(v);
          if (v === "__producto") onChange("");
          else if (v === "__otra") onChange(valor && !conocidas.has(valor) ? valor : "/");
          else onChange(v);
        }}>
          {opcional && <option value="">A ningún lado</option>}
          {!opcional && !modo && <option value="" disabled>Elegí…</option>}
          <optgroup label="Páginas">{PAGINAS.map(([r, t]) => <option key={r} value={r}>{t}</option>)}</optgroup>
          {padres.length > 0 && (
            <optgroup label="Categorías">
              {padres.flatMap((p) => [
                <option key={p.id} value={`/${p.slug}`}>{p.nombre}</option>,
                ...hijas(p).map((h) => <option key={h.id} value={`/${p.slug}/${h.slug}`}>{p.nombre} › {h.nombre}</option>),
              ])}
            </optgroup>
          )}
          {padres.length > 0 && <optgroup label="Packs">{padres.map((p) => <option key={p.id} value={`/packs/${p.slug}`}>Packs de {p.nombre}</option>)}</optgroup>}
          <optgroup label="Otro">
            <option value="__producto">Un producto…</option>
            <option value="__otra">Otra dirección de la tienda…</option>
          </optgroup>
        </select>
      </label>
      {modo === "__producto" && (
        valor.startsWith("/producto/") ? (
          <p className="flex flex-wrap items-center gap-2"><code className="break-all">{valor}</code><Boton variante="texto" onClick={() => onChange("")}>Cambiar</Boton></p>
        ) : <BuscarProducto etiqueta="Buscar el producto" onElegir={(p) => onChange(`/producto/${p.slug}`)} />
      )}
      {modo === "__otra" && (
        <Campo etiqueta="Dirección" ayuda="Una página de esta tienda, empezando con / (por ejemplo /mujer/remeras o /buscar?q=lino).">
          <input className={claseEntrada} maxLength={300} value={valor} onChange={(e) => onChange(e.target.value.trim())} />
        </Campo>
      )}
    </div>
  );
}

/* ── Buscar un producto de la tienda por su nombre ── */
function BuscarProducto({ etiqueta, onElegir }: { etiqueta: string; onElegir: (p: { slug: string; nombre: string }) => void }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<FilaProducto[] | null>(null);
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) { setRes(null); return; }
    let vivo = true;
    const h = setTimeout(() => {
      api<{ productos: FilaProducto[] }>("productos", { query: { q: t, filtro: "visibles" } })
        .then((r) => { if (vivo) setRes(r.productos.slice(0, 8)); }).catch(() => { if (vivo) setRes([]); });
    }, 300);
    return () => { vivo = false; clearTimeout(h); };
  }, [q]);
  return (
    <div className="space-y-2">
      <Campo etiqueta={etiqueta}>
        <input type="search" className={claseEntrada} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Escribí parte del nombre" />
      </Campo>
      {res && (res.length ? (
        <ul className="divide-y divide-linea/70 overflow-hidden rounded-xl border border-linea bg-white">
          {res.map((p) => (
            <li key={p.slug}>
              <button type="button" className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-fondo-suave" onClick={() => onElegir({ slug: p.slug, nombre: p.nombre })}>
                {p.foto ? <img src={fotoUrl(p.foto)} alt="" className="size-10 shrink-0 rounded-lg object-cover" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
                  : <span className="size-10 shrink-0 rounded-lg bg-fondo-suave" />}
                <span className="min-w-0 flex-1 truncate font-bold">{p.nombre}</span>
                {p.stock <= 0 && <Insignia>Sin stock</Insignia>}
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-tinta-tenue">No hay productos visibles con ese nombre.</p>)}
    </div>
  );
}
