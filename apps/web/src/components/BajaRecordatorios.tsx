"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type ErrorApi } from "@/lib/cliente-api";

const TOKEN = /^[A-Za-z0-9_-]{43,64}$/;

export function BajaRecordatorios() {
  // undefined: todavía no se leyó; null: el enlace no trae un token válido.
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [estado, setEstado] = useState<"listo" | "enviando" | "baja">("listo");
  const [error, setError] = useState<string | null>(null);

  // El token viene en el fragmento (#t=…); al leerlo se borra de la barra de direcciones. Los mails viejos traían ?t=: también se lee.
  useEffect(() => {
    const t = window.location.hash.match(/t=([A-Za-z0-9_-]+)/)?.[1] ?? new URLSearchParams(window.location.search).get("t") ?? "";
    // (con el modo estricto de React el efecto corre dos veces: la segunda ya no encuentra el token en la barra, y no tiene que pisarlo)
    setToken((antes) => (antes !== undefined ? antes : TOKEN.test(t) ? t : null));
    if (t) history.replaceState(null, "", window.location.pathname);
  }, []);

  async function confirmar() {
    if (!token) return;
    setEstado("enviando");
    setError(null);
    try {
      await api("carrito-recordatorio/baja", { cuerpo: { token } });
      setEstado("baja");
    } catch (e) {
      setError((e as ErrorApi).message);
      setEstado("listo");
    }
  }

  if (typeof token === "undefined") return null;
  if (!token) {
    return (
      <div>
        <h1 className="text-3xl">Este enlace no es válido</h1>
        <p className="mt-3 text-tinta-suave">Usá el enlace «dá de baja acá» del mail que recibiste. Si no te funciona, escribinos y lo resolvemos.</p>
        <Link href="/contacto" className="boton-primario mt-6">Contacto</Link>
      </div>
    );
  }
  if (estado === "baja") {
    return (
      <div role="status">
        <h1 className="text-3xl">Listo, no te escribimos más</h1>
        <p className="mt-3 text-tinta-suave">Borramos tu carrito y no te vamos a mandar más recordatorios.</p>
        <Link href="/" className="boton-primario mt-6">Ir a la tienda</Link>
      </div>
    );
  }
  return (
    <div>
      <h1 className="text-3xl">¿No querés más recordatorios?</h1>
      <p className="mt-3 text-tinta-suave">Confirmá y dejamos de avisarte por mail de los carritos que quedan sin terminar. Borramos el carrito que guardamos.</p>
      {error && <p className="mt-4 rounded-xl bg-oferta/10 p-3 text-sm font-bold text-oferta" role="alert">{error}</p>}
      <button type="button" onClick={confirmar} disabled={estado === "enviando"} className="boton-primario mt-6 disabled:opacity-60">
        {estado === "enviando" ? "Confirmando…" : "Confirmar baja"}
      </button>
    </div>
  );
}
