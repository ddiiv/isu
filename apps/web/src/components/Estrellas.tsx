/*
 * Estrellas de las reseñas. Se dibujan con dos capas (vacías y llenas
 * recortadas al porcentaje): 4,6 muestra cuatro y un poco más de media.
 * Para quien no ve, un texto: "4,6 de 5 estrellas".
 */
const ESTRELLA = "M10 1.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.6 7.7l5.8-.8z";

function Fila({ className }: { className: string }) {
  return (
    <span className={`flex ${className}`} aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <svg key={i} viewBox="0 0 20 20" className="size-[1em] shrink-0"><path d={ESTRELLA} fill="currentColor" /></svg>
      ))}
    </span>
  );
}

export const decimal = (n: number) => n.toLocaleString("es-AR", { minimumFractionDigits: n % 1 ? 1 : 0, maximumFractionDigits: 1 });

export function Estrellas({ valor, className = "text-base" }: { valor: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, (valor / 5) * 100));
  return (
    <span className={`relative inline-flex ${className}`} role="img" aria-label={`${decimal(valor)} de 5 estrellas`}>
      <Fila className="text-linea" />
      <span className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${pct}%` }}><Fila className="text-estrella" /></span>
    </span>
  );
}

/** "★★★★½ 4,6 (12)" para tarjetas y la ficha. Sin reseñas, nada. */
export function ResumenEstrellas({ promedio, cantidad, className = "text-sm" }: { promedio: number | null; cantidad: number; className?: string }) {
  if (!promedio || !cantidad) return null;
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <Estrellas valor={promedio} />
      <span className="font-bold">{decimal(promedio)}</span>
      <span className="text-tinta-tenue">({cantidad})</span>
    </span>
  );
}
