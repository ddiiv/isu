import Link from "next/link";
import { obtenerCategorias, obtenerColeccion, obtenerConfig, obtenerNuevos } from "@/lib/api";
import { NuevosIngresos } from "@/components/NuevosIngresos";
import { IconoBanco, IconoCamion, IconoFlecha, IconoLocal, IconoTarjeta } from "@/components/iconos";
import { SITIO } from "@/lib/sitio";
import { JsonLd } from "@/components/JsonLd";
import { contextoSeo } from "@/lib/seo";
import { envioYDevolucion } from "@isu/shared";

export const revalidate = 300;

const FONDOS = ["bg-marca", "bg-tinta", "bg-ahorro"];

export default async function Inicio() {
  const [config, categorias, nuevos, destacados] = await Promise.all([obtenerConfig(), obtenerCategorias(), obtenerNuevos(8), obtenerColeccion("destacados", 8)]);

  const beneficios = [
    { icono: IconoCamion, titulo: "Envíos a todo el país", texto: "Y en el día en CABA y GBA" },
    { icono: IconoBanco, titulo: `${config.descuentoTransferencia}% OFF con transferencia`, texto: "Se aplica solo en el checkout" },
    { icono: IconoTarjeta, titulo: `${config.cuotasSinInteres} cuotas sin interés`, texto: "Con tarjeta o Mercado Pago" },
    { icono: IconoLocal, titulo: "Retirá gratis", texto: `En ${config.locales.length > 1 ? "nuestros locales" : "nuestro local"}` },
  ];

  return (
    <>
      {/* Portada: el golpe tipográfico grande, como las tiendas que mejor convierten. */}
      <section className="bg-marca-claro">
        <div className="contenedor flex flex-col items-center py-16 text-center sm:py-24 lg:py-28">
          <h1 className="text-[clamp(2.9rem,9vw,7.2rem)] leading-[0.92] text-marca">
            {SITIO.lema.replace("todos tus días", "")}
            <br />todos tus días
          </h1>
          <p className="mt-5 font-display text-[clamp(1.4rem,3.4vw,2.4rem)] text-marca-fuerte">y a tu alcance.</p>
          <p className="mt-6 inline-flex items-center gap-2 rounded-full bg-ahorro px-4 py-1.5 text-sm font-bold text-white">
            {config.descuentoTransferencia}% OFF pagando con transferencia
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            {categorias.map((c) => (
              <Link key={c.id} href={`/${c.slug}`} className="boton-primario">
                {c.nombre} <IconoFlecha />
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section aria-label="Beneficios" className="border-b border-linea">
        <ul className="contenedor grid grid-cols-2 gap-x-4 gap-y-6 py-8 lg:grid-cols-4">
          {beneficios.map(({ icono: Icono, titulo, texto }) => (
            <li key={titulo} className="flex items-start gap-3">
              <Icono className="mt-0.5 size-6 shrink-0 text-marca" />
              <div>
                <p className="text-[15px] font-bold leading-tight">{titulo}</p>
                <p className="text-sm text-tinta-suave">{texto}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <NuevosIngresos productos={destacados.productos} titulo="Destacados" id="destacados" verTodo="/destacados" descuento={config.descuentoTransferencia} cuotas={config.cuotasSinInteres} />

      <NuevosIngresos productos={nuevos.productos} titulo="Lo nuevo" verTodo="/nuevos" descuento={config.descuentoTransferencia} cuotas={config.cuotasSinInteres} />

      <section className="bg-marca text-white">
        <div className="contenedor flex flex-col items-start gap-5 py-14 sm:flex-row sm:items-center sm:justify-between lg:py-16">
          <div>
            <h2 className="text-[clamp(2rem,5vw,3.4rem)] leading-none">Armá tu outfit</h2>
            <p className="mt-3 max-w-xl text-lg text-white/85">Decinos tu talle y cuánto querés gastar: te armamos conjuntos con lo que hay en stock.</p>
          </div>
          <Link href="/outfits" className="boton bg-white text-tinta hover:bg-marca-claro">Empezar <IconoFlecha /></Link>
        </div>
      </section>

      <section className="contenedor py-16 lg:py-20" aria-labelledby="titulo-categorias">
        <h2 id="titulo-categorias" className="text-[clamp(2rem,5vw,3.6rem)] leading-none">Elegí por dónde empezar</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {categorias.map((c, i) => (
            <div key={c.id} className={`${FONDOS[i % FONDOS.length]} flex min-h-72 flex-col justify-between rounded-[var(--radius-foto)] p-6 text-white sm:p-8`}>
              <Link href={`/${c.slug}`} className="font-display text-5xl leading-none hover:underline sm:text-6xl">{c.nombre}</Link>
              <ul className="mt-6 flex flex-wrap gap-2">
                {c.hijas.map((h) => (
                  <li key={h.id}>
                    <Link href={`/${c.slug}/${h.slug}`} className="inline-block rounded-full border border-white/40 px-3 py-1 text-sm hover:bg-white hover:text-tinta">{h.nombre}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Para Google: el nombre del sitio en los resultados y los datos de la marca (logo, redes, contacto, políticas). */}
      <JsonLd datos={[
        { "@context": "https://schema.org", "@type": "WebSite", name: SITIO.nombre, alternateName: ["Isu", "Isuwaya Indumentaria"], url: `${SITIO.url}/`, inLanguage: "es-AR" },
        {
          "@context": "https://schema.org",
          "@type": "OnlineStore",
          name: SITIO.nombre,
          url: `${SITIO.url}/`,
          logo: `${SITIO.url}/icon.png`,
          description: SITIO.descripcion,
          sameAs: [SITIO.instagram],
          contactPoint: [{ "@type": "ContactPoint", contactType: "customer service", telephone: `+${config.whatsapp}`, email: config.email, availableLanguage: "es", areaServed: "AR" }],
          hasMerchantReturnPolicy: envioYDevolucion(contextoSeo(config)).hasMerchantReturnPolicy,
        },
      ]} />

      <section className="bg-fondo-suave">
        <div className="contenedor grid gap-10 py-16 lg:grid-cols-2 lg:py-20">
          <h2 className="text-[clamp(2rem,5vw,3.6rem)] leading-none">Hacemos la ropa que vendemos</h2>
          <div className="space-y-4 text-lg text-tinta-suave">
            <p>Diseñamos y fabricamos indumentaria para hombre, mujer y niños desde hace más de 10 años. Por eso nuestros talles son reales y cumplidos, y el precio llega sin intermediarios.</p>
            <p>¿Dudas con un talle? Escribinos por WhatsApp y te ayudamos a elegir antes de comprar.</p>
            <Link href="/locales" className="boton-borde mt-2">Visitá nuestros locales</Link>
          </div>
        </div>
      </section>
    </>
  );
}
