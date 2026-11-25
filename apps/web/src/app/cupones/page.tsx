import type { Metadata } from "next";
import Link from "next/link";
import { formatearPesos } from "@isu/shared";
import { obtenerCupones } from "@/lib/api";
import { Migas } from "@/components/Migas";
import { BotonesCupon } from "@/components/cupones/BotonesCupon";
import { Ruleta } from "@/components/cuenta/Ruleta";

/*
 * «Cupones y promociones»: los cupones que el dueño marcó como visibles (con un botón para usarlos), las promociones que se aplican
 * solas y la ruleta. Los cupones con código secreto y los personales de la ruleta NO salen acá: la API sólo devuelve lo que se
 * eligió mostrar. Pública, sin datos de clientes.
 */
export const revalidate = 300;
export const metadata: Metadata = {
  title: "Cupones y promociones",
  description: "Cupones de descuento y promociones vigentes de Isuwaya: códigos para usar en tu compra, ofertas que se aplican solas y la ruleta de descuentos.",
  alternates: { canonical: "/cupones" },
};

const hasta = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "long", timeZone: "America/Argentina/Buenos_Aires" });
const condiciones = (c: { minimo: number; hasta: string | null }) => [c.minimo > 0 ? `En compras desde ${formatearPesos(c.minimo)}` : null, c.hasta ? `Hasta el ${hasta(c.hasta)}` : null].filter(Boolean).join(" · ");

export default async function Cupones() {
  const { cupones, promociones, ruleta } = await obtenerCupones();
  return (
    <div className="contenedor pt-8 pb-8">
      <Migas items={[{ nombre: "Cupones y promociones", href: "/cupones" }]} />
      <h1 className="mt-4 text-[clamp(2.6rem,7vw,5.5rem)] leading-[0.95]">Cupones y promociones</h1>
      <p className="mt-3 max-w-2xl text-lg text-tinta-suave">Descuentos para tu próxima compra. Si tenés un código, escribilo en el carrito.</p>

      <section aria-labelledby="titulo-cupones" className="mt-10">
        <h2 id="titulo-cupones" className="text-2xl">Cupones para usar</h2>
        {cupones.length ? (
          <ul className="mt-4 grid gap-4 md:grid-cols-2">
            {cupones.map((c) => (
              <li key={c.codigo} className="rounded-[var(--radius-foto)] border border-linea p-5">
                <p className="text-sm font-bold text-ahorro">{c.detalle}</p>
                <p className="mt-1 text-xl font-bold">{c.nombre}</p>
                {c.descripcion && <p className="mt-1 text-tinta-suave">{c.descripcion}</p>}
                {condiciones(c) && <p className="mt-1 text-sm text-tinta-tenue">{condiciones(c)}</p>}
                <p className="mt-3"><code className="rounded-lg bg-fondo-suave px-3 py-1.5 font-mono text-base font-bold tracking-wide">{c.codigo}</code></p>
                <div className="mt-3"><BotonesCupon codigo={c.codigo} /></div>
              </li>
            ))}
          </ul>
        ) : <p className="mt-3 text-tinta-suave">Por ahora no hay cupones para mostrar. Volvé pronto.</p>}
      </section>

      {promociones.length > 0 && (
        <section aria-labelledby="titulo-promos" className="mt-12">
          <h2 id="titulo-promos" className="text-2xl">Promociones que se aplican solas</h2>
          <p className="mt-1 text-tinta-suave">No hace falta ningún código: se aplican en el carrito cuando tu compra las cumple. En cada compra rige la que más te descuenta.</p>
          <ul className="mt-4 grid gap-4 md:grid-cols-2">
            {promociones.map((p) => (
              <li key={p.nombre} className="rounded-[var(--radius-foto)] bg-ahorro-claro p-5">
                <p className="text-sm font-bold text-ahorro">{p.detalle}</p>
                <p className="mt-1 text-xl font-bold">{p.nombre}</p>
                {condiciones(p) && <p className="mt-1 text-sm text-tinta-suave">{condiciones(p)}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* La ruleta, con o sin cuenta: la tarjeta se muestra sola si hay una abierta (si no, sólo este aviso). */}
      {ruleta.abierta ? <><Ruleta /><p className="mt-3 text-sm"><Link href="/ruleta" className="underline">Cómo funciona la ruleta</Link></p></> : (
        <section aria-labelledby="titulo-ruleta-cupones" className="mt-12 rounded-[var(--radius-foto)] bg-fondo-suave p-6 sm:p-8">
          <h2 id="titulo-ruleta-cupones" className="text-2xl">Ganá cupones con la ruleta</h2>
          <p className="mt-2 max-w-2xl text-tinta-suave">Cuando hay una ruleta abierta (en Navidad y otras fechas), podés girar una vez por semana y ganar un cupón. Pasá de nuevo pronto.</p>
          <Link href="/cuenta" className="boton-primario mt-4">Ir a mi cuenta</Link>
        </section>
      )}
    </div>
  );
}
