import type { Metadata } from "next";
import Link from "next/link";
import { obtenerCategorias, obtenerConfig, obtenerNuevos } from "@/lib/api";
import { FormBuscar } from "@/components/FormBuscar";
import { NuevosIngresos } from "@/components/NuevosIngresos";

/*
 * 404: cualquier dirección que no existe (una ruta tipeada mal, una prenda
 * que se dio de baja, un enlace viejo del sitio anterior). En vez de un
 * callejón sin salida: buscador, categorías y lo último que entró.
 * Next la sirve con estado 404 y noindex.
 */
export const metadata: Metadata = { title: "Página no encontrada", robots: { index: false, follow: true } };

export default async function NoEncontrada() {
  const [categorias, config, nuevos] = await Promise.all([obtenerCategorias(), obtenerConfig(), obtenerNuevos(4)]);
  return (
    <>
      <section className="contenedor py-16 text-center sm:py-20">
        <p className="font-display text-[clamp(5rem,16vw,9rem)] leading-none text-marca" aria-hidden="true">404</p>
        <h1 className="mt-4 text-[clamp(2rem,5vw,3rem)]">No encontramos esta página</h1>
        <p className="mx-auto mt-3 max-w-lg text-tinta-suave">Puede que la dirección esté mal escrita, que la prenda ya no esté o que el enlace haya cambiado. Buscala o elegí por dónde seguir:</p>
        <FormBuscar className="mx-auto mt-8 max-w-md" />
        <ul className="mt-6 flex flex-wrap justify-center gap-2">
          {categorias.map((c) => <li key={c.slug}><Link href={`/${c.slug}`} className="boton-borde py-2">{c.nombre}</Link></li>)}
          <li><Link href="/" className="boton-primario py-2">Ir al inicio</Link></li>
        </ul>
        <p className="mt-6 text-sm text-tinta-tenue">
          ¿Buscabas algo puntual? <a href={`https://wa.me/${config.whatsapp}?text=${encodeURIComponent("Hola Isuwaya! Estoy buscando una prenda y no la encuentro en la web.")}`} target="_blank" rel="noopener noreferrer" className="font-bold text-marca underline">Escribinos por WhatsApp</a>.
        </p>
      </section>
      <div className="border-t border-linea">
        <NuevosIngresos productos={nuevos.productos} descuento={config.descuentoTransferencia} cuotas={config.cuotasSinInteres} titulo="Te puede interesar" />
      </div>
    </>
  );
}
