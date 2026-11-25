import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { obtenerColeccion, obtenerConfig } from "@/lib/api";
import { Grilla } from "@/components/Grilla";
import { Migas } from "@/components/Migas";
import { SinProductos } from "@/components/SinProductos";
import { TextoCategoria } from "@/components/TextoCategoria";
import { SITIO } from "@/lib/sitio";

/*
 * «Amigo invisible» (edición Navidad): las prendas con un descuento de Navidad vigente (colección «evento» de la API) y las promos
 * del evento. Existe sólo mientras Navidad esté vigente: apagada, la dirección da 404 y nada la enlaza (menú, pie y sitemap miran
 * config.evento). No lleva datos de clientes: es una página pública como cualquier otra colección.
 */
export const revalidate = 300;

/** Los topes de «Mi presupuesto» (centavos). Sólo salen los que filtran algo; el amigo invisible suele tener un monto fijo. */
const PRESUPUESTOS = [1_500_000, 2_500_000, 4_000_000, 6_000_000];

export async function generateMetadata(): Promise<Metadata> {
  const { evento, cuotasSinInteres } = await obtenerConfig();
  if (!evento) return {};
  return {
    title: "Amigo invisible: regalos con descuento",
    description: `Regalos de ${evento.nombre} y amigo invisible en ${SITIO.nombre}: prendas con descuento, ${cuotasSinInteres > 1 ? `${cuotasSinInteres} cuotas sin interés y ` : ""}envíos a todo el país.`.slice(0, 158),
    alternates: { canonical: "/amigo-invisible" },
  };
}

const hastaEl = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "long", timeZone: "America/Argentina/Buenos_Aires" });

export default async function AmigoInvisible() {
  const [config, listado] = await Promise.all([obtenerConfig(), obtenerColeccion("evento")]);
  const { evento } = config;
  if (!evento) notFound();
  const ventajas = [...evento.promos, ...(config.cuotasSinInteres > 1 ? [`${config.cuotasSinInteres} cuotas sin interés`] : []), "Envíos a todo el país"];
  return (
    <div className="contenedor pt-8">
      <Migas items={[{ nombre: "Amigo invisible", href: "/amigo-invisible" }]} />
      <h1 className="mt-4 text-[clamp(2.6rem,7vw,5.5rem)] leading-[0.95]">Amigo invisible</h1>
      <p className="mt-3 max-w-2xl text-lg text-tinta-suave">
        Regalos para todos los bolsillos, con las ofertas de {evento.nombre}.{evento.hasta ? ` Hasta el ${hastaEl(evento.hasta)}.` : ""}
      </p>
      <ul className="mt-6 flex flex-wrap gap-2" aria-label="Promociones vigentes">
        {ventajas.map((v) => <li key={v} className="rounded-full bg-ahorro-claro px-4 py-2 text-[15px] font-bold text-ahorro">{v}</li>)}
      </ul>
      {evento.promos.length > 0 && <p className="mt-3 max-w-2xl text-sm text-tinta-tenue">Las promociones no se suman entre sí: en cada compra rige la que más te descuenta.</p>}
      {listado.productos.length
        ? <div className="mt-8"><Grilla productos={listado.productos} lista="Amigo invisible" descuento={config.descuentoTransferencia} cuotas={config.cuotasSinInteres} presupuestos={PRESUPUESTOS} /></div>
        : <SinProductos />}
      <TextoCategoria titulo="Amigo invisible" productos={listado.productos} ruta="/amigo-invisible" />
    </div>
  );
}
