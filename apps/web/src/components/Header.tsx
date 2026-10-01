import Link from "next/link";
import type { CategoriaNodo } from "@isu/shared";
import { Logo } from "./Logo";
import { MenuMovil } from "./MenuMovil";
import { IconoBuscar, IconoCuenta } from "./iconos";
import { BotonCarrito } from "./carrito/CajonCarrito";
import { SITIO } from "@/lib/sitio";

/*
 * Header: logo a la izquierda, categorías al centro, acciones a la derecha.
 * "Armá tu outfit" y "Pedido mayorista" son botones y se ven SIEMPRE: en la
 * compu a la derecha; en celular y tablet, en una segunda fila de accesos
 * (que se desliza de costado si no entra). Queda pegado arriba.
 */
// Al menú del celular (que viaja al navegador) sólo lo que muestra: no los textos de cada categoría.
const paraMenu = (c: CategoriaNodo): CategoriaNodo => ({ id: c.id, nombre: c.nombre, slug: c.slug, hijas: c.hijas.map(paraMenu) });

export function Header({ categorias }: { categorias: CategoriaNodo[] }) {
  return (
    <header className="sticky top-0 z-40 border-b border-linea/70 bg-white">
      <div className="mx-auto grid h-16 max-w-7xl grid-cols-[1fr_auto_1fr] items-center gap-4 px-4 sm:px-6 lg:h-20 lg:px-10">
        <div className="flex items-center gap-3">
          <MenuMovil categorias={categorias.map(paraMenu)} />
          <Logo className="hidden lg:flex" />
        </div>

        <Logo className="lg:hidden" />
        <nav aria-label="Categorías" className="hidden lg:block">
          <ul className="flex items-center gap-7 text-[15px]">
            <li><Link href="/nuevos" className="py-7 font-bold text-marca hover:underline">Nuevos</Link></li>
            {categorias.map((c) => (
              <li key={c.id} className="group relative">
                <Link href={`/${c.slug}`} className="py-7 font-bold hover:text-marca focus-visible:text-marca">{c.nombre}</Link>
                {c.hijas.length > 0 && (
                  <div className="invisible absolute left-1/2 top-full z-50 w-56 -translate-x-1/2 rounded-2xl border border-linea bg-white p-2 opacity-0 shadow-xl transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
                    {c.hijas.map((h) => (
                      <Link key={h.id} href={`/${c.slug}/${h.slug}`} className="block rounded-xl px-3 py-2 hover:bg-fondo-suave">{h.nombre}</Link>
                    ))}
                    <Link href={`/${c.slug}`} className="mt-1 block rounded-xl px-3 py-2 font-bold text-marca hover:bg-marca-claro">Ver todo {c.nombre}</Link>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center justify-end gap-1 sm:gap-3">
          <Link href="/outfits" className="hidden whitespace-nowrap rounded-full bg-marca px-4 py-2 text-sm font-bold text-white hover:bg-marca-fuerte lg:inline-block">Armá tu outfit</Link>
          {/* Tienda por mayor: el destino sale de MAYORISTA_URL (ver /mayorista). */}
          <a href={SITIO.mayorista} rel="nofollow" className="hidden whitespace-nowrap rounded-full border border-tinta px-4 py-2 text-sm font-bold hover:bg-tinta hover:text-white lg:inline-block">Pedido mayorista</a>
          <Link href="/buscar" aria-label="Buscar" className="rounded-full p-2.5 hover:bg-fondo-suave"><IconoBuscar /></Link>
          <Link href="/cuenta" aria-label="Mi cuenta" className="hidden rounded-full p-2 hover:bg-fondo-suave sm:block"><IconoCuenta /></Link>
          <BotonCarrito />
        </div>
      </div>

      {/* Celular y tablet: los accesos principales a la vista, sin abrir el menú. */}
      <nav aria-label="Accesos" className="border-t border-linea/70 lg:hidden">
        <ul className="mx-auto flex max-w-7xl items-center gap-2 overflow-x-auto px-4 py-2 text-sm [scrollbar-width:none] sm:px-6">
          <li className="shrink-0"><Link href="/outfits" className="block whitespace-nowrap rounded-full bg-marca px-3.5 py-1.5 font-bold text-white">Armá tu outfit</Link></li>
          <li className="shrink-0"><a href={SITIO.mayorista} rel="nofollow" className="block whitespace-nowrap rounded-full border border-tinta px-3.5 py-1.5 font-bold">Pedido mayorista</a></li>
          <li className="shrink-0"><Link href="/nuevos" className="block whitespace-nowrap rounded-full px-3 py-1.5 font-bold text-marca">Nuevos</Link></li>
          {categorias.map((c) => (
            <li key={c.id} className="shrink-0"><Link href={`/${c.slug}`} className="block whitespace-nowrap rounded-full px-3 py-1.5 font-bold">{c.nombre}</Link></li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
