import Link from "next/link";
import type { CategoriaNodo } from "@isu/shared";
import { Logo } from "./Logo";
import { MenuMovil } from "./MenuMovil";
import { IconoBolsa, IconoBuscar, IconoCuenta } from "./iconos";

/*
 * Header: logo a la izquierda, categorías al centro, acciones a la derecha.
 * En el celular, menú | logo | buscar + bolsa. Queda pegado arriba.
 */
export function Header({ categorias }: { categorias: CategoriaNodo[] }) {
  return (
    <header className="sticky top-0 z-40 border-b border-linea/70 bg-white">
      <div className="mx-auto grid h-16 max-w-7xl grid-cols-[1fr_auto_1fr] items-center gap-4 px-4 sm:px-6 lg:h-20 lg:px-10">
        <div className="flex items-center gap-3">
          <MenuMovil categorias={categorias} />
          <Logo className="hidden lg:flex" />
        </div>

        <Logo className="lg:hidden" />
        <nav aria-label="Categorías" className="hidden lg:block">
          <ul className="flex items-center gap-8 text-[15px]">
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
            <li><Link href="/locales" className="hover:text-marca">Locales</Link></li>
          </ul>
        </nav>

        <div className="flex items-center justify-end gap-1 sm:gap-3">
          <Link href="/buscar" aria-label="Buscar" className="rounded-full p-2.5 hover:bg-fondo-suave"><IconoBuscar /></Link>
          <Link href="/cuenta" aria-label="Mi cuenta" className="hidden rounded-full p-2 hover:bg-fondo-suave sm:block"><IconoCuenta /></Link>
          <Link href="/carrito" aria-label="Carrito, vacío" className="relative rounded-full p-2.5 hover:bg-fondo-suave"><IconoBolsa /></Link>
        </div>
      </div>
    </header>
  );
}
