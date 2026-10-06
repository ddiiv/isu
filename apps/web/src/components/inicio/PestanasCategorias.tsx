"use client";
import Link from "next/link";
import { useState } from "react";
import type { ProductoTarjeta } from "@isu/shared";
import { Grilla } from "../Grilla";
import { IconoFlecha } from "../iconos";

/* Mujer / Hombre / Niños en pestañas, con unas prendas de cada una (como las tiendas de referencia). */
export function PestanasCategorias({ grupos, descuento, cuotas }: {
  grupos: Array<{ slug: string; nombre: string; productos: ProductoTarjeta[] }>; descuento: number; cuotas: number;
}) {
  const con = grupos.filter((g) => g.productos.length);
  const [activa, setActiva] = useState(con[0]?.slug ?? "");
  if (!con.length) return null;
  const g = con.find((x) => x.slug === activa) ?? con[0]!;
  return (
    <section className="contenedor py-14 lg:py-20" aria-labelledby="titulo-pestanas">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 id="titulo-pestanas" className="text-[clamp(2rem,5vw,3.6rem)] leading-none">Para cada uno</h2>
        <Link href={`/${g.slug}`} className="inline-flex shrink-0 items-center gap-1 text-[15px] font-bold text-marca hover:underline">Ver todo {g.nombre} <IconoFlecha /></Link>
      </div>
      <div role="tablist" aria-label="Categorías" className="mt-6 flex gap-2 overflow-x-auto">
        {con.map((x) => (
          <button key={x.slug} type="button" role="tab" id={`pestana-${x.slug}`} aria-selected={x.slug === g.slug} aria-controls={`panel-${x.slug}`}
            onClick={() => setActiva(x.slug)}
            className={`shrink-0 rounded-full px-5 py-2 text-[15px] font-bold transition ${x.slug === g.slug ? "bg-tinta text-white" : "bg-fondo-suave hover:bg-linea"}`}>
            {x.nombre}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${g.slug}`} aria-labelledby={`pestana-${g.slug}`}>
        <Grilla key={g.slug} productos={g.productos} lista={`Inicio · ${g.nombre}`} descuento={descuento} cuotas={cuotas} filtros={false} />
      </div>
    </section>
  );
}
