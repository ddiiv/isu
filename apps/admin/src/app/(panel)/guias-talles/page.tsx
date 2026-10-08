"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { infoMedida, NOMBRE_TIPO_GUIA } from "@isu/shared";
import { api, fecha, useDatos } from "@/lib/api";
import type { GuiaResumen } from "@/lib/catalogo";
import { Boton, Cargando, Insignia, Mensaje, Tarjeta, Titulo, useAviso } from "@/components/ui";
import { puede, useYo } from "@/components/Marco";

/*
 * Guías de talles: una por molde de prenda; cada producto se asocia a la suya.
 * Etapa 10: se exportan e importan con Excel (una hoja por guía).
 */
interface Importacion { vista: boolean; guias: Array<{ nombre: string; tipo: GuiaResumen["tipo"]; talles: string[]; medidas: number; accion: "crear" | "actualizar" }>; errores: Array<{ hoja: string; mensaje: string }> }

export default function Guias() {
  const yo = useYo();
  const operador = puede(yo, "operador");
  const { datos, error, recargar } = useDatos<{ guias: GuiaResumen[] }>("guias-talles");
  const aviso = useAviso();
  const entrada = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [vista, setVista] = useState<Importacion | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  async function revisar(f: File | undefined) {
    if (!f) return;
    setArchivo(f); setVista(null); setTrabajando(true);
    try { setVista(await api<Importacion>("guias-talles/excel", { archivo: f, query: { vista: 1 } })); }
    catch (e) { aviso.error(e); setArchivo(null); }
    finally { setTrabajando(false); if (entrada.current) entrada.current.value = ""; }
  }
  async function importar() {
    if (!archivo) return;
    setTrabajando(true);
    try {
      const r = await api<Importacion>("guias-talles/excel", { archivo });
      const creadas = r.guias.filter((g) => g.accion === "crear").length;
      aviso.ok(`Listo: ${creadas} guías nuevas y ${r.guias.length - creadas} actualizadas${r.errores.length ? ` (${r.errores.length} hojas con errores no se importaron)` : ""}.`);
      setArchivo(null); setVista(null);
      await recargar();
    } catch (e) { aviso.error(e); }
    finally { setTrabajando(false); }
  }

  return (
    <>
      <Titulo acciones={<>
        <a href="/api/a/guias-talles/excel" download className="rounded-full border border-linea bg-white px-4 py-2 text-sm font-bold hover:border-tinta">Exportar a Excel</a>
        {operador && <>
          <input ref={entrada} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" aria-label="Archivo de Excel con guías" onChange={(e) => void revisar(e.target.files?.[0])} />
          <Boton variante="borde" disabled={trabajando} onClick={() => entrada.current?.click()}>Importar Excel</Boton>
          <Link href="/guias-talles/nueva" className="rounded-full bg-tinta px-4 py-2 text-sm font-bold text-white hover:bg-marca-fuerte">Nueva guía</Link>
        </>}
      </>}>Guías de talles</Titulo>
      <div className="mb-4"><aviso.Aviso /></div>
      {trabajando && !vista && <Cargando texto="Leyendo el archivo…" />}
      {vista && (
        <Tarjeta className="mb-6" titulo={`Importar «${archivo?.name ?? "archivo"}»`} acciones={<div className="flex gap-2">
          <Boton variante="texto" onClick={() => { setVista(null); setArchivo(null); }}>Cancelar</Boton>
          <Boton disabled={trabajando || !vista.guias.length} onClick={() => void importar()}>{trabajando ? "Importando…" : `Importar ${vista.guias.length} guías`}</Boton>
        </div>}>
          <p className="mb-3 text-sm text-tinta-suave">Así va a quedar. Las que ya existen con el mismo nombre se actualizan y siguen asociadas a sus productos. Nada se guarda hasta que toques «Importar».</p>
          {vista.errores.length > 0 && (
            <div className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-oferta" role="alert">
              <p className="font-bold">{vista.errores.length} {vista.errores.length === 1 ? "hoja no se va a importar" : "hojas no se van a importar"}:</p>
              <ul className="mt-1 list-disc pl-5">{vista.errores.map((e) => <li key={e.hoja}><b>{e.hoja}</b>: {e.mensaje}</li>)}</ul>
            </div>
          )}
          <ul className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {vista.guias.map((g) => (
              <li key={g.nombre} className="rounded-xl border border-linea p-3">
                <span className="flex items-center justify-between gap-2"><b>{g.nombre}</b><Insignia clase={g.accion === "crear" ? "bg-ahorro-claro text-ahorro" : "bg-marca-claro text-marca-fuerte"}>{g.accion === "crear" ? "Nueva" : "Se actualiza"}</Insignia></span>
                <span className="block text-xs text-tinta-tenue">{NOMBRE_TIPO_GUIA[g.tipo]} · {g.talles.join(" ")} · {g.medidas} medidas</span>
              </li>
            ))}
          </ul>
        </Tarjeta>
      )}
      <p className="-mt-3 mb-6 max-w-2xl text-sm text-tinta-suave">Como en Mercado Libre: cada prenda mide distinto, así que se arma una guía por molde (por ejemplo "Remera regular adulto" o "Jogger niños") y se asocia a los productos que tienen esos talles. En la tienda aparece el botón "Guía de talles" y la calculadora "¿Cuál es mi talle?". Con Excel: una hoja por guía, con «Medida | S | M | L…» en la primera fila y una medida por fila.</p>
      <Mensaje>{error}</Mensaje>
      {!datos ? <Cargando /> : (
        <div className="overflow-x-auto rounded-2xl border border-linea bg-white">
          <table className="tabla-apilada w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-linea text-tinta-tenue"><tr><th className="px-4 py-3">Guía</th><th className="px-4 py-3">Tipo</th><th className="px-4 py-3">Medidas</th><th className="px-4 py-3 text-right">Talles</th><th className="px-4 py-3 text-right">Productos</th><th className="px-4 py-3">Última edición</th></tr></thead>
            <tbody className="divide-y divide-linea">
              {datos.guias.map((g) => (
                <tr key={g.id} className="hover:bg-fondo-suave">
                  <td className="px-4 py-3"><Link href={`/guias-talles/${g.slug}`} className="font-bold text-marca hover:underline">{g.nombre}</Link></td>
                  <td className="px-4 py-3"><Insignia>{NOMBRE_TIPO_GUIA[g.tipo]}</Insignia></td>
                  <td className="px-4 py-3 text-xs" data-etiqueta="Medidas">{g.medidas.map((m) => infoMedida(m).nombre).join(", ")}</td>
                  <td className="px-4 py-3 text-right" data-etiqueta="Talles">{g.talles}</td>
                  <td className="px-4 py-3 text-right" data-etiqueta="Productos">{g.productos || <span className="text-oferta">0</span>}</td>
                  <td className="px-4 py-3 text-xs text-tinta-tenue">{fecha(g.actualizadoEn)}{g.actualizadoPor ? ` · ${g.actualizadoPor}` : ""}</td>
                </tr>
              ))}
              {!datos.guias.length && <tr><td colSpan={6} className="px-4 py-10 text-center text-tinta-tenue">Todavía no hay guías. Creá la primera.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
