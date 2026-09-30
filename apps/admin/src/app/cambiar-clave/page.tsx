"use client";
import { useEffect, useState } from "react";
import { api, ErrorApi } from "@/lib/api";
import { Boton, Campo, claseEntrada, Mensaje } from "@/components/ui";

/* Cambio de contraseña (obligatorio la primera vez: la provisoria no sirve para nada más). */
export default function CambiarClave() {
  const [yo, setYo] = useState<{ nombre: string; debeCambiarClave: boolean } | null>(null);
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [repetida, setRepetida] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);
  useEffect(() => { api<{ nombre: string; debeCambiarClave: boolean }>("yo").then(setYo).catch(() => {}); }, []);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (nueva.length < 12) return setError("La contraseña nueva tiene que tener al menos 12 caracteres.");
    if (nueva !== repetida) return setError("Las dos contraseñas nuevas no coinciden.");
    try {
      await api("clave", { cuerpo: { actual, nueva } });
      setListo(true);
      setTimeout(() => { window.location.href = "/"; }, 900);
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudo cambiar.");
    }
  }

  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-4xl">Cambiar contraseña</h1>
      {yo?.debeCambiarClave && <p className="mt-2 text-tinta-suave">Hola {yo.nombre}: antes de empezar, elegí tu contraseña. La provisoria deja de servir.</p>}
      <form onSubmit={enviar} className="mt-8 space-y-4 rounded-2xl border border-linea bg-white p-6">
        <Campo etiqueta={yo?.debeCambiarClave ? "Contraseña provisoria" : "Contraseña actual"}><input type="password" autoComplete="current-password" required className={claseEntrada} value={actual} onChange={(e) => setActual(e.target.value)} /></Campo>
        <Campo etiqueta="Contraseña nueva" ayuda="Al menos 12 caracteres. Una frase de varias palabras es más segura y fácil de recordar.">
          <input type="password" autoComplete="new-password" required minLength={12} className={claseEntrada} value={nueva} onChange={(e) => setNueva(e.target.value)} />
        </Campo>
        <Campo etiqueta="Repetí la contraseña nueva"><input type="password" autoComplete="new-password" required className={claseEntrada} value={repetida} onChange={(e) => setRepetida(e.target.value)} /></Campo>
        <Mensaje>{error}</Mensaje>
        {listo && <Mensaje tipo="ok">Listo. Entrando…</Mensaje>}
        <Boton type="submit" className="w-full py-3">Guardar</Boton>
      </form>
    </main>
  );
}
