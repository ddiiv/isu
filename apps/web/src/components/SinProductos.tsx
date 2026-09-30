/* Estado vacío de un listado (categoría sin prendas publicadas todavía). */
export function SinProductos() {
  return (
    <div className="mt-10 rounded-[var(--radius-foto)] border border-dashed border-linea px-6 py-16 text-center">
      <p className="font-display text-2xl">Todavía no hay prendas en esta sección</p>
      <p className="mt-2 text-tinta-suave">Estamos sumando novedades todas las semanas. Mientras, escribinos por WhatsApp y te contamos qué hay.</p>
    </div>
  );
}
