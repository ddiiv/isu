"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BannerPublico } from "@isu/shared";
import { srcBanner, srcSetBanner } from "@/lib/fotos";

/*
 * Carrusel de la portada (backoffice → Portada). Cada banner tiene su foto
 * para compu y, si se cargó, otra para celular (vertical). Pasa solo cada 6
 * segundos, pero se frena si el mouse o el foco están encima, y no se mueve
 * si la persona pidió menos animaciones. En el celular se desliza con el dedo
 * (scroll-snap: sin librerías).
 */
/** Sólo una ruta de esta tienda (la base y la API ya lo exigen: tercera llave, como en las redirecciones). */
const enlacePropio = (e: string | null) => (e && /^\/(?![/\\])\S*$/.test(e) ? e : null);

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
        {banners.map((b, i) => {
          const foto = (
            <picture>
              {b.fotoMovil && <source media="(max-width: 767px)" srcSet={srcSetBanner(b.fotoMovil.clave)} sizes="100vw" />}
              <img src={srcBanner(b.foto.clave)} srcSet={srcSetBanner(b.foto.clave)} sizes="100vw" alt={b.alt}
                width={b.foto.ancho ?? 2400} height={b.foto.alto ?? 900}
                loading={i === 0 ? "eager" : "lazy"} fetchPriority={i === 0 ? "high" : "auto"} decoding="async"
                className="block h-auto max-h-[78vh] w-full object-cover" />
            </picture>
          );
          return (
            <li key={b.id} className="w-full shrink-0 snap-start" aria-roledescription="diapositiva" aria-label={`${i + 1} de ${banners.length}`}>
              {enlacePropio(b.enlace) ? <Link href={enlacePropio(b.enlace)!} className="block">{foto}</Link> : foto}
            </li>
          );
        })}
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
                className={`h-2.5 rounded-full shadow transition-all ${i === actual ? "w-7 bg-white" : "w-2.5 bg-white/60"}`} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
