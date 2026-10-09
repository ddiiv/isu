import type { Metadata } from "next";
import Link from "next/link";
import { obtenerConfig } from "@/lib/api";
import { Migas } from "@/components/Migas";
import { IconoWhatsapp } from "@/components/iconos";
import { localidades } from "@/lib/contacto";
import { SITIO } from "@/lib/sitio";

/*
 * Venta por mayor (etapa 13): la página que Google puede mostrar debajo de
 * «Isuwaya» como acceso, con el botón que lleva a la tienda mayorista. El
 * botón pasa por /mayorista, que redirige a MAYORISTA_URL (se cambia en
 * Railway sin publicar de nuevo).
 *
 * Sólo lo que la tienda ya dice: que somos fabricantes y que las compras por
 * mayor van por la tienda mayorista. Ni mínimos ni precios inventados.
 */
export const metadata: Metadata = {
  title: "Venta por mayor",
  description: `¿Tenés un local o revendés ropa? Hacé tu pedido en la tienda mayorista de ${SITIO.nombre}: fabricamos ropa urbana y casual para mujer, hombre y niños.`,
  alternates: { canonical: "/venta-por-mayor" },
};
export const revalidate = 300;

export default async function VentaPorMayor() {
  const config = await obtenerConfig();
  const donde = localidades(config.locales);
  return (
    <div className="contenedor pt-8">
      <Migas items={[{ nombre: "Venta por mayor", href: "/venta-por-mayor" }]} />
      <section className="mt-6 rounded-[var(--radius-foto)] bg-marca-claro px-6 py-12 sm:px-12 sm:py-16">
        <h1 className="text-[clamp(2.6rem,7vw,5.5rem)] leading-[0.95] text-marca">Venta por mayor</h1>
        <p className="mt-5 max-w-2xl text-xl text-tinta-suave">¿Tenés un local o revendés ropa? Las compras por mayor van por nuestra tienda mayorista.</p>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <a href={SITIO.mayorista} className="boton-marca text-lg">Hacer mi pedido mayorista <span aria-hidden="true">→</span></a>
          <span className="text-sm text-tinta-tenue">Te lleva a la tienda mayorista de {SITIO.nombre}.</span>
        </div>
      </section>

      <div className="mt-12 grid gap-10 lg:grid-cols-3">
        <section>
          <h2 className="text-3xl">Somos fabricantes</h2>
          <p className="mt-3 text-lg text-tinta-suave">Diseñamos y fabricamos indumentaria para hombre, mujer y niños desde hace más de 10 años. Los talles son reales y cumplidos, y el precio llega sin intermediarios.</p>
        </section>
        <section>
          <h2 className="text-3xl">Envíos a todo el país</h2>
          <p className="mt-3 text-lg text-tinta-suave">
            Te mandamos el pedido a donde estés{donde ? <>, o vení a vernos a <Link href="/locales" className="font-bold text-marca underline underline-offset-2">nuestros locales</Link> en {donde}</> : null}.
          </p>
        </section>
        <section>
          <h2 className="text-3xl">¿Tenés dudas?</h2>
          <p className="mt-3 text-lg text-tinta-suave">Escribinos por WhatsApp y te ayudamos con tu pedido.</p>
          <a href={`https://wa.me/${config.whatsapp}`} className="boton-borde mt-4"><IconoWhatsapp className="size-5" /> Escribinos</a>
        </section>
      </div>

      <p className="mt-14 text-tinta-suave">¿Comprás para vos? <Link href="/" className="font-bold text-marca underline underline-offset-2">Seguí en la tienda minorista</Link>.</p>
    </div>
  );
}
