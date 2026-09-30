"use client";
import Link from "next/link";
import { MEDIDAS, type ClaveMedida } from "@isu/shared";
import { fecha, useDatos } from "@/lib/api";
import type { GuiaResumen } from "@/lib/catalogo";
import { Cargando, Insignia, Mensaje, Titulo } from "@/components/ui";
import { puede, useYo } from "@/components/Marco";

/* Guías de talles: una por molde de prenda; cada producto se asocia a la suya. */
export default function Guias() {
  const yo = useYo();
  const { datos, error } = useDatos<{ guias: GuiaResumen[] }>("guias-talles");
  return (
    <>
      <Titulo acciones={puede(yo, "operador") && <Link href="/guias-talles/nueva" className="rounded-full bg-tinta px-4 py-2 text-sm font-bold text-white hover:bg-marca-fuerte">Nueva guía</Link>}>Guías de talles</Titulo>
      <p className="-mt-3 mb-6 max-w-2xl text-sm text-tinta-suave">Como en Mercado Libre: cada prenda mide distinto, así que se arma una guía por molde (por ejemplo "Remera regular adulto" o "Jogger niños") y se asocia a los productos que tienen esos talles. En la tienda aparece el botón "Guía de talles" y la calculadora "¿Cuál es mi talle?".</p>
      <Mensaje>{error}</Mensaje>
      {!datos ? <Cargando /> : (
        <div className="overflow-x-auto rounded-2xl border border-linea bg-white">
          <table className="tabla-apilada w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-linea text-tinta-tenue"><tr><th className="px-4 py-3">Guía</th><th className="px-4 py-3">Tipo</th><th className="px-4 py-3">Medidas</th><th className="px-4 py-3 text-right">Talles</th><th className="px-4 py-3 text-right">Productos</th><th className="px-4 py-3">Última edición</th></tr></thead>
            <tbody className="divide-y divide-linea">
              {datos.guias.map((g) => (
                <tr key={g.id} className="hover:bg-fondo-suave">
                  <td className="px-4 py-3"><Link href={`/guias-talles/${g.id}`} className="font-bold text-marca hover:underline">{g.nombre}</Link></td>
                  <td className="px-4 py-3"><Insignia>{g.tipo === "nino" ? "Niños 4–16" : "Adulto XS–5XL"}</Insignia></td>
                  <td className="px-4 py-3 text-xs" data-etiqueta="Medidas">{g.medidas.map((m) => MEDIDAS[m as ClaveMedida]?.nombre ?? m).join(", ")}</td>
                  <td className="px-4 py-3 text-right" data-etiqueta="Talles">{g.talles}</td>
                  <td className="px-4 py-3 text-right" data-etiqueta="Productos">{g.productos || <span className="text-oferta">0</span>}</td>
                  <td className="px-4 py-3 text-xs text-tinta-tenue">{fecha(g.actualizadoEn)}{g.actualizadoPor ? ` · ${g.actualizadoPor}` : ""}</td>
                </tr>
              ))}
              {!datos.guias.length && <tr><td colSpan={6} className="px-4 py-10 text-center text-tinta-tenue">Todavía no hay guías. Creá la primera.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
