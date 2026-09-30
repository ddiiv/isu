"use client";
import { useState } from "react";
import { Faq, TEMAS_CHAT } from "@isu/shared";
import { api, fecha, useDatos } from "@/lib/api";
import { Boton, Campo, Cargando, Casilla, claseEntrada, Insignia, Mensaje, Tarjeta, Titulo, useAviso } from "@/components/ui";
import { puede, useYo } from "@/components/Marco";

/*
 * Asistente de la tienda (etapa 5): las preguntas frecuentes con las que
 * responde, lo que no supo responder (para sumar preguntas) y un "probá una
 * pregunta" que muestra qué respondería y por qué. Prender, apagar y el
 * saludo están en Ajustes.
 */
interface FilaFaq {
  id: number; pregunta: string; respuesta: string; palabras: string; tema: string; enlaceTexto: string | null; enlaceUrl: string | null;
  orden: number; activo: boolean; veces: number; util: number; noUtil: number; actualizadoPor: string | null; actualizadoEn: string;
}
type Borrador = { id: number | null; pregunta: string; respuesta: string; palabras: string; tema: string; enlaceTexto: string; enlaceUrl: string; orden: number; activo: boolean };
const NOMBRE_TEMA: Record<string, string> = {
  envios: "Envíos", pagos: "Pagos", talles: "Talles", cambios: "Cambios", pedidos: "Pedidos", locales: "Locales", mayorista: "Mayorista", general: "General",
  saludo: "Saludos", humano: "Pasó a WhatsApp", productos: "Productos", sin_respuesta: "Sin respuesta",
};
const VACIO: Borrador = { id: null, pregunta: "", respuesta: "", palabras: "", tema: "general", enlaceTexto: "", enlaceUrl: "", orden: 0, activo: true };
const VISTAS = [["faq", "Preguntas frecuentes"], ["sin", "Sin respuesta"], ["probar", "Probar"]] as const;

export default function Asistente() {
  const yo = useYo();
  const operador = puede(yo, "operador");
  const [vista, setVista] = useState<(typeof VISTAS)[number][0]>("faq");
  const resumen = useDatos<{ consultas: number; temas: Array<{ tema: string; veces: number }>; sinResponder: number; iaDisponible: boolean }>("chat/resumen");
  const r = resumen.datos;

  return (
    <>
      <Titulo>Asistente</Titulo>
      {r && (
        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Tarjeta><p className="text-sm text-tinta-tenue">Consultas (30 días)</p><p className="font-display text-3xl">{r.consultas}</p></Tarjeta>
          <Tarjeta><p className="text-sm text-tinta-tenue">Sin respuesta para revisar</p><p className="font-display text-3xl">{r.sinResponder}</p></Tarjeta>
          <Tarjeta>
            <p className="text-sm text-tinta-tenue">Lo más consultado</p>
            <p className="mt-1 text-sm">{r.temas.slice(0, 4).map((t) => `${NOMBRE_TEMA[t.tema] ?? t.tema} (${t.veces})`).join(" · ") || "—"}</p>
          </Tarjeta>
        </div>
      )}
      {r && !r.iaDisponible && <p className="mb-4 text-xs text-tinta-tenue">Respuestas con IA: no configuradas (falta ANTHROPIC_API_KEY en el servidor). El asistente responde con estas preguntas frecuentes y deriva a WhatsApp.</p>}
      <nav aria-label="Vistas" className="-mx-1 mb-4 flex gap-1 overflow-x-auto px-1 pb-1">
        {VISTAS.map(([v, t]) => (
          <button key={v} type="button" onClick={() => setVista(v)} aria-current={vista === v ? "page" : undefined}
            className={`shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-sm ${vista === v ? "bg-tinta font-bold text-white" : "bg-white ring-1 ring-linea hover:ring-tinta"}`}>{t}</button>
        ))}
      </nav>
      {vista === "faq" && <Preguntas operador={operador} alCambiar={() => void resumen.recargar()} />}
      {vista === "sin" && <SinRespuesta operador={operador} alCambiar={() => void resumen.recargar()} />}
      {vista === "probar" && <Probar />}
    </>
  );
}

function Preguntas({ operador, alCambiar }: { operador: boolean; alCambiar: () => void }) {
  const { datos, error, recargar } = useDatos<{ faqs: FilaFaq[] }>("chat/faq");
  const [b, setB] = useState<Borrador | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const aviso = useAviso();
  if (error) return <Mensaje>{error}</Mensaje>;
  if (!datos) return <Cargando />;

  async function guardar() {
    if (!b) return;
    const cuerpo = { pregunta: b.pregunta, respuesta: b.respuesta, palabras: b.palabras, tema: b.tema, orden: b.orden, activo: b.activo, enlaceTexto: b.enlaceTexto.trim() || null, enlaceUrl: b.enlaceUrl.trim() || null };
    const v = Faq.safeParse(cuerpo);
    if (!v.success) { setErrores(Object.fromEntries(v.error.issues.map((i) => [String(i.path[0]), i.message]))); return; }
    setErrores({});
    try {
      await api(b.id ? `chat/faq/${b.id}` : "chat/faq", { metodo: b.id ? "PUT" : "POST", cuerpo: v.data });
      aviso.ok("Guardada. El asistente ya la usa.");
      setB(null); await recargar(); alCambiar();
    } catch (e) { aviso.error(e); }
  }
  async function borrar(f: FilaFaq) {
    if (!window.confirm(`¿Borrar "${f.pregunta}"? Si sólo querés que no se use, destildá "Activa".`)) return;
    try { await api(`chat/faq/${f.id}`, { metodo: "DELETE" }); aviso.ok("Borrada."); await recargar(); } catch (e) { aviso.error(e); }
  }
  const editar = (f: FilaFaq) => setB({ id: f.id, pregunta: f.pregunta, respuesta: f.respuesta, palabras: f.palabras, tema: f.tema, enlaceTexto: f.enlaceTexto ?? "", enlaceUrl: f.enlaceUrl ?? "", orden: f.orden, activo: f.activo });

  return (
    <div className="space-y-4">
      <aviso.Aviso />
      {operador && !b && <Boton onClick={() => setB({ ...VACIO })}>Nueva pregunta</Boton>}
      {b && (
        <Tarjeta titulo={b.id ? "Editar pregunta" : "Nueva pregunta"}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Campo etiqueta="Pregunta" error={errores.pregunta} className="sm:col-span-2"><input className={claseEntrada} maxLength={200} value={b.pregunta} onChange={(e) => setB({ ...b, pregunta: e.target.value })} /></Campo>
            <Campo etiqueta="Respuesta" error={errores.respuesta} className="sm:col-span-2"
              ayuda="Podés usar {descuento}, {cuotas}, {envioGratis}, {whatsapp}, {horaCorte} y {locales}: salen de Ajustes.">
              <textarea className={claseEntrada} rows={4} maxLength={1500} value={b.respuesta} onChange={(e) => setB({ ...b, respuesta: e.target.value })} />
            </Campo>
            <Campo etiqueta="Otras formas de preguntarlo (palabras clave)" error={errores.palabras} className="sm:col-span-2"
              ayuda="Palabras que usa la gente para esto, separadas por espacios: mandan correo llega demora">
              <input className={claseEntrada} maxLength={300} value={b.palabras} onChange={(e) => setB({ ...b, palabras: e.target.value })} />
            </Campo>
            <Campo etiqueta="Tema"><select className={claseEntrada} value={b.tema} onChange={(e) => setB({ ...b, tema: e.target.value })}>{TEMAS_CHAT.map((t) => <option key={t} value={t}>{NOMBRE_TEMA[t]}</option>)}</select></Campo>
            <Campo etiqueta="Orden" ayuda="Ante un empate, gana la de número más bajo."><input type="number" className={claseEntrada} value={b.orden} onChange={(e) => setB({ ...b, orden: Number(e.target.value) || 0 })} /></Campo>
            <Campo etiqueta="Botón (texto, opcional)" error={errores.enlaceTexto}><input className={claseEntrada} maxLength={60} value={b.enlaceTexto} onChange={(e) => setB({ ...b, enlaceTexto: e.target.value })} placeholder="Cambios y devoluciones" /></Campo>
            <Campo etiqueta="Botón (dirección de la tienda)" error={errores.enlaceUrl}><input className={claseEntrada} maxLength={200} value={b.enlaceUrl} onChange={(e) => setB({ ...b, enlaceUrl: e.target.value })} placeholder="/devoluciones" /></Campo>
            <div className="sm:col-span-2"><Casilla etiqueta="Activa (el asistente la usa)" marcada={b.activo} onChange={(x) => setB({ ...b, activo: x })} /></div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2"><Boton onClick={() => void guardar()}>Guardar</Boton><Boton variante="borde" onClick={() => { setB(null); setErrores({}); }}>Cancelar</Boton></div>
        </Tarjeta>
      )}
      <div className="overflow-x-auto rounded-2xl border border-linea bg-white">
        <table className="tabla-apilada w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-linea text-tinta-tenue"><tr><th className="px-4 py-3">Pregunta</th><th className="px-4 py-3">Tema</th><th className="px-4 py-3">Usada</th><th className="px-4 py-3">¿Sirvió?</th><th className="px-4 py-3"></th></tr></thead>
          <tbody className="divide-y divide-linea">
            {datos.faqs.map((f) => (
              <tr key={f.id} className={f.activo ? "" : "opacity-60"}>
                <td className="px-4 py-3"><b>{f.pregunta}</b>{!f.activo && <Insignia clase="ml-2 bg-fondo-suave text-tinta-tenue">Inactiva</Insignia>}<br /><span className="line-clamp-2 text-xs text-tinta-tenue">{f.respuesta}</span></td>
                <td className="px-4 py-3" data-etiqueta="Tema">{NOMBRE_TEMA[f.tema] ?? f.tema}</td>
                <td className="px-4 py-3" data-etiqueta="Usada">{f.veces}</td>
                <td className="whitespace-nowrap px-4 py-3" data-etiqueta="¿Sirvió?">{f.util} sí · {f.noUtil} no</td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  {operador && <><Boton variante="borde" onClick={() => editar(f)}>Editar</Boton> <Boton variante="texto" className="text-oferta" onClick={() => void borrar(f)}>Borrar</Boton></>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SinRespuesta({ operador, alCambiar }: { operador: boolean; alCambiar: () => void }) {
  const { datos, error, recargar } = useDatos<{ preguntas: Array<{ id: number; ejemplo: string; veces: number; ultimo: string }> }>("chat/sin-respuesta");
  const aviso = useAviso();
  if (error) return <Mensaje>{error}</Mensaje>;
  if (!datos) return <Cargando />;
  async function resolver(id: number) {
    try { await api(`chat/sin-respuesta/${id}/resuelta`, { metodo: "POST" }); await recargar(); alCambiar(); } catch (e) { aviso.error(e); }
  }
  return (
    <div className="space-y-3">
      <aviso.Aviso />
      <p className="text-sm text-tinta-suave">Lo que preguntaron y el asistente no supo responder (sin datos personales; se borra a los 90 días). Sumá una pregunta frecuente o agregá esas palabras a una que ya exista, y marcala como resuelta.</p>
      <div className="overflow-x-auto rounded-2xl border border-linea bg-white">
        <table className="tabla-apilada w-full min-w-[560px] text-left text-sm">
          <thead className="border-b border-linea text-tinta-tenue"><tr><th className="px-4 py-3">Consulta</th><th className="px-4 py-3">Veces</th><th className="px-4 py-3">Última</th><th className="px-4 py-3"></th></tr></thead>
          <tbody className="divide-y divide-linea">
            {datos.preguntas.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-3 break-words">{p.ejemplo}</td>
                <td className="px-4 py-3" data-etiqueta="Veces">{p.veces}</td>
                <td className="px-4 py-3" data-etiqueta="Última">{fecha(p.ultimo)}</td>
                <td className="px-4 py-3 text-right">{operador && <Boton variante="borde" onClick={() => void resolver(p.id)}>Resuelta</Boton>}</td>
              </tr>
            ))}
            {!datos.preguntas.length && <tr><td colSpan={4} className="px-4 py-10 text-center text-tinta-tenue">Nada pendiente: el asistente respondió todo.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Probar() {
  const [texto, setTexto] = useState("");
  const [r, setR] = useState<{ palabras: string[]; cercanas: Array<{ id: number; pregunta: string; puntaje: number }>; respuesta: { texto?: string; tema?: string; error?: string } } | null>(null);
  const aviso = useAviso();
  async function probar() {
    if (!texto.trim()) return;
    try { setR(await api("chat/probar", { cuerpo: { mensaje: texto } })); } catch (e) { aviso.error(e); }
  }
  return (
    <Tarjeta titulo="Probá una pregunta">
      <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); void probar(); }}>
        <input className={claseEntrada} maxLength={300} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escribila como la escribiría un cliente" aria-label="Pregunta de prueba" />
        <Boton type="submit">Probar</Boton>
      </form>
      <div className="mt-3"><aviso.Aviso /></div>
      {r && (
        <div className="mt-4 space-y-3 text-sm">
          <p className="rounded-xl bg-fondo-suave p-3 whitespace-pre-line">{r.respuesta.texto ?? r.respuesta.error}</p>
          <p className="text-xs text-tinta-tenue">Tema: {NOMBRE_TEMA[r.respuesta.tema ?? ""] ?? r.respuesta.tema ?? "—"} · Palabras que tomó: {r.palabras.join(", ") || "—"}</p>
          {r.cercanas.length > 0 && (
            <ul className="space-y-1">{r.cercanas.map((c) => <li key={c.id} className="flex justify-between gap-3"><span>{c.pregunta}</span><span className="shrink-0 font-bold">{Math.round(c.puntaje * 100)}%</span></li>)}</ul>
          )}
          <p className="text-xs text-tinta-tenue">Responde con una pregunta frecuente desde el 50%, o desde el 30% si ninguna otra le queda cerca. Las pruebas no cuentan en las estadísticas.</p>
        </div>
      )}
    </Tarjeta>
  );
}
