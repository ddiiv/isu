import Link from "next/link";
import type { ResenasInicio } from "@isu/shared";
import { Estrellas, decimal } from "../Estrellas";
import { Foto } from "../Foto";

/*
 * Al final del inicio: el promedio de TODAS las opiniones publicadas y las
 * últimas con algo escrito. Sin opiniones todavía, no aparece (una sección
 * vacía de reseñas resta confianza).
 */
export function OpinionesInicio({ datos }: { datos: ResenasInicio }) {
  if (!datos.cantidad || !datos.promedio || !datos.resenas.length) return null;
  return (
    <section className="bg-fondo-suave" aria-labelledby="titulo-opiniones-inicio">
      <div className="contenedor py-14 lg:py-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 id="titulo-opiniones-inicio" className="text-[clamp(2rem,5vw,3.6rem)] leading-none">Lo que dicen quienes compraron</h2>
            <p className="mt-3 flex flex-wrap items-center gap-2 text-lg">
              <Estrellas valor={datos.promedio} className="text-xl" />
              <b>{decimal(datos.promedio)} de 5</b>
              <span className="text-tinta-suave">· {datos.cantidad} {datos.cantidad === 1 ? "opinión" : "opiniones"} de compras verificadas</span>
            </p>
          </div>
        </div>
        <ul className="-mx-4 mt-8 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
          {datos.resenas.map((r) => (
            <li key={r.id} className="flex w-[82%] shrink-0 snap-start flex-col rounded-[var(--radius-foto)] bg-white p-5 shadow-sm sm:w-[45%] lg:w-[31%]">
              <Estrellas valor={r.estrellas} />
              <p className="mt-3 line-clamp-6 flex-1 whitespace-pre-line leading-relaxed">“{r.texto}”</p>
              <div className="mt-4 flex items-center gap-3 border-t border-linea pt-4">
                {r.producto?.foto && (
                  <Link href={`/producto/${r.producto.slug}`} tabIndex={-1} aria-hidden="true" className="block aspect-[4/5] w-11 shrink-0 overflow-hidden rounded-lg bg-fondo-suave">
                    <Foto foto={r.producto.foto} alt="" sizes="44px" />
                  </Link>
                )}
                <div className="min-w-0 text-sm">
                  <p className="font-bold">{r.nombre} <span className="font-normal text-ahorro">· Compra verificada</span></p>
                  {r.producto
                    ? <Link href={`/producto/${r.producto.slug}`} className="block truncate text-tinta-suave hover:underline">{r.producto.nombre}</Link>
                    : <p className="text-tinta-suave">Sobre su compra</p>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
