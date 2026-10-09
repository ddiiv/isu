import type { Metadata } from "next";
import Link from "next/link";
import { obtenerConfig } from "@/lib/api";
import { Migas } from "@/components/Migas";
import { JsonLd } from "@/components/JsonLd";
import { IconoLocal, IconoWhatsapp } from "@/components/iconos";
import { HORARIO_ATENCION, localidades, telefonoLegible } from "@/lib/contacto";
import { SITIO } from "@/lib/sitio";

/* Contacto (etapa 13): WhatsApp, email y locales, con lo que está en Ajustes. */
export async function generateMetadata(): Promise<Metadata> {
  const config = await obtenerConfig();
  const donde = localidades(config.locales);
  const whatsapp = `WhatsApp ${telefonoLegible(config.whatsapp)}`;
  const email = config.email ? `Email ${config.email}` : null;
  const locales = donde ? `Locales en ${donde}` : null;
  // La primera que entra entera en Google (~158): nunca cortada a la mitad.
  const versiones = [
    [whatsapp, email, locales, `Atendemos ${HORARIO_ATENCION}`],
    [whatsapp, email, `Atendemos ${HORARIO_ATENCION}`],
    [whatsapp, email, locales],
    [whatsapp, email],
    [whatsapp],
  ].map((v) => `¿Necesitás ayuda? ${v.filter(Boolean).join(" · ")}.`);
  return {
    title: "Contacto",
    description: versiones.find((v) => v.length <= 158) ?? versiones.at(-1)!,
    alternates: { canonical: "/contacto" },
  };
}
export const revalidate = 300;

const tarjeta = "flex flex-col rounded-[var(--radius-foto)] border border-linea p-6";

export default async function Contacto() {
  const config = await obtenerConfig();
  return (
    <div className="contenedor pt-8">
      <Migas items={[{ nombre: "Contacto", href: "/contacto" }]} />
      <h1 className="mt-4 text-[clamp(2.6rem,7vw,5.5rem)] leading-[0.95]">Contacto</h1>
      <p className="mt-4 max-w-2xl text-lg text-tinta-suave">¿Necesitás ayuda con un talle, un pedido o un cambio? Escribinos y te respondemos.</p>

      <ul className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <li className={tarjeta}>
          <IconoWhatsapp className="size-7 text-whatsapp" />
          <h2 className="mt-4 text-2xl">WhatsApp</h2>
          <p className="mt-2 text-tinta-suave">{telefonoLegible(config.whatsapp)}</p>
          <p className="mt-1 text-sm text-tinta-tenue">Atendemos {HORARIO_ATENCION}.</p>
          <div className="mt-auto pt-5"><a href={`https://wa.me/${config.whatsapp}`} className="boton-marca">Escribinos por WhatsApp</a></div>
        </li>
        {config.email && (
          <li className={tarjeta}>
            <span aria-hidden="true" className="text-2xl leading-7">✉</span>
            <h2 className="mt-4 text-2xl">Email</h2>
            <p className="mt-2 break-all text-tinta-suave">{config.email}</p>
            <div className="mt-auto pt-5"><a href={`mailto:${config.email}`} className="boton-borde">Mandanos un email</a></div>
          </li>
        )}
        {config.locales.map((l) => (
          <li key={l.nombre} className={tarjeta}>
            <IconoLocal className="size-7 text-marca" />
            <h2 className="mt-4 text-2xl">{l.nombre}</h2>
            <p className="mt-2 text-tinta-suave">{l.direccion}<br />{l.localidad}</p>
            <p className="mt-2 text-sm"><strong>Horario:</strong> {l.horario}</p>
            {l.mapa && (
              <div className="mt-auto pt-5">
                <a href={l.mapa} target="_blank" rel="noopener noreferrer" aria-label={`Cómo llegar a ${l.nombre} (se abre en otra pestaña)`} className="boton-borde">Cómo llegar <span aria-hidden="true">↗</span></a>
              </div>
            )}
          </li>
        ))}
      </ul>

      <section className="mt-14">
        <h2 className="text-3xl">Lo que más nos preguntan</h2>
        <ul className="mt-4 grid gap-x-8 gap-y-3 text-lg sm:grid-cols-2">
          <li><Link href="/cuenta" className="font-bold text-marca underline underline-offset-2">¿Dónde está mi pedido?</Link> <span className="text-tinta-suave">En Mi cuenta, o desde el link del mail del pedido.</span></li>
          <li><Link href="/devoluciones" className="font-bold text-marca underline underline-offset-2">Cambios y devoluciones</Link> <span className="text-tinta-suave">Tenés 30 días.</span></li>
          <li><Link href="/arrepentimiento" className="font-bold text-marca underline underline-offset-2">Botón de arrepentimiento</Link> <span className="text-tinta-suave">10 días desde que la recibiste.</span></li>
          <li><Link href="/venta-por-mayor" className="font-bold text-marca underline underline-offset-2">Venta por mayor</Link> <span className="text-tinta-suave">Los pedidos por mayor van por la tienda mayorista.</span></li>
        </ul>
      </section>

      <JsonLd datos={{
        "@context": "https://schema.org",
        "@type": "ContactPage",
        name: `Contacto · ${SITIO.nombre}`,
        url: `${SITIO.url}/contacto`,
        mainEntity: {
          "@type": "OnlineStore",
          name: SITIO.nombre,
          url: `${SITIO.url}/`,
          contactPoint: [{ "@type": "ContactPoint", contactType: "customer service", telephone: `+${config.whatsapp}`, ...(config.email ? { email: config.email } : {}), availableLanguage: "es", areaServed: "AR" }],
        },
      }} />
    </div>
  );
}
