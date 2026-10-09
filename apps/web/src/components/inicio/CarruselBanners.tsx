"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatearPesos, type BannerPublico } from "@isu/shared";
import { Banner } from "@isu/ui/banner";
import { src, srcBanner, srcSetBanner } from "@/lib/fotos";

/*
 * Carrusel de la portada (backoffice → Portada). Cada banner tiene su foto
 * para compu y, si se cargó, otra para celular (vertical). En el celular se
 * desliza con el dedo (scroll-snap: sin librerías).
 *
 * Etapa 12: cada banner puede tener título, texto, botones y un producto
 * (componente Banner de @isu/ui, el mismo de la vista previa del backoffice).
 *
 * Etapa 14 (movimiento liviano):
 *   · al llegar a un banner, su texto entra escalonado y la foto se acomoda
 *     (data-activa + globals.css: sólo transform y opacidad);
 *   · el puntito del banner que se ve se va llenando hasta el próximo;
 *   · pasa solo cada 6 segundos, pero se frena con el mouse o el foco encima,
 *     con el botón de pausa, cuando el carrusel no está a la vista o la
 *     pestaña está oculta (no gasta batería), y nunca si la persona pidió
 *     menos animaciones.
 */
const CADA = 6000;

export function CarruselBanners({ banners }: { banners: BannerPublico[] }) {
  const caja = useRef<HTMLElement>(null);
  const pista = useRef<HTMLUListElement>(null);
  const [actual, setActual] = useState(0);
  const [quieto, setQuieto] = useState(false);
  const [pausado, setPausado] = useState(false);
  const [aLaVista, setALaVista] = useState(true);
  const [pestanaVisible, setPestanaVisible] = useState(true);
  const [menosMovimiento, setMenosMovimiento] = useState(false);
  const varios = banners.length > 1;

  const ir = useCallback((i: number) => {
    const el = pista.current;
    if (!el) return;
    const n = banners.length;
    el.scrollTo({ left: el.clientWidth * (((i % n) + n) % n), behavior: "smooth" });
  }, [banners.length]);

  // Cuándo no tiene sentido que pase solo: fuera de la pantalla, pestaña oculta o menos animaciones pedidas.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const alCambiarMovimiento = () => setMenosMovimiento(mq.matches);
    alCambiarMovimiento();
    mq.addEventListener("change", alCambiarMovimiento);
    const alCambiarPestana = () => setPestanaVisible(!document.hidden);
    document.addEventListener("visibilitychange", alCambiarPestana);
    const obs = caja.current && "IntersectionObserver" in window
      ? new IntersectionObserver(([e]) => setALaVista(!!e?.isIntersecting), { threshold: 0.25 })
      : null;
    if (obs && caja.current) obs.observe(caja.current);
    return () => {
      mq.removeEventListener("change", alCambiarMovimiento);
      document.removeEventListener("visibilitychange", alCambiarPestana);
      obs?.disconnect();
    };
  }, []);

  const pasaSolo = varios && !menosMovimiento;
  // Un solo reloj: la barrita del puntito. Cuando termina de llenarse, pasa al próximo; pausada, espera.
  const corriendo = pasaSolo && !pausado && !quieto && aLaVista && pestanaVisible;

  return (
    <section ref={caja} aria-roledescription="carrusel" aria-label="Novedades" className="group/carrusel relative bg-fondo-suave"
      onMouseEnter={() => setQuieto(true)} onMouseLeave={() => setQuieto(false)} onFocusCapture={() => setQuieto(true)} onBlurCapture={() => setQuieto(false)}>
      <ul ref={pista} className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onScroll={(e) => { const el = e.currentTarget; setActual(Math.round(el.scrollLeft / Math.max(1, el.clientWidth))); }}>
        {banners.map((b, i) => (
          <li key={b.id} data-activa={i === actual} className="flex w-full shrink-0 snap-start" aria-roledescription="diapositiva" aria-label={`${i + 1} de ${banners.length}`}>
            <div className="h-full w-full overflow-hidden">
              <Banner b={b} srcBanner={(c) => srcBanner(c)} srcSetBanner={srcSetBanner} srcProducto={(c) => src({ clave: c, ancho: null, alto: null, alt: null }, 800)} pesos={formatearPesos} prioridad={i === 0} />
            </div>
          </li>
        ))}
      </ul>
      {varios && (
        <>
          <button type="button" onClick={() => ir(actual - 1)} aria-label="Anterior"
            className="absolute left-3 top-1/2 hidden size-11 -translate-y-1/2 place-items-center rounded-full bg-white/80 text-xl shadow backdrop-blur-sm transition duration-200 ease-suave hover:scale-105 hover:bg-white active:scale-95 md:grid md:opacity-70 md:group-hover/carrusel:opacity-100 md:focus-visible:opacity-100">‹</button>
          <button type="button" onClick={() => ir(actual + 1)} aria-label="Siguiente"
            className="absolute right-3 top-1/2 hidden size-11 -translate-y-1/2 place-items-center rounded-full bg-white/80 text-xl shadow backdrop-blur-sm transition duration-200 ease-suave hover:scale-105 hover:bg-white active:scale-95 md:grid md:opacity-70 md:group-hover/carrusel:opacity-100 md:focus-visible:opacity-100">›</button>
          <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-2" data-pausado={!corriendo}>
            {banners.map((b, i) => (
              <button key={b.id} type="button" onClick={() => ir(i)} aria-label={`Ir al ${i + 1}`} aria-current={i === actual}
                className={`relative h-2.5 overflow-hidden rounded-full shadow ring-1 ring-black/15 transition-all duration-300 ease-suave ${i === actual ? "w-8 bg-white/60" : "w-2.5 bg-white/70 hover:bg-white"}`}>
                {/* El que se ve se llena hasta el próximo (vuelve a empezar en cada cambio: key). */}
                {i === actual && (pasaSolo
                  ? <span key={actual} aria-hidden="true" className="progreso-banner absolute inset-0 rounded-full bg-white" style={{ ["--duracion-banner" as string]: `${CADA}ms` }}
                      onAnimationEnd={() => ir(actual + 1)} />
                  : <span aria-hidden="true" className="absolute inset-0 rounded-full bg-white" />)}
              </button>
            ))}
            {pasaSolo && (
              <button type="button" onClick={() => setPausado((p) => !p)} aria-label={pausado ? "Seguir pasando los banners" : "Pausar los banners"} aria-pressed={pausado}
                className="ml-1 grid size-7 place-items-center rounded-full bg-white/80 text-[11px] text-tinta shadow ring-1 ring-black/15 backdrop-blur-sm transition duration-200 ease-suave hover:bg-white active:scale-95">
                <span aria-hidden="true">{pausado ? "▶" : "❚❚"}</span>
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
