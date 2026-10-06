import Link from "next/link";
import type { CategoriaNodo, ListadoProductos } from "@isu/shared";
import { obtenerCategorias, obtenerColeccion, obtenerColeccionDe, obtenerConfig } from "@/lib/api";
import { Grilla } from "./Grilla";
import { Migas } from "./Migas";
import { IconoFlecha } from "./iconos";

/*
 * Etapa 9: Packs y Liquidación, divididas por las categorías de arriba
 * (Hombre, Mujer, Niños), como en el menú.
 *
 *   /packs                todas, una sección por categoría
 *   /packs/hombre         sólo las de Hombre (con sus subcategorías)
 *   /liquidacion[/mujer]  lo mismo con lo que está en liquidación
 *
 * Un producto que está en dos categorías (unisex) sale en las dos.
 */
type Cual = "packs" | "liquidacion";
const TEXTOS: Record<Cual, { titulo: string; etiqueta: string; vacio: string }> = {
  packs: { titulo: "Packs", etiqueta: "📦 Llevá más, pagá menos", vacio: "Todavía no hay packs en esta sección." },
  liquidacion: { titulo: "Liquidación", etiqueta: "Fin de temporada", vacio: "Ahora no hay prendas en liquidación en esta sección." },
};

export async function PaginaSeccion({ cual, categoria }: { cual: Cual; categoria?: string }) {
  const [config, categorias] = await Promise.all([obtenerConfig(), obtenerCategorias()]);
  const t = TEXTOS[cual];
  const conAlgo = new Set(cual === "packs" ? config.packsEn : config.liquidacionEn);
  const secciones = categorias.filter((c) => conAlgo.has(c.slug));
  const actual = categoria ? categorias.find((c) => c.slug === categoria) ?? null : null;
  const bajada = cual === "packs"
    ? `Elegí de ${config.packs.minimo} a ${config.packs.maximo} unidades de la misma prenda y armalas con tus talles y colores: cuantas más, más barata cada una.`
    : "Prendas de la temporada pasada y elegidas para liquidar, a precio más bajo. Hasta agotar stock.";
  const grilla = (l: ListadoProductos, lista: string, filtros: boolean) => (
    <Grilla productos={l.productos} lista={lista} descuento={config.descuentoTransferencia} cuotas={config.cuotasSinInteres} filtros={filtros}
      packs={cual === "packs" ? config.packs : undefined} />
  );

  // Una categoría: la grilla entera, con filtros.
  if (actual) {
    const listado = await obtenerColeccionDe(cual, actual.slug);
    return (
      <Marco cual={cual} titulo={`${t.titulo} ${actual.nombre}`} bajada={bajada} etiqueta={t.etiqueta} secciones={secciones} actual={actual.slug}
        migas={[{ nombre: t.titulo, href: `/${cual}` }, { nombre: actual.nombre, href: `/${cual}/${actual.slug}` }]}>
        {listado?.productos.length ? grilla(listado, `${t.titulo} · ${actual.nombre}`, true) : <Vacio texto={t.vacio} cual={cual} />}
      </Marco>
    );
  }

  // Todas: una sección por categoría, y al final lo que no está en ninguna.
  const [todas, ...porCategoria] = await Promise.all([obtenerColeccion(cual), ...secciones.map((c) => obtenerColeccionDe(cual, c.slug))]);
  const mostradas = new Set(porCategoria.flatMap((l) => l?.productos.map((p) => p.id) ?? []));
  const resto = { productos: todas.productos.filter((p) => !mostradas.has(p.id)), total: 0 };
  return (
    <Marco cual={cual} titulo={t.titulo} bajada={bajada} etiqueta={t.etiqueta} secciones={secciones} actual={null} migas={[{ nombre: t.titulo, href: `/${cual}` }]}>
      {!todas.productos.length && <Vacio texto={t.vacio} cual={cual} />}
      {secciones.map((c, i) => {
        const l = porCategoria[i];
        if (!l?.productos.length) return null;
        return (
          <section key={c.id} aria-labelledby={`seccion-${c.slug}`} className="mt-12 first:mt-8">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2 id={`seccion-${c.slug}`} className="text-[clamp(1.8rem,4vw,2.8rem)] leading-none">{t.titulo} {c.nombre}</h2>
              <Link href={`/${cual}/${c.slug}`} className="inline-flex items-center gap-1 text-[15px] font-bold text-marca hover:underline">Ver todo {c.nombre} <IconoFlecha /></Link>
            </div>
            <div className="mt-5">{grilla({ productos: l.productos.slice(0, 8), total: 0 }, `${t.titulo} · ${c.nombre}`, false)}</div>
          </section>
        );
      })}
      {resto.productos.length > 0 && (
        <section aria-labelledby="seccion-resto" className="mt-12 first:mt-8">
          <h2 id="seccion-resto" className="text-[clamp(1.8rem,4vw,2.8rem)] leading-none">{secciones.length ? `Más ${t.titulo.toLowerCase()}` : t.titulo}</h2>
          <div className="mt-5">{grilla(resto, t.titulo, false)}</div>
        </section>
      )}
    </Marco>
  );
}

function Marco({ cual, titulo, bajada, etiqueta, secciones, actual, migas, children }: {
  cual: Cual; titulo: string; bajada: string; etiqueta: string; secciones: CategoriaNodo[]; actual: string | null;
  migas: Array<{ nombre: string; href: string }>; children: React.ReactNode;
}) {
  return (
    <div className="contenedor pt-8 pb-16">
      <Migas items={migas} />
      <p className={`mt-4 text-sm font-bold uppercase tracking-widest ${cual === "packs" ? "text-ahorro" : "text-oferta"}`}>{etiqueta}</p>
      <h1 className="mt-1 text-[clamp(2.6rem,7vw,5.5rem)] leading-[0.95]">{titulo}</h1>
      <p className="mt-3 max-w-2xl text-lg text-tinta-suave">{bajada}</p>
      {secciones.length > 0 && (
        <nav aria-label={`${titulo} por categoría`} className="mt-6">
          <ul className="flex flex-wrap gap-2">
            <li><Link href={`/${cual}`} aria-current={actual === null ? "page" : undefined} className={chip(actual === null)}>Todo</Link></li>
            {secciones.map((c) => (
              <li key={c.id}><Link href={`/${cual}/${c.slug}`} aria-current={actual === c.slug ? "page" : undefined} className={chip(actual === c.slug)}>{c.nombre}</Link></li>
            ))}
          </ul>
        </nav>
      )}
      {children}
    </div>
  );
}
const chip = (activo: boolean) => `block rounded-full px-4 py-2 text-[15px] font-bold ${activo ? "bg-tinta text-white" : "bg-fondo-suave hover:bg-linea"}`;

function Vacio({ texto, cual }: { texto: string; cual: Cual }) {
  return (
    <div className="mt-10 rounded-[var(--radius-foto)] border border-dashed border-linea px-6 py-16 text-center">
      <p className="font-display text-2xl">{texto}</p>
      <p className="mt-2 text-tinta-suave">
        {cual === "packs" ? <>Mirá <Link href="/packs" className="underline">todos los packs</Link> o lo <Link href="/nuevos" className="underline">nuevo</Link>.</> : <>Mirá lo <Link href="/nuevos" className="underline">nuevo</Link> o los <Link href="/packs" className="underline">packs</Link>: también salen más baratos.</>}
      </p>
    </div>
  );
}
