"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ESTADOS, fecha, MEDIOS, pesos, useDatos } from "@/lib/api";
import { Cargando, claseEntrada, Insignia, Mensaje, Paginador, Titulo } from "@/components/ui";

interface Fila { numero: string; estado: string; medioPago: string; entrega: string; total: number; nombre: string; apellido: string; email: string; creadoEn: string; venceEn: string | null }

function Pedidos() {
  const sp = useSearchParams();
  const router = useRouter();
  const estado = sp.get("estado") ?? "";
  const pagina = Number(sp.get("pagina") ?? 1) || 1;
  const [q, setQ] = useState(sp.get("q") ?? "");
  const { datos, error, cargando } = useDatos<{ pedidos: Fila[]; total: number; porPagina: number }>("pedidos", { estado, q: sp.get("q"), pagina });
  const ir = (cambios: Record<string, string | number | null>) => {
    const n = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(cambios)) { if (v === null || v === "") n.delete(k); else n.set(k, String(v)); }
    router.replace(`/pedidos?${n}`);
  };

  return (
    <>
      <Titulo>Pedidos</Titulo>
      <form className="mb-4 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); ir({ q, pagina: null }); }}>
        <input className={`${claseEntrada} max-w-xs`} placeholder="Número, email, nombre o DNI" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" />
        <select className={`${claseEntrada} max-w-60`} value={estado} onChange={(e) => ir({ estado: e.target.value, pagina: null })} aria-label="Estado">
          <option value="">Todos los estados</option>
          {Object.entries(ESTADOS).filter(([k]) => k !== "reservando").map(([k, [t]]) => <option key={k} value={k}>{t}</option>)}
        </select>
      </form>
      <Mensaje>{error}</Mensaje>
      {cargando && !datos ? <Cargando /> : datos && (
        <>
          <div className="overflow-x-auto rounded-2xl border border-linea bg-white">
            <table className="tabla-apilada w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-linea text-tinta-tenue"><tr>
                <th className="px-4 py-3">Pedido</th><th className="px-4 py-3">Cliente</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3">Pago</th><th className="px-4 py-3">Entrega</th><th className="px-4 py-3 text-right">Total</th>
              </tr></thead>
              <tbody className="divide-y divide-linea">
                {datos.pedidos.map((p) => (
                  <tr key={p.numero} className="hover:bg-fondo-suave">
                    <td className="px-4 py-3"><Link href={`/pedidos/${p.numero}`} className="font-bold text-marca hover:underline">{p.numero}</Link><br /><span className="text-xs text-tinta-tenue">{fecha(p.creadoEn)}</span></td>
                    <td className="px-4 py-3">{p.nombre} {p.apellido}<br /><span className="text-xs text-tinta-tenue">{p.email}</span></td>
                    <td className="px-4 py-3" data-etiqueta="Estado"><Insignia clase={ESTADOS[p.estado]?.[1]}>{ESTADOS[p.estado]?.[0] ?? p.estado}</Insignia></td>
                    <td className="px-4 py-3" data-etiqueta="Pago">{MEDIOS[p.medioPago] ?? p.medioPago}</td>
                    <td className="px-4 py-3" data-etiqueta="Entrega">{p.entrega === "envio" ? "Envío" : "Retiro"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-bold" data-etiqueta="Total">{pesos(p.total)}</td>
                  </tr>
                ))}
                {!datos.pedidos.length && <tr><td colSpan={6} className="px-4 py-10 text-center text-tinta-tenue">No hay pedidos con ese filtro.</td></tr>}
              </tbody>
            </table>
          </div>
          <Paginador pagina={pagina} total={datos.total} porPagina={datos.porPagina} onCambiar={(n) => ir({ pagina: n })} />
        </>
      )}
    </>
  );
}

export default function Pagina() { return <Suspense fallback={<Cargando />}><Pedidos /></Suspense>; }
