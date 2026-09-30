"use client";
import Link from "next/link";
import { fecha, pesos, useDatos } from "@/lib/api";
import { Insignia, Tarjeta } from "./ui";

/* El envío del pedido en su ficha: transporte, seguimiento, eventos y avisos mandados. */
const TRANSPORTE: Record<string, string> = { correo_argentino: "Correo Argentino", andreani: "Andreani", oca: "OCA", mercado_envios: "Mercado Envíos", cabify: "Cabify", estandar: "Envío estándar" };
const SERVICIO: Record<string, string> = { domicilio: "a domicilio", sucursal: "a sucursal", en_el_dia: "en el día" };
const AVISO: Record<string, string> = { en_camino: "En camino", en_sucursal: "En sucursal", llega_hoy: "Llega hoy", entregado: "Entregado", no_entregado: "No entregado" };

interface Datos {
  envios: Array<{ id: number; transporte: string; seguimiento: string; estado: string; activo: boolean; tieneEtiqueta: boolean; despachadoEn: string | null; entregadoEn: string | null; ultimoError: string | null; creadoPor: string | null; creadoEn: string; urlSeguimiento: string | null }>;
  eventos: Array<{ fecha: string; estado: string; descripcion: string; ubicacion: string | null }>;
  avisos: Array<{ tipo: string; canal: string; creadoEn: string }>;
}

export function CajaEnvio({ numero, pedido }: { numero: string; pedido: Record<string, unknown> }) {
  const { datos } = useDatos<Datos>(`envios/${numero}`);
  const t = String(pedido.transporte ?? "estandar");
  const suc = pedido.sucursal_envio as { nombre?: string; direccion?: string } | null;
  const vigente = datos?.envios.find((e) => e.activo);
  return (
    <Tarjeta titulo="Envío">
      <p className="text-sm"><b>{TRANSPORTE[t] ?? t}</b> {SERVICIO[String(pedido.servicio_envio ?? "")] ?? ""}</p>
      {suc?.nombre && <p className="text-sm text-tinta-suave">Sucursal: {suc.nombre}{suc.direccion ? ` · ${suc.direccion}` : ""}</p>}
      {typeof pedido.envio_mercado_pago === "number" && <p className="text-sm text-tinta-suave">Cobrado por Mercado Pago: {pesos(pedido.envio_mercado_pago)}</p>}
      <p className="text-xs text-tinta-tenue">Avisos por WhatsApp: {pedido.avisos_whatsapp ? "sí" : "no"}</p>
      {t === "estandar" ? <p className="mt-2 text-sm text-tinta-suave">Sin transporte integrado: se marca enviado y entregado a mano.</p>
        : !vigente ? <p className="mt-2 text-sm">Todavía sin etiqueta. <Link href="/envios" className="text-marca hover:underline">Preparalo en Envíos</Link>.</p>
        : (
          <div className="mt-2 space-y-1 text-sm">
            <p>Seguimiento: {vigente.urlSeguimiento ? <a href={vigente.urlSeguimiento} target="_blank" rel="noopener noreferrer" className="break-all text-marca hover:underline">{vigente.seguimiento}</a> : <span className="break-all">{vigente.seguimiento}</span>}</p>
            <p><Insignia>{vigente.estado.replaceAll("_", " ")}</Insignia></p>
            <p className="text-xs text-tinta-tenue">Etiqueta {fecha(vigente.creadoEn)}{vigente.creadoPor ? ` por ${vigente.creadoPor}` : ""}{vigente.despachadoEn ? ` · salió ${fecha(vigente.despachadoEn)}` : " · sin despachar"}</p>
            {vigente.ultimoError && <p className="text-xs text-oferta">{vigente.ultimoError}</p>}
          </div>
        )}
      {datos && datos.eventos.length > 0 && (
        <ol className="mt-3 max-h-60 space-y-2 overflow-y-auto border-l-2 border-linea pl-3 text-xs">
          {datos.eventos.map((e, i) => <li key={i}><span className="text-tinta-tenue">{fecha(e.fecha)}{e.ubicacion ? ` · ${e.ubicacion}` : ""}</span><br />{e.descripcion}</li>)}
        </ol>
      )}
      {datos && datos.avisos.length > 0 && (
        <p className="mt-3 text-xs text-tinta-tenue">Avisos mandados: {datos.avisos.map((a) => `${AVISO[a.tipo] ?? a.tipo} (${a.canal === "whatsapp" ? "WA" : "mail"})`).join(", ")}</p>
      )}
      {datos && datos.envios.filter((e) => !e.activo).length > 0 && <p className="mt-2 text-xs text-tinta-tenue">Etiquetas descartadas: {datos.envios.filter((e) => !e.activo).map((e) => e.seguimiento).join(", ")}</p>}
    </Tarjeta>
  );
}
