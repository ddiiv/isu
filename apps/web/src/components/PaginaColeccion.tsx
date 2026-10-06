import { obtenerColeccion, obtenerConfig, obtenerNuevos } from "@/lib/api";
import { Grilla } from "./Grilla";
import { Migas } from "./Migas";
import { SinProductos } from "./SinProductos";

/* /nuevos y /destacados: las colecciones que se eligen con casillas en el backoffice (Packs y Liquidación: PaginaSeccion). */
export async function PaginaColeccion({ cual, titulo, bajada }: { cual: "nuevos" | "destacados"; titulo: string; bajada: string }) {
  const [config, marcados] = await Promise.all([obtenerConfig(), obtenerColeccion(cual)]);
  // Si todavía nadie marcó "Nuevo" en ningún producto, se muestra lo último que entró.
  const listado = cual === "nuevos" && !marcados.productos.length ? await obtenerNuevos(48) : marcados;
  return (
    <div className="contenedor pt-8">
      <Migas items={[{ nombre: titulo, href: `/${cual}` }]} />
      <h1 className="mt-4 text-[clamp(2.6rem,7vw,5.5rem)] leading-[0.95]">{titulo}</h1>
      <p className="mt-3 max-w-2xl text-lg text-tinta-suave">{bajada}</p>
      {listado.productos.length
        ? <div className="mt-8"><Grilla productos={listado.productos} lista={titulo} descuento={config.descuentoTransferencia} cuotas={config.cuotasSinInteres} /></div>
        : <SinProductos />}
    </div>
  );
}
