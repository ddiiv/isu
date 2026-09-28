import Link from "next/link";
import { JsonLd } from "./JsonLd";
import { SITIO } from "@/lib/sitio";

/* Migas de pan, visibles y en datos estructurados (Google las muestra en el resultado). */
export function Migas({ items }: { items: { nombre: string; href: string }[] }) {
  const todos = [{ nombre: "Inicio", href: "/" }, ...items];
  return (
    <>
      <nav aria-label="Estás en" className="text-sm text-tinta-tenue">
        <ol className="flex flex-wrap items-center gap-1.5">
          {todos.map((m, i) => (
            <li key={m.href} className="flex items-center gap-1.5">
              {i > 0 && <span aria-hidden="true">/</span>}
              {i === todos.length - 1
                ? <span aria-current="page" className="font-bold text-tinta">{m.nombre}</span>
                : <Link href={m.href} className="hover:text-tinta">{m.nombre}</Link>}
            </li>
          ))}
        </ol>
      </nav>
      <JsonLd datos={{
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: todos.map((m, i) => ({ "@type": "ListItem", position: i + 1, name: m.nombre, item: `${SITIO.url}${m.href}` })),
      }} />
    </>
  );
}
