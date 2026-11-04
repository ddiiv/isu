"use client";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

/*
 * Las etiquetas de producto sobre la foto de un banner de imagen: un punto
 * discreto (sin el nombre a la vista) que al tocarlo muestra una tarjeta con
 * la foto, el nombre y el precio; la tarjeta lleva a la ficha del producto.
 *
 *   · Una abierta por vez. Se cierra tocando afuera, con Escape o tocando el
 *     punto de nuevo. Tocar la foto con una abierta sólo la cierra: no sigue
 *     el link del banner.
 *   · El punto toma el foco al tocarlo: así el carrusel se frena mientras se
 *     mira la tarjeta (también en Safari, que no enfoca los botones al tocarlos).
 *   · En el celular, si el banner tiene foto vertical, usa los lugares de esa
 *     foto; una etiqueta sin lugar en la vertical no se ve.
 *   · La tarjeta va abajo o arriba del punto; si la foto es muy baja (la de
 *     compu en un celular), al costado: nunca tapa su punto si hay lugar.
 *   · Si el banner sale de la pantalla (el carrusel pasó al siguiente), se cierra.
 *   · En la vista previa del backoffice (`vista`) sólo se dibujan los puntos.
 */
type Hijos = Parameters<typeof Link>[0]["children"];

export interface EtiquetaVista {
  x: number; y: number; xMovil: number | null; yMovil: number | null;
  producto: { slug: string; nombre: string; precio: number; precioLista: number | null; foto: { clave: string; alt: string | null } | null };
}

/** El mismo corte que el <source> del banner: hasta 767 px se ve la foto de celular. */
const CELULAR = "(max-width: 767px)";
/** La tarjeta mide 240 × 96 px; se separa 22 px del centro del punto y 8 px del borde. */
const ANCHO = 240, ALTO = 96, SEPARA = 22, BORDE = 8;
const entre = (min: number, v: number, max: number) => Math.max(min, Math.min(v, max));

/** Dónde va la tarjeta (en px de la foto) para no tapar su punto. */
export function lugarTarjeta(px: number, py: number, w: number, h: number) {
  const izquierda = entre(BORDE, px - 20, w - ANCHO - BORDE);
  if (py + SEPARA + ALTO <= h - BORDE) return { left: izquierda, top: py + SEPARA };
  if (py - SEPARA - ALTO >= BORDE) return { left: izquierda, top: py - SEPARA - ALTO };
  const arriba = entre(BORDE, py - ALTO / 2, h - ALTO - BORDE);
  if (px + SEPARA + ANCHO <= w - BORDE) return { left: px + SEPARA, top: arriba };
  if (px - SEPARA - ANCHO >= BORDE) return { left: px - SEPARA - ANCHO, top: arriba };
  // No entra en ningún lado sin tapar el punto: abajo, adentro de la foto.
  return { left: izquierda, top: entre(BORDE, py + SEPARA, h - ALTO - BORDE) };
}

export function Etiquetas({ etiquetas, fotoMovil, vista, movil, srcProducto, pesos, children }: {
  etiquetas: EtiquetaVista[];
  /** si el banner tiene foto de celular (con sus propios lugares) */
  fotoMovil: boolean;
  vista: boolean;
  movil: boolean;
  srcProducto: (clave: string) => string;
  pesos: (centavos: number) => string;
  children: Hijos;
}) {
  const id = useId();
  const caja = useRef<HTMLDivElement>(null);
  const puntos = useRef<Array<HTMLButtonElement | null>>([]);
  const [abierta, setAbierta] = useState<number | null>(null);
  // El tamaño de la foto al abrir (para ubicar la tarjeta).
  const [medida, setMedida] = useState({ w: 0, h: 0 });
  // null hasta montar: los lugares dependen del ancho de la pantalla (así el HTML del servidor no difiere).
  const [enCelular, setEnCelular] = useState<boolean | null>(null);

  useEffect(() => {
    if (vista) return;
    const mq = window.matchMedia(CELULAR);
    const alCambiar = () => { setEnCelular(mq.matches); setAbierta(null); };
    alCambiar();
    mq.addEventListener("change", alCambiar);
    return () => mq.removeEventListener("change", alCambiar);
  }, [vista]);

  useEffect(() => {
    if (abierta === null) return;
    const afuera = (e: MouseEvent) => { if (!caja.current?.contains(e.target as Node)) setAbierta(null); };
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      puntos.current[abierta]?.focus();
      setAbierta(null);
    };
    document.addEventListener("click", afuera);
    document.addEventListener("keydown", tecla);
    // El carrusel pasó a otro banner (o se bajó la página): se cierra.
    const obs = "IntersectionObserver" in window && caja.current
      ? new IntersectionObserver(([e]) => { if (e && !e.isIntersecting) setAbierta(null); }, { threshold: 0.5 })
      : null;
    if (obs && caja.current) obs.observe(caja.current);
    return () => { document.removeEventListener("click", afuera); document.removeEventListener("keydown", tecla); obs?.disconnect(); };
  }, [abierta]);

  const chico = vista ? movil : enCelular;
  const lugares = chico === null ? [] : etiquetas.map((e) => {
    const x = chico && fotoMovil ? e.xMovil : e.x;
    const y = chico && fotoMovil ? e.yMovil : e.y;
    return x === null || y === null ? null : { x, y };
  });

  return (
    <div ref={caja} className="relative"
      // Con una tarjeta abierta, tocar la foto sólo la cierra (no sigue el link del banner).
      onClickCapture={(e) => {
        if (abierta === null || (e.target as Element).closest("[data-etiqueta]")) return;
        e.preventDefault();
        e.stopPropagation();
        setAbierta(null);
      }}>
      {children}
      {lugares.length > 0 && (
        <div className="pointer-events-none absolute inset-0">
          {etiquetas.map((e, i) => {
            const l = lugares[i];
            if (!l) return null;
            const p = e.producto;
            const abiertaEsta = abierta === i;
            const tarjeta = lugarTarjeta((l.x / 100) * medida.w, (l.y / 100) * medida.h, medida.w, medida.h);
            return (
              <div key={`${p.slug}-${i}`} data-etiqueta>
                <button type="button" ref={(el) => { puntos.current[i] = el; }} tabIndex={vista ? -1 : undefined}
                  aria-expanded={abiertaEsta} aria-controls={`${id}-${i}`} aria-label={`Ver ${p.nombre}`}
                  onClick={(ev) => {
                    ev.currentTarget.focus();
                    const r = caja.current?.getBoundingClientRect();
                    if (r) setMedida({ w: r.width, h: r.height });
                    setAbierta(abiertaEsta ? null : i);
                  }}
                  className="group/punto pointer-events-auto absolute grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-white"
                  style={{ left: `${l.x}%`, top: `${l.y}%` }}>
                  {!abiertaEsta && !vista && <span aria-hidden="true" className="absolute size-7 rounded-full bg-white/50 motion-safe:animate-ping [animation-duration:2.4s]" />}
                  <span aria-hidden="true" className={`relative grid size-7 place-items-center rounded-full shadow-lg ring-1 ring-black/15 backdrop-blur-sm transition duration-200 group-hover/punto:scale-110 ${abiertaEsta ? "bg-tinta" : "bg-white/90"}`}>
                    <span className={`size-2.5 rounded-full ${abiertaEsta ? "bg-white" : "bg-tinta"}`} />
                  </span>
                </button>
                {abiertaEsta && (
                  <div id={`${id}-${i}`} className="etiqueta-tarjeta pointer-events-auto absolute z-10 w-60" style={{ left: tarjeta.left, top: tarjeta.top }}>
                    <Link href={`/producto/${p.slug}`}
                      className="group/tarjeta flex h-24 gap-3 rounded-2xl bg-white p-2 text-tinta shadow-2xl ring-1 ring-black/5 transition hover:-translate-y-0.5">
                      <span className="block aspect-[4/5] h-full shrink-0 overflow-hidden rounded-xl bg-fondo-suave">
                        {p.foto && <img src={srcProducto(p.foto.clave)} alt="" loading="lazy" decoding="async" className="size-full object-cover" />}
                      </span>
                      <span className="flex min-w-0 flex-col justify-center gap-0.5 pr-1 text-left">
                        <span className="line-clamp-2 text-sm font-bold leading-snug">{p.nombre}</span>
                        <span className="text-[13px]">
                          {p.precioLista && p.precioLista > p.precio && <s className="mr-1.5 text-tinta-tenue">{pesos(p.precioLista)}</s>}
                          <b className="text-marca">{pesos(p.precio)}</b>
                        </span>
                        <span className="text-[13px] font-bold text-marca underline underline-offset-4">Ver producto <span aria-hidden="true">→</span></span>
                      </span>
                    </Link>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
