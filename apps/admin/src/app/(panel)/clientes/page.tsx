"use client";
import { useState } from "react";
import { api, fecha, pesos, useDatos } from "@/lib/api";
import { Boton, Cargando, claseEntrada, Insignia, Mensaje, Paginador, Titulo, useAviso } from "@/components/ui";
import { puede, useYo } from "@/components/Marco";

interface Cliente { id: number; email: string; nombre: string; apellido: string | null; telefono: string | null; dni: string | null; tieneCuenta: boolean; aceptaNovedades: boolean; creadoEn: string; compras: number; gastado: number; ultimaCompra: string | null }

/* Clientes de la tienda (con cuenta o que compraron como invitados). Se mandan a Stocker solos al comprar. */
export default function Clientes() {
  const yo = useYo();
  const [q, setQ] = useState("");
  const [buscado, setBuscado] = useState("");
  const [pagina, setPagina] = useState(1);
  const { datos, error } = useDatos<{ clientes: Cliente[]; total: number; porPagina: number }>("clientes", { q: buscado, pagina });
  const aviso = useAviso();
  const sincronizar = (ids?: number[]) => api<{ encolados: number }>("clientes/sincronizar", { cuerpo: ids ? { ids } : {} })
    .then((r) => aviso.ok(`${r.encolados} clientes en camino a Stocker.`), aviso.error);
  return (
    <>
      <Titulo acciones={puede(yo, "dueno") && <Boton variante="borde" onClick={() => confirm("¿Mandar TODOS los clientes a Stocker?") && void sincronizar()}>Mandar todos a Stocker</Boton>}>Clientes</Titulo>
      <form className="mb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); setBuscado(q); setPagina(1); }}>
        <input className={`${claseEntrada} max-w-sm`} placeholder="Email, nombre, DNI o teléfono" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" />
      </form>
      <div className="mb-4"><aviso.Aviso /></div>
      <Mensaje>{error}</Mensaje>
      {!datos ? <Cargando /> : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-linea bg-white">
            <table className="tabla-apilada w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-linea text-tinta-tenue"><tr><th className="px-4 py-3">Cliente</th><th className="px-4 py-3">Contacto</th><th className="px-4 py-3 text-right">Compras</th><th className="px-4 py-3 text-right">Gastado</th><th className="px-4 py-3">Última</th><th className="px-4 py-3" /></tr></thead>
              <tbody className="divide-y divide-linea">
                {datos.clientes.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-3"><span className="font-bold">{c.nombre} {c.apellido}</span><br />{c.tieneCuenta ? <Insignia clase="bg-marca-claro text-marca">Con cuenta</Insignia> : <Insignia>Invitado</Insignia>} {c.aceptaNovedades && <Insignia clase="bg-ahorro-claro text-ahorro">Novedades</Insignia>}</td>
                    <td className="px-4 py-3">{c.email}<br /><span className="text-xs text-tinta-tenue">{[c.telefono, c.dni && `DNI ${c.dni}`].filter(Boolean).join(" · ")}</span></td>
                    <td className="px-4 py-3 text-right" data-etiqueta="Compras">{c.compras}</td>
                    <td className="px-4 py-3 text-right" data-etiqueta="Gastado">{pesos(c.gastado)}</td>
                    <td className="px-4 py-3 text-xs" data-etiqueta="Última compra">{fecha(c.ultimaCompra)}</td>
                    <td className="px-4 py-3 text-right">{puede(yo, "operador") && <Boton variante="texto" onClick={() => void sincronizar([c.id])}>A Stocker</Boton>}</td>
                  </tr>
                ))}
                {!datos.clientes.length && <tr><td colSpan={6} className="px-4 py-10 text-center text-tinta-tenue">No hay clientes.</td></tr>}
              </tbody>
            </table>
          </div>
          <Paginador pagina={pagina} total={datos.total} porPagina={datos.porPagina} onCambiar={setPagina} />
        </>
      )}
    </>
  );
}
