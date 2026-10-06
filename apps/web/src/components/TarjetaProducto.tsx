"use client";
import Link from "next/link";
import { useState } from "react";
import { conDescuento, centavos, esClaro, formatearPesos, rutaPack, type ProductoTarjeta } from "@isu/shared";
import { Foto } from "./Foto";
import { Precio } from "./Precio";
import { ResumenEstrellas } from "./Estrellas";
import { evento, item } from "@/lib/ga";

/*
 * Tarjeta de la grilla. Al pasar el mouse muestra la segunda foto; al tocar
 * un color muestra la foto de ese color (la prenda sola) y el enlace abre la
 * ficha con ese color elegido.
 */
export function TarjetaProducto({
  p, descuento, cuotas, lista, indice, prioridad = false, packs,
}: {
  p: ProductoTarjeta; descuento: number; cuotas: number; lista: string; indice: number; prioridad?: boolean;
  /** Etapa 8: en la sección Packs, la tarjeta lleva a la página del pack y muestra el precio por unidad del pack más grande. */
  packs?: number[];
}) {
  const [color, setColor] = useState<string | null>(null);
  const elegido = p.colores.find((c) => c.clave === color);
  const foto = elegido?.foto ?? p.foto;
  const comoPack = !!packs && p.pack;
  const maxPack = comoPack ? Math.max(...packs!) : 0;
  const href = comoPack ? rutaPack(p.slug, 2) : `/producto/${p.slug}${color ? `?color=${color}` : ""}`;
  const MAX = 5;

  return (
    <article className="group relative flex flex-col">
      {/* La foto es un segundo enlace a lo mismo: fuera del tabulador y de los lectores de pantalla (el nombre ya es el enlace). */}
      <Link
        href={href}
        tabIndex={-1}
        aria-hidden="true"
        onClick={() => evento("select_item", { item_list_name: lista, items: [item(p, { index: indice, item_list_name: lista })] })}
        className="relative block aspect-[4/5] overflow-hidden rounded-[var(--radius-foto)] bg-fondo-suave"
      >
        <Foto foto={foto} alt={p.nombre} sizes="(min-width:1024px) 25vw, 50vw" prioridad={prioridad} tono={elegido?.hex ?? p.colores[0]?.hex}
          className="transition duration-500 group-hover:scale-[1.02]" />
        {!elegido && p.fotoHover && (
          <div className="absolute inset-0 opacity-0 transition duration-300 group-hover:opacity-100">
            <Foto foto={p.fotoHover} alt={p.nombre} sizes="(min-width:1024px) 25vw, 50vw" />
          </div>
        )}
        <div className="absolute left-2 top-2 flex flex-col items-start gap-1">
          {p.agotado && <span className="rounded-full bg-tinta px-2.5 py-1 text-xs font-bold text-white">Agotado</span>}
          {!p.agotado && p.nuevo && <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-marca shadow-sm">Nuevo</span>}
          {!p.agotado && p.descuento ? <span className="rounded-full bg-oferta px-2.5 py-1 text-xs font-bold text-white">-{p.descuento}%</span> : null}
          {!p.agotado && p.pack && !comoPack ? <span className="rounded-full bg-ahorro px-2.5 py-1 text-xs font-bold text-white">Pack x2–x5</span> : null}
          {!p.agotado && comoPack ? <span className="rounded-full bg-ahorro px-2.5 py-1 text-xs font-bold text-white">Hasta {maxPack}% OFF</span> : null}
        </div>
      </Link>

      <div className="mt-3 flex flex-1 flex-col gap-1.5">
        {p.colores.length > 1 && (
          <ul className="flex flex-wrap items-center gap-1.5" aria-label="Colores">
            {p.colores.slice(0, MAX).map((c) => (
              <li key={c.clave}>
                <button
                  type="button"
                  onClick={() => setColor(c.clave === color ? null : c.clave)}
                  aria-pressed={c.clave === color}
                  aria-label={`${c.nombre}${c.hay ? "" : " (agotado)"}`}
                  title={c.nombre}
                  className={`relative grid size-7 place-items-center rounded-full ${c.clave === color ? "ring-2 ring-tinta ring-offset-1" : ""}`}
                >
                  <span
                    className={`block size-5 rounded-full ${c.hex && esClaro(c.hex) ? "border border-linea" : ""} ${c.hay ? "" : "opacity-40"}`}
                    style={{ background: c.hex ?? "linear-gradient(135deg,#ddd,#999)" }}
                  />
                </button>
              </li>
            ))}
            {p.colores.length > MAX && <li className="text-xs text-tinta-tenue">+{p.colores.length - MAX}</li>}
          </ul>
        )}
        <h3 className="font-sans text-[15px] font-normal leading-snug">
          <Link href={href} onClick={() => evento("select_item", { item_list_name: lista, items: [item(p, { index: indice, item_list_name: lista })] })} className="hover:underline">{p.nombre}</Link>
        </h3>
        <ResumenEstrellas promedio={p.resenas.promedio} cantidad={p.resenas.cantidad} className="text-xs" />
        {comoPack ? (
          <div className="space-y-0.5">
            <p className="text-xs text-tinta-tenue">Suelta {formatearPesos(p.precio)}</p>
            <p className="text-[15px] font-bold">desde {formatearPesos(conDescuento(centavos(p.precio), maxPack))} <span className="text-sm font-normal">c/u</span></p>
            <p className="text-xs font-bold text-ahorro">📦 Elegí 2, 3, 4 o 5 unidades</p>
          </div>
        ) : (
          <Precio precio={p.precio} precioHasta={p.precioHasta} precioLista={p.precioLista} rebaja={p.descuento} descuento={descuento} cuotas={cuotas} />
        )}
        {p.talles.length > 0 && <p className="text-xs text-tinta-tenue">Talles: {p.talles.join(" · ")}</p>}
      </div>
    </article>
  );
}
