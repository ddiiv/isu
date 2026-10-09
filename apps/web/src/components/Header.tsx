import Link from "next/link";
import type { CategoriaNodo } from "@isu/shared";
import { Logo } from "./Logo";
import { MenuAcceso, MenuMovil, type FotoDelMenu } from "./MenuMovil";
import { Foto } from "./Foto";
import { IconoBuscar, IconoCuenta } from "./iconos";
import { BotonCarrito } from "./carrito/CajonCarrito";
import { SITIO } from "@/lib/sitio";

/*
 * Header: logo a la izquierda, categorías al centro, acciones a la derecha.
 * "Armá tu outfit" y "Pedido mayorista" son botones y se ven SIEMPRE: en la
 * compu a la derecha; en celular y tablet, en una segunda fila de accesos
 * (que se desliza de costado si no entra). Queda pegado arriba.
 *
 * Etapa 9: Packs y Liquidación con su desplegable por categoría (sólo las
 * que tienen algo), y cada categoría con 1 o 2 fotos de prendas que la
 * representan. En el celular, los accesos de las categorías, Packs y
 * Liquidación abren el menú en su panel.
 */
// Al menú del celular (que viaja al navegador) sólo lo que muestra: no los textos de cada categoría.
const paraMenu = (c: CategoriaNodo): CategoriaNodo => ({ id: c.id, nombre: c.nombre, slug: c.slug, hijas: c.hijas.map(paraMenu) });

export interface DatosMenu { hayPacks: boolean; packsEn: string[]; hayLiquidacion: boolean; liquidacionEn: string[]; fotos: Record<string, FotoDelMenu[]> }

const desplegable = "invisible absolute left-1/2 top-full z-50 -translate-x-1/2 translate-y-1 rounded-2xl border border-linea bg-white p-2 opacity-0 shadow-xl transition duration-200 ease-suave group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100";
const item = "block rounded-xl px-3 py-2 hover:bg-fondo-suave";

export function Header({ categorias, menu }: { categorias: CategoriaNodo[]; menu: DatosMenu }) {
  const { hayPacks, packsEn, hayLiquidacion, liquidacionEn, fotos } = menu;
  const conPacks = categorias.filter((c) => packsEn.includes(c.slug));
  const enLiquidacion = categorias.filter((c) => liquidacionEn.includes(c.slug));
  return (
    <header className="encabezado sticky top-0 z-40 border-b border-linea/70 bg-white">
      <div className="mx-auto grid h-16 max-w-7xl grid-cols-[1fr_auto_1fr] items-center gap-4 px-4 sm:px-6 lg:h-20 lg:px-10">
        <div className="flex items-center gap-3">
          <MenuMovil categorias={categorias.map(paraMenu)} fotos={fotos} packsEn={packsEn} liquidacionEn={liquidacionEn} hayPacks={hayPacks} hayLiquidacion={hayLiquidacion} />
          <Logo className="hidden lg:flex" />
        </div>

        <Logo className="lg:hidden" />
        <nav aria-label="Categorías" className="hidden lg:block">
          <ul className="flex items-center gap-6 text-[15px] xl:gap-7">
            <li><Link href="/nuevos" className="py-7 font-bold text-marca underline decoration-transparent decoration-2 underline-offset-8 transition-colors duration-200 ease-suave hover:decoration-current">Nuevos</Link></li>
            {hayPacks && (
              <li className="group relative">
                <Link href="/packs" className="py-7 font-bold text-ahorro underline decoration-transparent decoration-2 underline-offset-8 transition-colors duration-200 ease-suave hover:decoration-current">Packs</Link>
                {conPacks.length > 0 && (
                  <div className={`${desplegable} w-56`}>
                    {conPacks.map((c) => <Link key={c.id} href={`/packs/${c.slug}`} className={item}>Packs {c.nombre}</Link>)}
                    <Link href="/packs" className="mt-1 block rounded-xl px-3 py-2 font-bold text-ahorro hover:bg-ahorro-claro">Todos los packs</Link>
                  </div>
                )}
              </li>
            )}
            {hayLiquidacion && (
              <li className="group relative">
                <Link href="/liquidacion" className="py-7 font-bold text-oferta underline decoration-transparent decoration-2 underline-offset-8 transition-colors duration-200 ease-suave hover:decoration-current">Liquidación</Link>
                {enLiquidacion.length > 0 && (
                  <div className={`${desplegable} w-56`}>
                    {enLiquidacion.map((c) => <Link key={c.id} href={`/liquidacion/${c.slug}`} className={item}>Liquidación {c.nombre}</Link>)}
                    <Link href="/liquidacion" className="mt-1 block rounded-xl px-3 py-2 font-bold text-oferta hover:bg-fondo-suave">Toda la liquidación</Link>
                  </div>
                )}
              </li>
            )}
            {categorias.map((c) => {
              const suyas = fotos[c.slug] ?? [];
              if (!c.hijas.length && !suyas.length) return <li key={c.id}><Link href={`/${c.slug}`} className="py-7 font-bold underline decoration-transparent decoration-2 underline-offset-8 transition-colors duration-200 ease-suave hover:decoration-current hover:text-marca">{c.nombre}</Link></li>;
              return (
                <li key={c.id} className="group relative">
                  <Link href={`/${c.slug}`} className="py-7 font-bold underline decoration-transparent decoration-2 underline-offset-8 transition-colors duration-200 ease-suave hover:decoration-current hover:text-marca focus-visible:text-marca">{c.nombre}</Link>
                  <div className={`${desplegable} flex gap-3 ${suyas.length ? "w-[34rem]" : "w-56"}`}>
                    <div className="w-52 shrink-0">
                      {c.hijas.map((h) => <Link key={h.id} href={`/${c.slug}/${h.slug}`} className={item}>{h.nombre}</Link>)}
                      {packsEn.includes(c.slug) && <Link href={`/packs/${c.slug}`} className={`${item} font-bold text-ahorro`}>📦 Packs {c.nombre}</Link>}
                      {liquidacionEn.includes(c.slug) && <Link href={`/liquidacion/${c.slug}`} className={`${item} font-bold text-oferta`}>Liquidación {c.nombre}</Link>}
                      <Link href={`/${c.slug}`} className="mt-1 block rounded-xl px-3 py-2 font-bold text-marca hover:bg-marca-claro">Ver todo {c.nombre}</Link>
                    </div>
                    {suyas.length > 0 && (
                      <ul className="grid flex-1 grid-cols-2 gap-2 p-1">
                        {suyas.map((f) => (
                          <li key={f.slug}>
                            <Link href={`/producto/${f.slug}`} className="group/foto block">
                              <span className="block aspect-[4/5] overflow-hidden rounded-xl bg-fondo-suave">
                                <Foto foto={f.foto} alt={f.nombre} sizes="160px" className="transition duration-500 group-hover/foto:scale-[1.03]" />
                              </span>
                              <span className="mt-1 block text-xs leading-snug">{f.nombre}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="flex items-center justify-end gap-1 sm:gap-3">
          <Link href="/outfits" className="hidden whitespace-nowrap rounded-full bg-marca px-4 py-2 text-sm font-bold text-white transition duration-200 ease-suave hover:bg-marca-fuerte active:scale-[0.97] lg:inline-block">Armá tu outfit</Link>
          {/* Tienda por mayor: el destino sale de MAYORISTA_URL (ver /mayorista). */}
          <a href={SITIO.mayorista} rel="nofollow" className="hidden whitespace-nowrap rounded-full border border-tinta px-4 py-2 text-sm font-bold transition duration-200 ease-suave hover:bg-tinta hover:text-white active:scale-[0.97] lg:inline-block">Pedido mayorista</a>
          <Link href="/buscar" aria-label="Buscar" className="rounded-full p-2.5 hover:bg-fondo-suave"><IconoBuscar /></Link>
          <Link href="/cuenta" aria-label="Mi cuenta" className="hidden rounded-full p-2 hover:bg-fondo-suave sm:block"><IconoCuenta /></Link>
          <BotonCarrito />
        </div>
      </div>

      {/* Celular y tablet: los accesos principales a la vista. Packs, Liquidación y las categorías abren el menú en su panel. */}
      <nav aria-label="Accesos" className="border-t border-linea/70 lg:hidden">
        <ul className="mx-auto flex max-w-7xl items-center gap-2 overflow-x-auto px-4 py-2 text-sm [scrollbar-width:none] sm:px-6">
          <li className="shrink-0"><Link href="/outfits" className="block whitespace-nowrap rounded-full bg-marca px-3.5 py-1.5 font-bold text-white">Armá tu outfit</Link></li>
          <li className="shrink-0"><a href={SITIO.mayorista} rel="nofollow" className="block whitespace-nowrap rounded-full border border-tinta px-3.5 py-1.5 font-bold">Pedido mayorista</a></li>
          <li className="shrink-0"><Link href="/nuevos" className="block whitespace-nowrap rounded-full px-3 py-1.5 font-bold text-marca">Nuevos</Link></li>
          {hayPacks && <li className="shrink-0"><MenuAcceso panel="packs" className="block whitespace-nowrap rounded-full px-3 py-1.5 font-bold text-ahorro">Packs</MenuAcceso></li>}
          {hayLiquidacion && <li className="shrink-0"><MenuAcceso panel="liquidacion" className="block whitespace-nowrap rounded-full px-3 py-1.5 font-bold text-oferta">Liquidación</MenuAcceso></li>}
          {categorias.map((c) => (
            <li key={c.id} className="shrink-0">
              {c.hijas.length || fotos[c.slug]?.length
                ? <MenuAcceso panel={c.slug} className="block whitespace-nowrap rounded-full px-3 py-1.5 font-bold">{c.nombre}</MenuAcceso>
                : <Link href={`/${c.slug}`} className="block whitespace-nowrap rounded-full px-3 py-1.5 font-bold">{c.nombre}</Link>}
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
