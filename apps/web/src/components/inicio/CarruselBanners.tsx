"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatearPesos, type BannerPublico } from "@isu/shared";
import { Banner } from "@isu/ui/banner";
import { src, srcBanner, srcSetBanner } from "@/lib/fotos";

/*
 * Carrusel de la portada (backoffice → Portada). Cada banner tiene su foto
 * para compu y, si se cargó, otra para celular (vertical). Pasa solo cada 6
 * segundos, pero se frena si el mouse o el foco están encima, y no se mueve
 * si la persona pidió menos animaciones. En el celular se desliza con el dedo
 * (scroll-snap: sin librerías).
 *
 * Etapa 12: cada banner puede tener título, texto, botones y un producto
 * (componente Banner de @isu/ui, el mismo de la vista previa del backoffice).
 */

export function CarruselBanners({ banners }: { banners: BannerPublico[] }) {
  const pista = useRef<HTMLUListElement>(null);
  const [actual, setActual] = useState(0);
  const [quieto, setQuieto] = useState(false);

  const ir = useCallback((i: number) => {
    const el = pista.current;
    if (!el) return;
    const n = banners.length;
    el.scrollTo({ left: el.clientWidth * (((i % n) + n) % n), behavior: "smooth" });
  }, [banners.length]);

  useEffect(() => {
    if (banners.length < 2 || quieto || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => ir(actual + 1), 6000);
    return () => clearInterval(t);
  }, [actual, quieto, ir, banners.length]);

  return (
    <section aria-roledescription="carrusel" aria-label="Novedades" className="relative bg-fondo-suave"
      onMouseEnter={() => setQuieto(true)} onMouseLeave={() => setQuieto(false)} onFocusCapture={() => setQuieto(true)} onBlurCapture={() => setQuieto(false)}>
      <ul ref={pista} className="flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onScroll={(e) => { const el = e.currentTarget; setActual(Math.round(el.scrollLeft / Math.max(1, el.clientWidth))); }}>
        {banners.map((b, i) => (
          <li key={b.id} className="flex w-full shrink-0 snap-start" aria-roledescription="diapositiva" aria-label={`${i + 1} de ${banners.length}`}>
            <div className="h-full w-full">
              <Banner b={b} srcBanner={(c) => srcBanner(c)} srcSetBanner={srcSetBanner} srcProducto={(c) => src({ clave: c, ancho: null, alto: null, alt: null }, 800)} pesos={formatearPesos} prioridad={i === 0} />
            </div>
          </li>
        ))}
      </ul>
      {banners.length > 1 && (
        <>
          <button type="button" onClick={() => ir(actual - 1)} aria-label="Anterior"
            className="absolute left-3 top-1/2 hidden size-11 -translate-y-1/2 place-items-center rounded-full bg-white/85 text-xl shadow hover:bg-white md:grid">‹</button>
          <button type="button" onClick={() => ir(actual + 1)} aria-label="Siguiente"
            className="absolute right-3 top-1/2 hidden size-11 -translate-y-1/2 place-items-center rounded-full bg-white/85 text-xl shadow hover:bg-white md:grid">›</button>
          <div className="absolute inset-x-0 bottom-3 flex justify-center gap-2">
            {banners.map((b, i) => (
              <button key={b.id} type="button" onClick={() => ir(i)} aria-label={`Ir al ${i + 1}`} aria-current={i === actual}
                className={`h-2.5 rounded-full shadow ring-1 ring-black/15 transition-all ${i === actual ? "w-7 bg-white" : "w-2.5 bg-white/70"}`} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
