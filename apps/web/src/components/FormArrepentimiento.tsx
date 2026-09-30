"use client";
import { useState } from "react";
import { api } from "@/lib/cliente-api";

/* Botón de arrepentimiento: sin cuenta, sin motivo obligatorio, con código de trámite en el momento. */
export function FormArrepentimiento() {
  const [f, setF] = useState({ numero: "", email: "", nombre: "", motivo: "" });
  const [r, setR] = useState<{ codigo: string; mensaje: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const campo = "w-full rounded-xl border border-linea bg-white px-4 py-3 text-base";
  const enviar = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null); setEnviando(true);
    try { setR(await api("arrepentimiento", { cuerpo: { ...f, motivo: f.motivo || undefined } })); } catch (err) { setError((err as Error).message); } finally { setEnviando(false); }
  };
  if (r) return <div className="not-prose rounded-[var(--radius-foto)] bg-ahorro-claro p-5" role="status"><p className="font-display text-2xl">Código de trámite: {r.codigo}</p><p className="mt-2">{r.mensaje}</p></div>;
  return (
    <form onSubmit={enviar} className="not-prose mt-6 space-y-3 rounded-[var(--radius-foto)] border border-linea p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="mb-1 block text-sm font-bold">Número de pedido</span><input className={campo} placeholder="ISU-1234" required value={f.numero} onChange={(e) => setF({ ...f, numero: e.target.value })} /></label>
        <label className="block"><span className="mb-1 block text-sm font-bold">Email de la compra</span><input className={campo} type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
      </div>
      <label className="block"><span className="mb-1 block text-sm font-bold">Nombre y apellido</span><input className={campo} required minLength={2} value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></label>
      <label className="block"><span className="mb-1 block text-sm font-bold">Motivo (opcional)</span><textarea className={campo} rows={2} maxLength={1000} value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })} /></label>
      {error && <p role="alert" className="text-sm font-bold text-oferta">{error}</p>}
      <button type="submit" disabled={enviando} className="boton-marca">{enviando ? "Enviando…" : "Quiero arrepentirme de mi compra"}</button>
    </form>
  );
}
