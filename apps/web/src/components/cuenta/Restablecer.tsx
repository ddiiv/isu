"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/cliente-api";

/* El token del mail viene en el fragmento (#t=…): nunca llega a un servidor ni a un log. */
export function Restablecer() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [clave, setClave] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    const m = window.location.hash.match(/t=([A-Za-z0-9_-]{40,60})/);
    setToken(m?.[1] ?? "");
    if (m) history.replaceState(null, "", window.location.pathname);
  }, []);
  const enviar = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg(null);
    try { await api("cuenta/restablecer", { cuerpo: { token, contrasena: clave } }); router.push("/cuenta"); } catch (err) { setMsg((err as Error).message); }
  };
  // Todavía no se leyó el fragmento (no es una comparación de secretos).
  // eslint-disable-next-line security/detect-possible-timing-attacks
  if (token === null) return null;
  if (!token) return <div className="contenedor py-20 text-center"><h1 className="text-4xl">Enlace inválido</h1><Link href="/cuenta" className="boton-primario mt-6">Pedir otro</Link></div>;
  return (
    <form onSubmit={enviar} className="contenedor max-w-md space-y-4 py-12">
      <h1 className="text-[clamp(2.2rem,6vw,3.2rem)] leading-none">Elegí tu contraseña</h1>
      <label className="block"><span className="mb-1 block text-sm font-bold">Contraseña nueva (8 o más caracteres)</span>
        <input type="password" autoComplete="new-password" minLength={8} required value={clave} onChange={(e) => setClave(e.target.value)} className="w-full rounded-xl border border-linea px-4 py-3" /></label>
      {msg && <p role="alert" className="rounded-xl bg-oferta/10 p-3 text-sm font-bold text-oferta">{msg}</p>}
      <button type="submit" className="boton w-full bg-tinta py-4 text-white">Guardar y entrar</button>
    </form>
  );
}
