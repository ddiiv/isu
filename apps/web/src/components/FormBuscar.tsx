import { IconoBuscar } from "./iconos";

/* Buscador: un formulario GET común (funciona sin JavaScript). */
export function FormBuscar({ valor = "", autoFocus = false, className = "" }: { valor?: string; autoFocus?: boolean; className?: string }) {
  return (
    <form action="/buscar" method="get" role="search" className={`relative ${className}`}>
      <label htmlFor="q-buscar" className="sr-only">Buscar prendas</label>
      <input
        id="q-buscar" name="q" type="search" defaultValue={valor} autoFocus={autoFocus}
        minLength={2} maxLength={60} required placeholder="Buscá remeras, buzos, joggers…" enterKeyHint="search"
        className="w-full rounded-full border border-linea bg-white py-3.5 pl-5 pr-14 text-base outline-none focus:border-tinta"
      />
      <button type="submit" aria-label="Buscar" className="absolute right-1.5 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-tinta text-white hover:bg-marca-fuerte">
        <IconoBuscar className="size-5" />
      </button>
    </form>
  );
}
