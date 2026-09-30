import type { Metadata } from "next";
import Link from "next/link";
import { buscarProductos, obtenerCategorias, obtenerConfig } from "@/lib/api";
import { FormBuscar } from "@/components/FormBuscar";
import { Grilla } from "@/components/Grilla";

// Los resultados no se indexan (contenido duplicado): Google entra por las categorías y fichas.
export const metadata: Metadata = { title: "Buscar", robots: { index: false, follow: true } };

export default async function Buscar({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const crudo = (await searchParams).q;
  const q = ((Array.isArray(crudo) ? crudo[0] : crudo) ?? "").trim().slice(0, 60);
  const valida = q.length >= 2;
  const [config, categorias, r] = await Promise.all([
    obtenerConfig(),
    obtenerCategorias(),
    valida ? buscarProductos(q).catch(() => null) : Promise.resolve(null),
  ]);

  return (
    <div className="contenedor pt-8 pb-16">
      <h1 className="text-[clamp(2.2rem,6vw,4.5rem)] leading-none">{valida ? <>Resultados para <span className="text-marca">“{q}”</span></> : "Buscar"}</h1>
      <FormBuscar valor={q} autoFocus={!valida} className="mt-6 max-w-xl" />

      {valida && r === null && <p className="mt-10 text-tinta-suave">No pudimos buscar en este momento. Probá de nuevo en unos segundos.</p>}
      {valida && r && r.total > 0 && (
        <div className="mt-8"><Grilla productos={r.productos} lista="Búsqueda" descuento={config.descuentoTransferencia} cuotas={config.cuotasSinInteres} /></div>
      )}
      {(!valida || (r && r.total === 0)) && (
        <div className="mt-10">
          {valida && <p className="text-lg">No encontramos prendas con “{q}”. Probá con otra palabra o mirá las categorías:</p>}
          <ul className="mt-5 flex flex-wrap gap-2">
            {categorias.flatMap((c) => [
              <li key={c.slug}><Link href={`/${c.slug}`} className="boton-borde py-2">{c.nombre}</Link></li>,
            ])}
          </ul>
        </div>
      )}
    </div>
  );
}
