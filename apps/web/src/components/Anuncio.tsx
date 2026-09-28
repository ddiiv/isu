/* Franja de arriba. El texto sale del backoffice (ajuste "anuncio"). */
export function Anuncio({ texto }: { texto: string | null }) {
  if (!texto) return null;
  return (
    <div className="bg-marca text-center text-[13px] font-bold tracking-wide text-white">
      <p className="mx-auto max-w-7xl px-4 py-2">{texto}</p>
    </div>
  );
}
