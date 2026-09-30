"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { ENLACE_TIENDA, formatearPesos, type RespuestaChat } from "@isu/shared";
import { api, type ErrorApi } from "@/lib/cliente-api";
import { src } from "@/lib/fotos";
import { IconoCerrar, IconoChat, IconoEnviar, IconoWhatsapp } from "../iconos";

/*
 * El asistente de la tienda: una burbuja abajo a la derecha (donde estaba el
 * botón de WhatsApp) que abre un panel de chat. En el celular ocupa la
 * pantalla. Todo lo que se muestra es texto: nunca se interpreta HTML de las
 * respuestas, y sólo se muestran enlaces de la tienda o de su WhatsApp.
 * La charla se guarda sólo en esta pestaña (sessionStorage).
 */
type Mensaje =
  | { de: "cliente"; texto: string }
  | { de: "bot"; r: RespuestaChat; votado?: boolean };

const CLAVE = "isu:chat";
const MAX = 40;
const WA = /^https:\/\/wa\.me\/\d{10,15}\?text=[^\s"'<>]*$/;
const enlaceValido = (u: string) => ENLACE_TIENDA.test(u) || WA.test(u);

export function Asistente({ saludo, whatsapp }: { saludo: string; whatsapp: string }) {
  const [abierto, setAbierto] = useState(false);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState("");
  const [esperando, setEsperando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const lista = useRef<HTMLDivElement>(null);
  const titulo = useId();
  const ruta = usePathname();
  const producto = /^\/producto\/([a-z0-9-]{1,120})$/.exec(ruta ?? "")?.[1];

  // La charla sigue si cambia de página (sólo en esta pestaña).
  useEffect(() => {
    try { const g = JSON.parse(sessionStorage.getItem(CLAVE) ?? "[]") as Mensaje[]; if (Array.isArray(g)) setMensajes(g.slice(-MAX)); } catch { /* */ }
  }, []);
  useEffect(() => {
    try { sessionStorage.setItem(CLAVE, JSON.stringify(mensajes.slice(-MAX))); } catch { /* modo privado */ }
    lista.current?.scrollTo({ top: lista.current.scrollHeight });
  }, [mensajes]);
  useEffect(() => {
    if (!abierto) return;
    entrada.current?.focus();
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") cerrar(); };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [abierto]);

  // Al cerrar, el foco vuelve a la burbuja (en el celular está oculta mientras el panel está abierto: se espera a que aparezca).
  const devolverFoco = useRef(false);
  function cerrar() { devolverFoco.current = true; setAbierto(false); }
  useEffect(() => {
    if (!abierto && devolverFoco.current) { devolverFoco.current = false; boton.current?.focus(); }
  }, [abierto]);
  const ultimaBot = [...mensajes].reverse().find((m): m is Extract<Mensaje, { de: "bot" }> => m.de === "bot");
  const esperandoCp = ultimaBot?.r.esperando === "cp";
  const esperandoPedido = ultimaBot?.r.esperando === "pedido";

  async function enviar(t: string) {
    const mensaje = t.trim().slice(0, 300);
    if (!mensaje || esperando) return;
    const previos = mensajes.filter((m): m is Extract<Mensaje, { de: "cliente" }> => m.de === "cliente").slice(-3).map((m) => m.texto);
    setMensajes((m) => [...m, { de: "cliente", texto: mensaje }]);
    setTexto(""); setError(null); setEsperando(true);
    try {
      const r = await api<RespuestaChat>("chat", { cuerpo: { mensaje, ...(esperandoCp ? { esperando: "cp" } : {}), ...(previos.length ? { previos } : {}), ...(producto ? { producto } : {}) } });
      setMensajes((m) => [...m, { de: "bot", r }]);
    } catch (e) {
      setError((e as ErrorApi).message || "No pude responder. Probá de nuevo.");
    } finally {
      setEsperando(false);
    }
  }

  async function consultarPedido(numero: string, email: string) {
    setEsperando(true); setError(null);
    setMensajes((m) => [...m, { de: "cliente", texto: `Pedido ${numero.toUpperCase()}` }]);
    try {
      const r = await api<RespuestaChat>("chat/pedido", { cuerpo: { numero, email } });
      setMensajes((m) => [...m, { de: "bot", r }]);
    } catch (e) {
      setError((e as ErrorApi).message);
    } finally {
      setEsperando(false);
    }
  }

  async function votar(i: number, util: boolean) {
    const m = mensajes[i];
    if (!m || m.de !== "bot" || !m.r.faqId || m.votado) return;
    setMensajes((ms) => ms.map((x, j) => (j === i && x.de === "bot" ? { ...x, votado: true } : x)));
    await api("chat/voto", { cuerpo: { faqId: m.r.faqId, util } }).catch(() => {});
  }

  const waDirecto = `https://wa.me/${whatsapp}?text=${encodeURIComponent("Hola Isuwaya! Tengo una consulta.")}`;

  return (
    <>
      <button ref={boton} type="button" onClick={() => (abierto ? cerrar() : setAbierto(true))} aria-expanded={abierto} aria-controls="asistente"
        aria-label={abierto ? "Cerrar el asistente" : "Abrir el asistente de la tienda"}
        className={`fixed bottom-5 right-5 z-40 grid size-14 place-items-center rounded-full bg-marca text-white shadow-lg shadow-black/20 transition hover:scale-105 focus-visible:outline-offset-4 ${abierto ? "max-sm:hidden" : ""}`}>
        {abierto ? <IconoCerrar /> : <IconoChat />}
      </button>

      {abierto && (
        <section id="asistente" role="dialog" aria-modal="false" aria-labelledby={titulo}
          className="fixed inset-0 z-50 flex flex-col bg-white sm:inset-auto sm:bottom-24 sm:right-5 sm:h-[min(600px,calc(100dvh-8rem))] sm:w-[380px] sm:rounded-[var(--radius-foto)] sm:border sm:border-linea sm:shadow-2xl">
          <header className="flex items-center gap-2 border-b border-linea px-4 py-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-marca-claro text-marca"><IconoChat className="size-5" /></span>
            <div className="min-w-0 flex-1">
              <h2 id={titulo} className="text-lg leading-tight">Asistente Isuwaya</h2>
              <p className="text-xs text-tinta-tenue">Respuestas automáticas</p>
            </div>
            <a href={waDirecto} target="_blank" rel="noopener noreferrer" aria-label="Escribinos por WhatsApp"
              className="grid size-10 place-items-center rounded-full bg-whatsapp text-white"><IconoWhatsapp className="size-5" /></a>
            <button type="button" onClick={cerrar} aria-label="Cerrar el asistente" className="grid size-10 place-items-center rounded-full hover:bg-fondo-suave"><IconoCerrar className="size-5" /></button>
          </header>

          <div ref={lista} role="log" aria-live="polite" aria-relevant="additions" className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            <Burbuja de="bot">{saludo}</Burbuja>
            {!mensajes.length && <Sugerencias lista={["¿Cuánto sale el envío?", "¿Cómo sé mi talle?", "¿Dónde está mi pedido?", "¿Qué medios de pago aceptan?"]} enviar={enviar} />}
            {mensajes.map((m, i) => m.de === "cliente"
              ? <Burbuja key={i} de="cliente">{m.texto}</Burbuja>
              : <RespuestaBot key={i} m={m} ultima={i === mensajes.length - 1} enviar={enviar} votar={(u) => votar(i, u)} />)}
            {esperando && <p className="text-sm text-tinta-tenue" aria-live="polite">Escribiendo…</p>}
            {error && <p className="rounded-xl bg-oferta/10 p-3 text-sm font-bold text-oferta" role="alert">{error}</p>}
            {esperandoPedido && !esperando && <FormPedido enviar={consultarPedido} />}
          </div>

          <form onSubmit={(e) => { e.preventDefault(); void enviar(texto); }} className="border-t border-linea p-3">
            <div className="flex items-center gap-2">
              <label htmlFor="asistente-texto" className="sr-only">Tu consulta</label>
              <input id="asistente-texto" ref={entrada} value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={300} autoComplete="off" enterKeyHint="send"
                inputMode={esperandoCp ? "numeric" : "text"} placeholder={esperandoCp ? "Tu código postal (ej. 5000)" : "Escribí tu consulta"}
                className="min-w-0 flex-1 rounded-full border border-linea px-4 py-3 text-base outline-none focus:border-tinta" />
              <button type="submit" disabled={esperando || !texto.trim()} aria-label="Enviar"
                className="grid size-11 shrink-0 place-items-center rounded-full bg-tinta text-white disabled:bg-linea disabled:text-tinta-tenue"><IconoEnviar /></button>
            </div>
            <p className="mt-2 text-center text-[11px] text-tinta-tenue">No compartas datos de tarjetas ni contraseñas.</p>
          </form>
        </section>
      )}
    </>
  );
}

function Burbuja({ de, children }: { de: "bot" | "cliente"; children: React.ReactNode }) {
  return (
    <p className={`max-w-[85%] whitespace-pre-line break-words rounded-2xl px-4 py-2.5 text-[15px] ${de === "cliente" ? "ml-auto rounded-br-md bg-tinta text-white" : "rounded-bl-md bg-fondo-suave"}`}>
      {de === "cliente" && <span className="sr-only">Vos: </span>}{children}
    </p>
  );
}

function Sugerencias({ lista, enviar }: { lista: string[]; enviar: (t: string) => void }) {
  if (!lista.length) return null;
  return (
    <div className="flex flex-wrap gap-2" aria-label="Preguntas sugeridas">
      {lista.map((s) => <button key={s} type="button" onClick={() => enviar(s)} className="rounded-full border border-marca/40 px-3 py-1.5 text-left text-sm text-marca-fuerte hover:bg-marca-claro">{s}</button>)}
    </div>
  );
}

function RespuestaBot({ m, ultima, enviar, votar }: { m: Extract<Mensaje, { de: "bot" }>; ultima: boolean; enviar: (t: string) => void; votar: (util: boolean) => void }) {
  const r = m.r;
  const enlaces = r.enlaces.filter((e) => enlaceValido(e.url));
  return (
    <div className="space-y-2">
      <Burbuja de="bot">{r.texto}</Burbuja>
      {r.productos && r.productos.length > 0 && (
        <ul className="space-y-2">
          {r.productos.filter((p) => ENLACE_TIENDA.test(p.url)).map((p) => (
            <li key={p.url}>
              <Link href={p.url} className="flex items-center gap-3 rounded-xl border border-linea p-2 hover:border-tinta">
                {p.foto ? (
                  <img src={src({ clave: p.foto, ancho: null, alto: null, alt: null }, 400)} alt="" width={48} height={60} className="h-15 w-12 shrink-0 rounded-lg bg-fondo-suave object-cover" />
                ) : <span className="h-15 w-12 shrink-0 rounded-lg bg-fondo-suave" aria-hidden="true" />}
                <span className="min-w-0 text-sm"><span className="block truncate font-bold">{p.nombre}</span>{formatearPesos(p.precio)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {r.opcionesEnvio && r.opcionesEnvio.length > 0 && (
        <ul className="divide-y divide-linea rounded-xl border border-linea text-sm">
          {r.opcionesEnvio.map((o) => (
            <li key={o.nombre} className="flex items-start justify-between gap-3 px-3 py-2">
              <span className="min-w-0"><b className="block">{o.nombre}</b><span className="text-xs text-tinta-suave">{o.detalle}</span></span>
              <b className="shrink-0">{o.gratis ? "Gratis" : formatearPesos(o.precio)}</b>
            </li>
          ))}
        </ul>
      )}
      {enlaces.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {enlaces.map((e) => (e.url.endsWith("#guia-talles") && typeof window !== "undefined" && e.url.startsWith(`${window.location.pathname}#`)
            // En la misma ficha: abre la guía sin navegar.
            ? <button key={e.url} type="button" onClick={() => window.dispatchEvent(new Event("isu:abrir-guia"))} className="rounded-full bg-tinta px-3 py-1.5 text-sm font-bold text-white">{e.texto}</button>
            : e.url.startsWith("/")
            ? <Link key={e.url} href={e.url} className="rounded-full bg-tinta px-3 py-1.5 text-sm font-bold text-white">{e.texto}</Link>
            : <a key={e.url} href={e.url} target="_blank" rel="noopener noreferrer" className="rounded-full bg-whatsapp px-3 py-1.5 text-sm font-bold text-white">{e.texto}</a>))}
        </div>
      )}
      {ultima && <Sugerencias lista={r.sugerencias} enviar={enviar} />}
      {r.faqId && (
        <p className="flex items-center gap-2 text-xs text-tinta-tenue">
          {m.votado ? "¡Gracias!" : (<>¿Te sirvió?
            <button type="button" onClick={() => votar(true)} className="rounded-full border border-linea px-2 py-0.5 hover:border-tinta">Sí</button>
            <button type="button" onClick={() => votar(false)} className="rounded-full border border-linea px-2 py-0.5 hover:border-tinta">No</button></>)}
        </p>
      )}
    </div>
  );
}

function FormPedido({ enviar }: { enviar: (numero: string, email: string) => void }) {
  const [numero, setNumero] = useState("");
  const [email, setEmail] = useState("");
  const campo = "w-full rounded-xl border border-linea bg-white px-3 py-2 text-base outline-none focus:border-tinta";
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (numero.trim() && email.trim()) enviar(numero.trim(), email.trim()); }} className="space-y-2 rounded-xl border border-linea p-3" aria-label="Buscar mi pedido">
      <label className="block text-sm"><span className="font-bold">Número de pedido</span>
        <input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="ISU-1234" autoComplete="off" maxLength={16} className={campo} /></label>
      <label className="block text-sm"><span className="font-bold">Email de la compra</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" maxLength={150} className={campo} /></label>
      <button type="submit" className="boton w-full bg-tinta text-white hover:bg-marca-fuerte">Buscar mi pedido</button>
    </form>
  );
}
