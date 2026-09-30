import Link from "next/link";
import type { ProductoTarjeta } from "@isu/shared";
import { Grilla } from "./Grilla";
import { IconoFlecha } from "./iconos";

/* Una sección de la home con una colección (Destacados, Lo nuevo) y su "Ver todo". */
export function NuevosIngresos({
  productos, descuento, cuotas, titulo = "Lo nuevo", verTodo, id = "nuevos",
}: { productos: ProductoTarjeta[]; descuento: number; cuotas: number; titulo?: string; verTodo?: string; id?: string }) {
  if (!productos.length) return null;
  return (
    <section className="contenedor py-14 lg:py-20" aria-labelledby={`titulo-${id}`}>
      <div className="flex items-end justify-between gap-4">
        <h2 id={`titulo-${id}`} className="text-[clamp(2rem,5vw,3.6rem)] leading-none">{titulo}</h2>
        {verTodo && <Link href={verTodo} className="inline-flex shrink-0 items-center gap-1 text-[15px] font-bold text-marca hover:underline">Ver todo <IconoFlecha /></Link>}
      </div>
      <Grilla productos={productos} lista={titulo} descuento={descuento} cuotas={cuotas} filtros={false} />
    </section>
  );
}
