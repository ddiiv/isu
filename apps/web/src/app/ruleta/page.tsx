import type { Metadata } from "next";
import Link from "next/link";
import { obtenerCupones } from "@/lib/api";
import { Migas } from "@/components/Migas";
import { Ruleta } from "@/components/cuenta/Ruleta";

/*
 * «Ruleta de descuentos»: la rueda (con o sin cuenta), cómo funciona y a dónde ir con el cupón. Siempre existe, así los enlaces viejos y
 * las redes no dan 404; cuando no hay una ruleta abierta lo dice y no se indexa. El sorteo es siempre de la API. Sin datos de clientes.
 */
export const revalidate = 300;

export async function generateMetadata(): Promise<Metadata> {
  const { ruleta } = await obtenerCupones();
  return {
    title: "Ruleta de descuentos",
    description: ruleta.abierta
      ? `Girá la ruleta de Isuwaya una vez cada ${ruleta.cadaDias} días y ganá un cupón de descuento: porcentaje de descuento, monto fijo, envío gratis o 2da unidad al 50%.`
      : "La ruleta de descuentos de Isuwaya se abre en fechas especiales: girala y ganá un cupón para tu compra.",
    alternates: { canonical: "/ruleta" },
    ...(ruleta.abierta ? {} : { robots: { index: false, follow: true } }),
  };
}

export default async function PaginaRuleta() {
  const { ruleta } = await obtenerCupones();
  const dias = (n: number) => (n === 7 ? "una vez por semana" : n === 1 ? "una vez por día" : `una vez cada ${n} días`);
  const pasos = [
    ["1", "Girá", `Girá la ruleta ${dias(ruleta.cadaDias)}, con o sin cuenta. El resultado lo decide nuestro sistema, no tu navegador.`],
    ["2", "Ganá", "Puede tocarte un porcentaje de descuento, un monto fijo, envío gratis o la 2da unidad al 50%. Si no, seguís participando."],
    ["3", "Usalo", `Tu cupón dura ${ruleta.venceDias} ${ruleta.venceDias === 1 ? "día" : "días"} y se usa una vez. Lo ves en «Cupones disponibles» del carrito y lo aplicás con un toque.`],
  ] as const;
  return (
    <div className="contenedor pt-8 pb-8">
      <Migas items={[{ nombre: "Ruleta", href: "/ruleta" }]} />
      <h1 className="mt-4 text-[clamp(2.6rem,7vw,5.5rem)] leading-[0.95]">{ruleta.evento ? `Ruleta de ${ruleta.evento}` : "Ruleta de descuentos"}</h1>
      <p className="mt-3 max-w-2xl text-lg text-tinta-suave">Girá y ganá un cupón para tu próxima compra.</p>

      {ruleta.abierta ? <Ruleta /> : (
        <section aria-live="polite" className="mt-8 rounded-[var(--radius-foto)] bg-fondo-suave p-6 sm:p-8">
          <h2 className="text-2xl">La ruleta está cerrada por ahora</h2>
          <p className="mt-2 max-w-2xl text-tinta-suave">Se abre en fechas especiales (como Navidad). Mientras, mirá los cupones y promociones que hay hoy.</p>
        </section>
      )}

      <section aria-labelledby="como-funciona" className="mt-12">
        <h2 id="como-funciona" className="text-2xl">Cómo funciona</h2>
        <ol className="mt-4 grid gap-4 md:grid-cols-3">
          {pasos.map(([n, t, d]) => (
            <li key={n} className="rounded-[var(--radius-foto)] border border-linea p-5">
              <span className="inline-flex size-8 items-center justify-center rounded-full bg-tinta text-sm font-bold text-white" aria-hidden="true">{n}</span>
              <h3 className="mt-3 text-xl">{t}</h3>
              <p className="mt-1 text-tinta-suave">{d}</p>
            </li>
          ))}
        </ol>
        <ul className="mt-6 max-w-3xl list-disc space-y-1.5 pl-5 text-sm text-tinta-suave">
          <li>Con cuenta, tus cupones quedan guardados y son sólo tuyos. Sin cuenta, quedan guardados en este navegador.</li>
          <li>Los cupones no se suman a otras promociones: en cada compra rige la que más te descuenta.</li>
          <li>Cada cupón tiene su compra mínima y su vencimiento, que ves antes de usarlo.</li>
        </ul>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/cupones" className="boton-borde">Ver cupones y promociones</Link>
          <Link href="/cuenta" className="boton-borde">Mi cuenta</Link>
        </div>
      </section>
    </div>
  );
}
