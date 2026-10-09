"use client";
import { useState } from "react";
import { fecha, useDatos } from "@/lib/api";
import { Boton, Cargando, claseEntrada, Mensaje, Titulo } from "@/components/ui";

interface Registro { id: number; actor: string; accion: string; entidad: string; entidadId: string | null; detalle: unknown; ip: string | null; creadoEn: string }
// «datos cliente»: quién abrió datos de clientes (pedidos, clientes, envíos) — etapa 15.
const ENTIDADES = ["", "datos_cliente", "admin", "pedido", "envio", "producto", "categoria", "descuento", "guia_talles", "cliente", "ajuste", "catalogo", "color"];

/* Quién hizo qué y cuándo. No se puede editar ni borrar (lo impide la base). */
export default function Auditoria() {
  const [entidad, setEntidad] = useState("");
  const [pagina, setPagina] = useState(1);
  const { datos, error } = useDatos<{ registros: Registro[] }>("auditoria", { entidad, pagina });
  return (
    <>
      <Titulo>Auditoría</Titulo>
      <select className={`${claseEntrada} mb-4 max-w-72`} value={entidad} onChange={(e) => { setEntidad(e.target.value); setPagina(1); }} aria-label="Filtrar">
        {ENTIDADES.map((e) => <option key={e} value={e}>{e === "datos_cliente" ? "Quién vio datos de clientes" : e ? e.replace("_", " ") : "Todo"}</option>)}
      </select>
      <Mensaje>{error}</Mensaje>
      {!datos ? <Cargando /> : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-linea bg-white">
            <table className="tabla-apilada w-full min-w-[800px] text-left text-sm">
              <thead className="border-b border-linea text-tinta-tenue"><tr><th className="px-4 py-3">Cuándo</th><th className="px-4 py-3">Quién</th><th className="px-4 py-3">Qué</th><th className="px-4 py-3">Detalle</th><th className="px-4 py-3">IP</th></tr></thead>
              <tbody className="divide-y divide-linea">
                {datos.registros.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs">{fecha(r.creadoEn)}</td>
                    <td className="px-4 py-2.5">{r.actor}</td>
                    <td className="px-4 py-2.5"><span className="font-bold">{r.accion.replaceAll("_", " ")}</span><br /><span className="text-xs text-tinta-tenue">{r.entidad}{r.entidadId ? ` ${r.entidadId}` : ""}</span></td>
                    <td className="max-w-md px-4 py-2.5" data-etiqueta="Detalle">{r.detalle ? <details><summary className="cursor-pointer text-xs text-marca">ver</summary><pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded bg-fondo-suave p-2 text-xs">{JSON.stringify(r.detalle, null, 2)}</pre></details> : "—"}</td>
                    <td className="px-4 py-2.5 text-xs" data-etiqueta="IP">{r.ip ?? "—"}</td>
                  </tr>
                ))}
                {!datos.registros.length && <tr><td colSpan={5} className="px-4 py-10 text-center text-tinta-tenue">Sin registros.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Boton variante="borde" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>Más nuevos</Boton>
            <Boton variante="borde" disabled={datos.registros.length < 50} onClick={() => setPagina(pagina + 1)}>Más viejos</Boton>
          </div>
        </>
      )}
    </>
  );
}
