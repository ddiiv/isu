"use client";
import { useState } from "react";
import qrcode from "qrcode-generator";
import { api, ErrorApi } from "@/lib/api";
import { Boton, Campo, claseEntrada, Mensaje } from "@/components/ui";

/*
 * Ingreso en dos pasos: email y contraseña, después el código de la app de
 * autenticación (Google Authenticator, Authy, 1Password…). La primera vez se
 * configura con un QR.
 */
type Paso = "clave" | "configurar" | "codigo";

function volver() {
  const v = new URLSearchParams(location.search).get("volver") ?? "/";
  // Sólo rutas propias: nada de "//otro-sitio" ni "https://…".
  return /^\/(?!\/)[\w\-/]*$/.test(v) ? v : "/";
}

export default function Ingresar() {
  const [paso, setPaso] = useState<Paso>("clave");
  const [email, setEmail] = useState("");
  const [clave, setClave] = useState("");
  const [codigo, setCodigo] = useState("");
  const [qr, setQr] = useState<{ svg: string; secreto: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setEnviando(true);
    try {
      if (paso === "clave") {
        const r = await api<{ siguiente: "codigo" | "configurar_2fa" }>("ingresar", { cuerpo: { email, contrasena: clave } });
        setClave("");
        if (r.siguiente === "configurar_2fa") {
          const c = await api<{ secreto: string; url: string }>("2fa/configurar", { metodo: "POST" });
          const q = qrcode(0, "M");
          q.addData(c.url);
          q.make();
          setQr({ svg: q.createSvgTag({ cellSize: 5, margin: 2, scalable: true }), secreto: c.secreto });
          setPaso("configurar");
        } else setPaso("codigo");
      } else {
        const r = await api<{ siguiente: "cambiar_clave" | "listo" }>("2fa", { cuerpo: { codigo: codigo.replace(/\s/g, "") } });
        window.location.href = r.siguiente === "cambiar_clave" ? "/cambiar-clave" : volver();
      }
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No se pudo ingresar.");
      if (err instanceof ErrorApi && err.status === 401 && paso !== "clave" && err.codigo === "sin_sesion") setPaso("clave");
      setCodigo("");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <p className="font-display text-3xl text-marca">Isuwaya</p>
      <h1 className="mt-1 text-4xl">Backoffice</h1>
      <form onSubmit={enviar} className="mt-8 space-y-4 rounded-2xl border border-linea bg-white p-6">
        {paso === "clave" && (
          <>
            <Campo etiqueta="Email"><input type="email" autoComplete="username" required className={claseEntrada} value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></Campo>
            <Campo etiqueta="Contraseña"><input type="password" autoComplete="current-password" required className={claseEntrada} value={clave} onChange={(e) => setClave(e.target.value)} /></Campo>
          </>
        )}
        {paso === "configurar" && qr && (
          <div className="space-y-3 text-sm">
            <p className="font-bold">Configurá el doble factor (una sola vez)</p>
            <ol className="list-decimal space-y-1 pl-5 text-tinta-suave">
              <li>Abrí una app de autenticación en tu celular (Google Authenticator, Authy, 1Password…).</li>
              <li>Escaneá este código:</li>
            </ol>
            <div className="mx-auto w-52 rounded-xl border border-linea p-2" dangerouslySetInnerHTML={{ __html: qr.svg }} />
            <details><summary className="cursor-pointer text-marca">No puedo escanear</summary>
              <p className="mt-1 text-tinta-suave">Cargá esta clave a mano: <code className="break-all rounded bg-fondo-suave px-1.5 py-0.5 font-bold text-tinta">{qr.secreto.match(/.{1,4}/g)?.join(" ")}</code></p>
            </details>
            <p className="text-tinta-suave">3. Escribí el código de 6 números que muestra la app:</p>
          </div>
        )}
        {paso !== "clave" && (
          <Campo etiqueta="Código de 6 números">
            <input inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={7} required autoFocus
              className={`${claseEntrada} text-center text-2xl tracking-[0.4em]`} value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/[^\d]/g, "").slice(0, 6))} />
          </Campo>
        )}
        <Mensaje>{error}</Mensaje>
        <Boton type="submit" className="w-full py-3" disabled={enviando}>{enviando ? "…" : paso === "clave" ? "Continuar" : "Ingresar"}</Boton>
      </form>
      <p className="mt-4 text-center text-xs text-tinta-tenue">¿Perdiste el celular? Pedile al dueño que restablezca tu usuario.</p>
    </main>
  );
}
