import type { ProductoTarjeta } from "@isu/shared";
import { JsonLd } from "./JsonLd";
import { SITIO } from "@/lib/sitio";

/*
 * Abajo de la grilla: el texto de la categoría (backoffice → Categorías) y
 * la lista de sus productos en datos estructurados. Texto plano: párrafos
 * separados por una línea en blanco (nada de HTML del backoffice).
 */
export function TextoCategoria({ titulo, texto, productos, ruta }: { titulo: string; texto?: string | null; productos: ProductoTarjeta[]; ruta: string }) {
  const parrafos = (texto ?? "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return (
    <>
      {parrafos.length > 0 && (
        <section aria-label={`Sobre ${titulo}`} className="mt-16 max-w-3xl space-y-4 border-t border-linea pt-10 text-tinta-suave">
          {parrafos.map((p, i) => <p key={i} className="whitespace-pre-line">{p}</p>)}
        </section>
      )}
      {productos.length > 0 && (
        <JsonLd datos={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: titulo,
          url: `${SITIO.url}${ruta}`,
          mainEntity: {
            "@type": "ItemList",
            numberOfItems: productos.length,
            itemListElement: productos.slice(0, 50).map((p, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITIO.url}/producto/${p.slug}`, name: p.nombre })),
          },
        }} />
      )}
    </>
  );
}
