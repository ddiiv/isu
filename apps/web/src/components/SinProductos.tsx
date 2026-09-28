/* Estado vacío de un listado. En la etapa 1 acá va la grilla con el stock de Stocker. */
export function SinProductos() {
  return (
    <div className="mt-10 rounded-[var(--radius-foto)] border border-dashed border-linea px-6 py-16 text-center">
      <p className="font-display text-2xl">Estamos cargando las prendas</p>
      <p className="mt-2 text-tinta-suave">Muy pronto vas a poder comprar esta sección online. Mientras, escribinos por WhatsApp.</p>
    </div>
  );
}
