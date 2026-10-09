"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { api, fecha, useDatos } from "@/lib/api";
import { Boton, Cargando, claseEntrada, Insignia, Mensaje, Titulo, useAviso } from "@/components/ui";
import { puede, useYo } from "@/components/Marco";

/*
 * Envíos (etapa 4). El circuito del día:
 *   Para preparar → (Preparar) → Etiquetados → (Imprimir, armar la caja,
 *   despachar en Envíos del día de Stocker) → En camino → Entregados.
 * Lo que no se pudo entregar, se devolvió o el transporte no responde
 * aparece en Problemas.
 *
 * Etapa 15: todo el pedido va en una bolsa (la columna Pedido dice cuál).
 * Correo Argentino (MiCorreo): «Preparar» lo carga en MiCorreo; el rótulo se
 * paga e imprime allá y su número se carga acá (a mano o con el lector).
 */
const VISTAS = [
  ["preparar", "Para preparar"], ["etiquetados", "Etiquetados"], ["en_camino", "En camino"], ["problemas", "Problemas"], ["entregados", "Entregados"],
] as const;
type Vista = (typeof VISTAS)[number][0];
const ESTADO_ENVIO: Record<string, [string, string]> = {
  creado: ["Etiquetado", "bg-fondo-suave text-tinta-suave"], en_camino: ["En camino", "bg-marca-claro text-marca"], en_sucursal: ["En sucursal", "bg-marca-claro text-marca"],
  en_reparto: ["En reparto", "bg-marca-claro text-marca"], entregado: ["Entregado", "bg-ahorro-claro text-ahorro"], no_entregado: ["No entregado", "bg-red-50 text-oferta"],
  devuelto: ["Devuelto", "bg-red-50 text-oferta"], cancelado: ["Cancelado", "bg-fondo-suave text-tinta-tenue"],
};
const SERVICIO: Record<string, string> = { domicilio: "Domicilio", sucursal: "Sucursal", en_el_dia: "En el día" };

interface Fila {
  numero: string; estado: string; cliente: string; transporte: string; nombreTransporte: string; servicio: string; cp: string | null; localidad: string | null; sucursal: string | null;
  pagadoEn: string | null; avisosWhatsapp: boolean; prendas: number; seguimiento: string | null; estadoEnvio: string | null; tieneEtiqueta: boolean;
  despachadoEn: string | null; entregadoEn: string | null; ultimoError: string | null; erroresSeguidos: number | null; urlSeguimiento: string | null;
  faltaNumero: boolean; bolsa: string | null; bolsaNoEntra: boolean;
}
interface Resultado { numero: string; ok: boolean; seguimiento?: string | null; etiqueta?: boolean; portal?: string | null; mensaje?: string }

function Envios() {
  const sp = useSearchParams();
  const router = useRouter();
  const yo = useYo();
  const operador = puede(yo, "operador");
  const vista = (VISTAS.some(([v]) => v === sp.get("vista")) ? sp.get("vista") : "preparar") as Vista;
  const [q, setQ] = useState(sp.get("q") ?? "");
  const { datos, error, cargando, recargar } = useDatos<{ envios: Fila[]; conteo: Record<Vista, number>; transportes: string[]; portales: Record<string, string> }>("envios", { vista, q: sp.get("q") });
  const [elegidos, setElegidos] = useState<Set<string>>(new Set());
  const [trabajando, setTrabajando] = useState(false);
  const [resultados, setResultados] = useState<Resultado[] | null>(null);
  const aviso = useAviso();
  const ir = (cambios: Record<string, string | null>) => {
    const n = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(cambios)) { if (!v) n.delete(k); else n.set(k, v); }
    setElegidos(new Set()); setResultados(null);
    router.replace(`/envios?${n}`);
  };
  const filas = datos?.envios ?? [];
  const todos = filas.length > 0 && filas.every((f) => elegidos.has(f.numero));
  const alternar = (n: string) => setElegidos((s) => { const x = new Set(s); if (x.has(n)) x.delete(n); else x.add(n); return x; });
  const lista = [...elegidos].slice(0, 30);

  async function preparar() {
    if (!lista.length) return;
    setTrabajando(true); setResultados(null); aviso.limpiar();
    try {
      const r = await api<{ resultados: Resultado[] }>("envios/preparar", { cuerpo: { numeros: lista } });
      setResultados(r.resultados);
      const ok = r.resultados.filter((x) => x.ok).length;
      const enPortal = r.resultados.filter((x) => x.ok && x.portal).length;
      if (ok) aviso.ok(`${ok} ${ok === 1 ? "envío preparado" : "envíos preparados"}. Ahora imprimí las etiquetas en "Etiquetados".${enPortal ? ` ${enPortal} de Correo Argentino ${enPortal === 1 ? "quedó cargado" : "quedaron cargados"} en MiCorreo: pagá e imprimí ${enPortal === 1 ? "el rótulo" : "los rótulos"} allá y cargá acá ${enPortal === 1 ? "su número" : "el número de cada uno"}.` : ""}`);
      setElegidos(new Set(r.resultados.filter((x) => !x.ok).map((x) => x.numero)));
      await recargar();
    } catch (e) { aviso.error(e); } finally { setTrabajando(false); }
  }

  async function imprimir() {
    if (!lista.length) return;
    setTrabajando(true); aviso.limpiar();
    try {
      const r = await fetch(`/api/a/envios/etiquetas?numeros=${encodeURIComponent(lista.join(","))}`, { headers: { "x-isu": "1" }, credentials: "same-origin", cache: "no-store" });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(String((d as { mensaje?: string }).mensaje ?? "No se pudieron bajar las etiquetas.")); }
      const faltan = r.headers.get("x-isu-sin-etiqueta");
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url; a.download = `etiquetas-${new Date().toISOString().slice(0, 10)}.pdf`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      if (faltan) aviso.error(new Error(`Sin etiqueta por API (imprimilas desde el portal del transporte): ${faltan.replaceAll(",", ", ")}`));
      else aviso.ok("Etiquetas descargadas.");
    } catch (e) { aviso.error(e); } finally { setTrabajando(false); }
  }

  async function descartar(numero: string) {
    const motivo = window.prompt(`¿Por qué descartás la etiqueta de ${numero}? (el pedido vuelve a "Para preparar")`);
    if (!motivo || motivo.trim().length < 3) return;
    try {
      const r = await api<{ aviso: string | null }>(`envios/${numero}/descartar`, { cuerpo: { motivo: motivo.trim() } });
      aviso.ok(r.aviso ?? "Etiqueta descartada.");
      await recargar();
    } catch (e) { aviso.error(e); }
  }
  async function actualizar(numero: string) {
    try { await api(`envios/${numero}/actualizar`, { metodo: "POST" }); aviso.ok("Le preguntamos al transporte. En un minuto se actualiza."); } catch (e) { aviso.error(e); }
  }

  const acciones = operador && (vista === "preparar" || vista === "etiquetados") && (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-tinta-tenue">{elegidos.size} elegidos{elegidos.size > 30 ? " (de a 30)" : ""}</span>
      {vista === "preparar"
        ? <Boton onClick={preparar} disabled={!elegidos.size || trabajando}>{trabajando ? "Preparando…" : "Preparar envíos"}</Boton>
        : <Boton onClick={imprimir} disabled={!elegidos.size || trabajando}>{trabajando ? "Bajando…" : "Imprimir etiquetas"}</Boton>}
    </div>
  );

  return (
    <>
      <Titulo acciones={acciones}>Envíos</Titulo>
      <nav aria-label="Vistas" className="-mx-1 mb-4 flex gap-1 overflow-x-auto px-1 pb-1">
        {VISTAS.map(([v, t]) => (
          <button key={v} type="button" onClick={() => ir({ vista: v === "preparar" ? null : v })} aria-current={vista === v ? "page" : undefined}
            className={`shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-sm ${vista === v ? "bg-tinta font-bold text-white" : "bg-white ring-1 ring-linea hover:ring-tinta"}`}>
            {t}{datos && datos.conteo[v] ? <span className={`ml-1.5 rounded-full px-1.5 text-xs ${v === "problemas" ? "bg-oferta text-white" : vista === v ? "bg-white/20" : "bg-fondo-suave"}`}>{datos.conteo[v]}</span> : null}
          </button>
        ))}
      </nav>
      <form className="mb-4 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); ir({ q }); }}>
        <input className={`${claseEntrada} max-w-xs`} placeholder="Pedido, cliente o seguimiento" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" />
      </form>
      {vista === "etiquetados" && (
        <p className="mb-4 text-sm text-tinta-suave">
          Imprimí, armá cada pedido en su bolsa y despachalo desde <b>Envíos del día en Stocker</b>: ahí se descuenta el stock y el pedido pasa solo a "En camino" (y se le avisa al cliente).
          {datos?.portales.correo_argentino && <> Los de <b>Correo Argentino</b>: pagá e imprimí el rótulo en <a href={datos.portales.correo_argentino} target="_blank" rel="noopener noreferrer" className="font-bold text-marca hover:underline">MiCorreo</a> y cargá su número acá (se puede con el lector de códigos).</>}
        </p>
      )}
      {datos && !datos.transportes.length && <Mensaje tipo="info">No hay transportes configurados (faltan las credenciales en el servidor): los envíos salen como envío estándar y se marcan a mano desde el pedido.</Mensaje>}
      <div className="space-y-3">
        <aviso.Aviso />
        <Mensaje>{error}</Mensaje>
        {resultados?.some((r) => !r.ok) && (
          <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-oferta" role="alert">
            <p className="font-bold">No se pudieron preparar:</p>
            <ul className="mt-1 list-disc pl-5">{resultados.filter((r) => !r.ok).map((r) => <li key={r.numero}><b>{r.numero}</b>: {r.mensaje}</li>)}</ul>
          </div>
        )}
      </div>

      {cargando && !datos ? <Cargando /> : datos && (
        <div className="mt-4 overflow-x-auto rounded-2xl border border-linea bg-white">
          <table className="tabla-apilada w-full min-w-[820px] text-left text-sm">
            <thead className="border-b border-linea text-tinta-tenue"><tr>
              {operador && (vista === "preparar" || vista === "etiquetados") && (
                <th className="w-10 px-4 py-3"><input type="checkbox" aria-label="Elegir todos" checked={todos} onChange={() => setElegidos(todos ? new Set() : new Set(filas.map((f) => f.numero)))} className="size-4 accent-tinta" /></th>
              )}
              <th className="px-4 py-3">Pedido</th><th className="px-4 py-3">Destino</th><th className="px-4 py-3">Transporte</th><th className="px-4 py-3">Seguimiento</th><th className="px-4 py-3"></th>
            </tr></thead>
            <tbody className="divide-y divide-linea">
              {filas.map((f) => (
                <tr key={f.numero} className={elegidos.has(f.numero) ? "bg-marca-claro/40" : "hover:bg-fondo-suave"}>
                  {operador && (vista === "preparar" || vista === "etiquetados") && (
                    <td className="px-4 py-3"><input type="checkbox" aria-label={`Elegir ${f.numero}`} checked={elegidos.has(f.numero)} onChange={() => alternar(f.numero)} className="size-4 accent-tinta" /></td>
                  )}
                  <td className="px-4 py-3">
                    <Link href={`/pedidos/${f.numero}`} className="font-bold text-marca hover:underline">{f.numero}</Link>
                    <br /><span className="text-xs text-tinta-tenue">{f.cliente} · {f.prendas} {f.prendas === 1 ? "prenda" : "prendas"}{f.bolsa && ` · bolsa ${f.bolsa}`}</span>
                    {f.bolsaNoEntra && <><br /><Insignia clase="bg-amber-50 text-amber-900">No entra en ninguna bolsa: revisalo</Insignia></>}
                  </td>
                  <td className="px-4 py-3" data-etiqueta="Destino">{f.sucursal ?? `${f.localidad ?? ""} (${f.cp ?? "—"})`}</td>
                  <td className="px-4 py-3" data-etiqueta="Transporte">
                    {f.nombreTransporte} · {SERVICIO[f.servicio] ?? f.servicio}
                    {f.servicio === "en_el_dia" && <Insignia clase="ml-1 bg-marca text-white">Hoy</Insignia>}
                    {f.avisosWhatsapp && <span className="ml-1 text-xs text-tinta-tenue" title="Pidió avisos por WhatsApp">· WA</span>}
                  </td>
                  <td className="px-4 py-3" data-etiqueta="Seguimiento">
                    {f.faltaNumero && (
                      <CargarNumero numero={f.numero} portal={datos.portales[f.transporte] ?? null} puede={operador} alGuardar={async (texto, atencion) => { if (atencion) aviso.error(new Error(texto)); else aviso.ok(texto); await recargar(); }} alFallar={aviso.error} />
                    )}
                    {f.faltaNumero ? null : f.seguimiento ? (
                      <>
                        {f.urlSeguimiento ? <a href={f.urlSeguimiento} target="_blank" rel="noopener noreferrer" className="break-all text-marca hover:underline">{f.seguimiento}</a> : <span className="break-all">{f.seguimiento}</span>}
                        <br />
                        {f.estadoEnvio && <Insignia clase={ESTADO_ENVIO[f.estadoEnvio]?.[1]}>{ESTADO_ENVIO[f.estadoEnvio]?.[0] ?? f.estadoEnvio}</Insignia>}
                        {vista === "etiquetados" && !f.tieneEtiqueta && <span className="ml-1 text-xs text-tinta-tenue">sin etiqueta guardada</span>}
                        {f.ultimoError && <span className="mt-1 block text-xs text-oferta">{f.ultimoError}</span>}
                      </>
                    ) : <span className="text-tinta-tenue">Pagado {fecha(f.pagadoEn)}</span>}
                    {f.despachadoEn && <span className="block text-xs text-tinta-tenue">Salió {fecha(f.despachadoEn)}</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    {operador && vista === "etiquetados" && <Boton variante="borde" onClick={() => descartar(f.numero)}>Descartar</Boton>}
                    {operador && (vista === "en_camino" || vista === "problemas") && <Boton variante="borde" onClick={() => actualizar(f.numero)}>Actualizar</Boton>}
                  </td>
                </tr>
              ))}
              {!filas.length && <tr><td colSpan={6} className="px-4 py-10 text-center text-tinta-tenue">{vista === "preparar" ? "No hay pedidos pagados esperando envío." : "No hay envíos en esta vista."}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** Correo Argentino (MiCorreo): el número del rótulo, a mano o con el lector de códigos (escribe y manda Enter). */
function CargarNumero({ numero, portal, puede: habilitado, alGuardar, alFallar }: {
  numero: string; portal: string | null; puede: boolean; alGuardar: (texto: string, atencion: boolean) => Promise<void>; alFallar: (e: unknown) => void;
}) {
  const [valor, setValor] = useState("");
  const [guardando, setGuardando] = useState(false);
  async function guardar() {
    const tn = valor.trim().toUpperCase();
    if (!tn) return;
    setGuardando(true);
    try {
      const r = await api<{ aviso: string | null }>(`envios/${numero}/seguimiento`, { cuerpo: { seguimiento: tn } });
      setValor("");
      await alGuardar(r.aviso ?? `${numero}: número ${tn} guardado. Desde ahora el envío se sigue solo.`, !!r.aviso);
    } catch (e) { alFallar(e); } finally { setGuardando(false); }
  }
  return (
    <div className="space-y-1.5">
      <Insignia clase="bg-amber-50 text-amber-900">Falta el número del rótulo</Insignia>
      {portal && <a href={portal} target="_blank" rel="noopener noreferrer" className="block text-xs font-bold text-marca hover:underline">Pagar e imprimir en MiCorreo ↗</a>}
      {habilitado && (
        <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); void guardar(); }}>
          <input className={`${claseEntrada} w-48 py-1.5 font-mono text-sm uppercase`} placeholder="Número del rótulo" autoComplete="off" spellCheck={false}
            aria-label={`Número de seguimiento de ${numero}`} value={valor} onChange={(e) => setValor(e.target.value.replace(/\s+/g, ""))} maxLength={40} />
          <Boton type="submit" variante="borde" disabled={guardando || valor.trim().length < 8}>{guardando ? "…" : "Guardar"}</Boton>
        </form>
      )}
    </div>
  );
}

export default function Pagina() { return <Suspense fallback={<Cargando />}><Envios /></Suspense>; }
