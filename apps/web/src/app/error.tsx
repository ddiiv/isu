"use client";
import { useEffect } from "react";

/* Nunca muestra el error real al visitante: sólo un mensaje y la opción de reintentar. */
export default function ErrorDePagina({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("[pagina]", error.digest ?? ""); }, [error]);
  return (
    <div className="contenedor py-24 text-center">
      <h1 className="text-4xl">Algo salió mal</h1>
      <p className="mt-3 text-tinta-suave">Ya quedó registrado. Probá de nuevo en un momento.</p>
      <button type="button" onClick={reset} className="boton-primario mt-8">Reintentar</button>
    </div>
  );
}
