/*
 * Gorrito de Navidad sobre el isotipo (edición Navidad). Sólo SVG y CSS: sin imagen nueva, sin JavaScript.
 * Se balancea y el pompón rebota (globals.css); con «menos movimiento» queda quieto. Es decoración: no se lee.
 */
export function GorroNavidad({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`gorro pointer-events-none absolute ${className}`}>
      <svg viewBox="0 0 40 36" className="block size-full overflow-visible" fill="none">
        <g transform="rotate(-14 20 30)">
          <path d="M6 28C7 14 16 6 27 7c5 .4 8 3 8.5 6.500C27 12.500 22.500 18 21 28z" className="fill-oferta" />
          <rect x="3" y="26" width="21" height="7" rx="3.500" className="fill-white stroke-[#cfcac6]" strokeWidth=".8" />
          <g className="gorro-pompon">
            <circle cx="35.500" cy="13.500" r="4.200" className="fill-white stroke-[#cfcac6]" strokeWidth=".8" />
          </g>
        </g>
      </svg>
    </span>
  );
}
