import type { FotoPublica } from "@isu/shared";
import { src, srcSet } from "@/lib/fotos";

/*
 * Foto de producto con los tamaños pregenerados (srcset). Sin foto cargada,
 * un relleno con la marca: la prenda se puede vender igual mientras se sacan
 * las fotos.
 */
export function Foto({
  foto, alt, sizes, prioridad = false, className = "", tono,
}: { foto: FotoPublica | null; alt: string; sizes: string; prioridad?: boolean; className?: string; tono?: string | null }) {
  if (!foto) return <SinFoto alt={alt} className={className} tono={tono} />;
  return (
    // <img> y no next/image: los tamaños ya vienen hechos desde el bucket.
    <img
      src={src(foto)}
      srcSet={srcSet(foto)}
      sizes={sizes}
      alt={foto.alt && foto.alt !== alt ? `${alt} · ${foto.alt}` : alt}
      width={foto.ancho ?? 1000}
      height={foto.alto ?? 1250}
      loading={prioridad ? "eager" : "lazy"}
      fetchPriority={prioridad ? "high" : "auto"}
      decoding="async"
      className={`size-full object-cover ${className}`}
    />
  );
}

export function SinFoto({ alt, className = "", tono }: { alt: string; className?: string; tono?: string | null }) {
  return (
    <div role="img" aria-label={`${alt} (foto próximamente)`} className={`grid size-full place-items-center bg-fondo-suave ${className}`}>
      <div className="flex flex-col items-center gap-3 text-tinta-tenue">
        <span className="size-14 rounded-full border-4 border-white shadow" style={{ background: tono ?? "var(--color-marca-claro)" }} />
        <span className="text-xs font-bold uppercase tracking-widest">Foto próximamente</span>
      </div>
    </div>
  );
}
