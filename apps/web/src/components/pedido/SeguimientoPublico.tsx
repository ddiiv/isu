"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { NOMBRE_ESTADO_ENVIO, type EnvioPublico } from "@isu/shared";
import { api, type ErrorApi } from "@/lib/cliente-api";
import { SeguimientoEnvio } from "./SeguimientoEnvio";

type Respuesta = { numero: string; estado: string; nombre: string; envio: EnvioPublico | null };

export function SeguimientoPublico({ numero, firma }: { numero: string; firma: string }) {
  const [r, setR] = useState<Respuesta | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const cargar = () => api<Respuesta>(`seguimiento/${numero}?t=${encodeURIComponent(firma)}`)
      .then((x) => { setR(x); setError(null); })
      .catch((e) => setError((e as ErrorApi).status === 404 ? "El enlace no es válido. Abrilo desde el WhatsApp o el mail que te mandamos." : (e as Error).message));
    void cargar();
    // Se actualiza sola cada 5 minutos si la pestaña está a la vista.
    const t = setInterval(() => { if (document.visibilityState === "visible") void cargar(); }, 5 * 60_000);
    return () => clearInterval(t);
  }, [numero, firma]);

  if (error) {
    return (
      <div className="contenedor py-20 text-center">
        <h1 className="text-4xl">Seguimiento</h1>
        <p className="mx-auto mt-4 max-w-md text-tinta-suave" role="alert">{error}</p>
        <Link href="/" className="boton-primario mt-6">Ir a la tienda</Link>
      </div>
    );
  }
  if (!r) return <div className="contenedor py-24 text-center text-tinta-tenue" aria-busy="true">Buscando tu envío…</div>;
  const titulo = r.envio?.estado ? NOMBRE_ESTADO_ENVIO[r.envio.estado] : r.estado === "entregado" ? "Entregado" : "Preparando tu pedido";
  return (
    <div className="contenedor max-w-2xl py-10">
      <p className="text-sm text-tinta-tenue">Pedido {r.numero}</p>
      <h1 className="mt-1 text-[clamp(2rem,5vw,3.2rem)] leading-tight">{r.nombre ? `${r.nombre}, ` : ""}{titulo.toLowerCase()}</h1>
      {r.envio ? <SeguimientoEnvio envio={r.envio} /> : <p className="mt-4 text-tinta-suave">Este pedido no tiene envío (se retira en el local).</p>}
      <p className="mt-8 text-sm text-tinta-suave">¿Querés ver el pedido completo? <Link href={`/pedido/${r.numero}`} className="underline">Abrilo desde tu cuenta</Link>.</p>
    </div>
  );
}
