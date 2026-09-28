import { IconoWhatsapp } from "./iconos";

/* Botón flotante al WhatsApp de trabajo. El número sale del backoffice. */
export function BotonWhatsapp({ numero }: { numero: string }) {
  const texto = encodeURIComponent("Hola Isuwaya! Tengo una consulta.");
  return (
    <a
      href={`https://wa.me/${numero}?text=${texto}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Escribinos por WhatsApp"
      className="fixed bottom-5 right-5 z-40 grid size-14 place-items-center rounded-full bg-whatsapp text-white shadow-lg shadow-black/20 transition hover:scale-105 focus-visible:outline-offset-4"
    >
      <IconoWhatsapp />
    </a>
  );
}
