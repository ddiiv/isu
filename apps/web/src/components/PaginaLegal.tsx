import { Migas } from "./Migas";
import { VENDEDOR } from "@/lib/legal";

export function PaginaLegal({ titulo, ruta, children }: { titulo: string; ruta: string; children: React.ReactNode }) {
  return (
    <article className="contenedor max-w-3xl pt-8">
      <Migas items={[{ nombre: titulo, href: ruta }]} />
      <h1 className="mt-4 text-[clamp(2.2rem,6vw,4rem)] leading-none">{titulo}</h1>
      <p className="mt-3 text-sm text-tinta-tenue">Última actualización: {VENDEDOR.actualizado}</p>
      <div className="texto-legal mt-6">{children}</div>
      <p className="mt-12 border-t border-linea pt-6 text-sm text-tinta-tenue">
        {VENDEDOR.nombreComercial}
        {VENDEDOR.razonSocial && <> · {VENDEDOR.razonSocial}</>}
        {VENDEDOR.cuit && <> · CUIT {VENDEDOR.cuit}</>}
        {" · "}{VENDEDOR.domicilio}
      </p>
    </article>
  );
}
