import type { Metadata } from "next";
import { horarioSchema } from "@isu/shared";
import { obtenerConfig } from "@/lib/api";
import { JsonLd } from "@/components/JsonLd";
import { SITIO } from "@/lib/sitio";
import { Migas } from "@/components/Migas";
import { IconoLocal } from "@/components/iconos";

export async function generateMetadata(): Promise<Metadata> {
  const { locales } = await obtenerConfig();
  const donde = [...new Set(locales.map((l) => l.localidad))].join(" y ");
  return {
    title: "Nuestros locales",
    description: `Locales de ${SITIO.nombre}${donde ? ` en ${donde}` : ""}: probate las prendas y retirá gratis tus compras online.`.slice(0, 158),
    alternates: { canonical: "/locales" },
  };
}
export const revalidate = 300;

export default async function Locales() {
  const config = await obtenerConfig();
  return (
    <div className="contenedor pt-8">
      <Migas items={[{ nombre: "Locales", href: "/locales" }]} />
      <h1 className="mt-4 text-[clamp(2.6rem,7vw,5.5rem)] leading-[0.95]">Nuestros locales</h1>
      <p className="mt-4 max-w-2xl text-lg text-tinta-suave">Vení a probarte las prendas o retirá gratis lo que compraste online.</p>
      <ul className="mt-10 grid gap-4 md:grid-cols-3">
        {config.locales.map((l) => (
          <li key={l.nombre} className="rounded-[var(--radius-foto)] border border-linea p-6">
            <IconoLocal className="size-7 text-marca" />
            <h2 className="mt-4 text-2xl">{l.nombre}</h2>
            <p className="mt-2 text-tinta-suave">{l.direccion}<br />{l.localidad}</p>
            <p className="mt-3 text-sm"><strong>Horario:</strong> {l.horario}</p>
            {l.retiro && <p className="mt-3 inline-block rounded-full bg-ahorro-claro px-3 py-1 text-sm font-bold text-ahorro">Retiro de compras online</p>}
            {l.mapa && <p className="mt-3"><a href={l.mapa} target="_blank" rel="noopener noreferrer" className="font-bold text-marca underline">Cómo llegar</a></p>}
          </li>
        ))}
      </ul>
      {/* Cada local como comercio: dirección y horario en Google Maps y en la búsqueda "isuwaya flores". */}
      <JsonLd datos={config.locales.map((l) => {
        const horario = horarioSchema(l.horario);
        return {
          "@context": "https://schema.org",
          "@type": "ClothingStore",
          name: `${SITIO.nombre} ${l.nombre}`,
          url: `${SITIO.url}/locales`,
          image: `${SITIO.url}/icon.png`,
          telephone: `+${config.whatsapp}`,
          address: { "@type": "PostalAddress", streetAddress: l.direccion, addressLocality: l.localidad, addressCountry: "AR" },
          ...(horario.length ? { openingHoursSpecification: horario } : {}),
          ...(l.mapa ? { hasMap: l.mapa } : {}),
          parentOrganization: { "@type": "Organization", name: SITIO.nombre, url: `${SITIO.url}/` },
        };
      })} />
    </div>
  );
}
