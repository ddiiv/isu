import type { Metadata } from "next";
import Link from "next/link";
import { obtenerCategorias, obtenerConfig } from "@/lib/api";
import { Migas } from "@/components/Migas";
import { JsonLd } from "@/components/JsonLd";
import { localidades } from "@/lib/contacto";
import { SITIO } from "@/lib/sitio";

/* Quiénes somos (etapa 13): lo que la marca ya cuenta en el inicio, en una página propia. */
export const metadata: Metadata = {
  title: "Quiénes somos",
  description: `Somos ${SITIO.nombre}: diseñamos y fabricamos ropa urbana y casual para hombre, mujer y niños desde hace más de 10 años, con talles reales y sin intermediarios.`,
  alternates: { canonical: "/nosotros" },
};
export const revalidate = 300;

export default async function Nosotros() {
  const [config, categorias] = await Promise.all([obtenerConfig(), obtenerCategorias()]);
  const donde = localidades(config.locales);
  return (
    <div className="contenedor pt-8">
      <Migas items={[{ nombre: "Quiénes somos", href: "/nosotros" }]} />
      <h1 className="mt-4 text-[clamp(2.6rem,7vw,5.5rem)] leading-[0.95]">Quiénes somos</h1>
      <p className="mt-6 max-w-3xl font-display text-[clamp(1.6rem,3.6vw,2.6rem)] leading-tight text-marca">
        Somos {SITIO.nombre}. Diseñamos y fabricamos indumentaria para hombre, mujer y niños desde hace más de 10 años.
      </p>

      <div className="mt-12 grid gap-10 lg:grid-cols-2">
        <section>
          <h2 className="text-3xl">Hacemos la ropa que vendemos</h2>
          <p className="mt-3 text-lg text-tinta-suave">Por eso nuestros talles son reales y cumplidos, y el precio llega sin intermediarios. {SITIO.lema}, y a tu alcance.</p>
        </section>
        <section>
          <h2 className="text-3xl">Dónde estamos</h2>
          <p className="mt-3 text-lg text-tinta-suave">
            Hacemos envíos a todo el país, y en el día en CABA y GBA.
            {donde && <> También podés venir a probarte las prendas a <Link href="/locales" className="font-bold text-marca underline underline-offset-2">nuestros locales</Link> en {donde}.</>}
          </p>
        </section>
        <section>
          <h2 className="text-3xl">¿Tenés dudas con un talle?</h2>
          <p className="mt-3 text-lg text-tinta-suave">Escribinos por WhatsApp y te ayudamos a elegir antes de comprar. <Link href="/contacto" className="font-bold text-marca underline underline-offset-2">Contacto</Link>.</p>
        </section>
        <section>
          <h2 className="text-3xl">¿Tenés un local?</h2>
          <p className="mt-3 text-lg text-tinta-suave">También vendemos por mayor. <Link href="/venta-por-mayor" className="font-bold text-marca underline underline-offset-2">Venta por mayor</Link>.</p>
        </section>
      </div>

      {categorias.length > 0 && (
        <div className="mt-14 flex flex-wrap gap-3">
          {categorias.map((c) => <Link key={c.id} href={`/${c.slug}`} className="boton-borde">Comprar {c.nombre}</Link>)}
          <a href={SITIO.instagram} target="_blank" rel="noopener noreferrer" className="boton-borde">Instagram <span aria-hidden="true">↗</span></a>
        </div>
      )}

      <JsonLd datos={{
        "@context": "https://schema.org",
        "@type": "AboutPage",
        name: `Quiénes somos · ${SITIO.nombre}`,
        url: `${SITIO.url}/nosotros`,
        mainEntity: { "@type": "OnlineStore", name: SITIO.nombre, url: `${SITIO.url}/`, slogan: SITIO.lema, sameAs: [SITIO.instagram] },
      }} />
    </div>
  );
}
