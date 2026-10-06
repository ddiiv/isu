"use client";
import Link from "next/link";
import { ESTADOS, fecha, pesos, useDatos } from "@/lib/api";
import { Cargando, Insignia, Mensaje, Tarjeta, Titulo } from "@/components/ui";

interface Resumen {
  pedidosHoy: number; ventasHoy: number; ventasMes: number; porEstado: Record<string, number>;
  catalogo: { publicados: number; sin_fotos: number; agotados: number };
  resenasPorModerar?: number;
  sincronizacion: Array<{ tipo: string; inicio: string; fin: string | null; error: string | null; cambios: number | null }>;
}

/* Lo primero que se ve: qué hay que hacer hoy. */
export default function Panel() {
  const { datos: r, error } = useDatos<Resumen>("resumen");
  if (error) return <Mensaje>{error}</Mensaje>;
  if (!r) return <Cargando />;
  const pendientes = ["transferencia_informada", "pagado", "listo_para_retirar", "pagado_tarde"];
  return (
    <>
      <Titulo>Panel</Titulo>
      <div className="grid gap-4 sm:grid-cols-3">
        {[["Pedidos de hoy", String(r.pedidosHoy)], ["Vendido hoy", pesos(r.ventasHoy)], ["Vendido este mes", pesos(r.ventasMes)]].map(([t, v]) => (
          <div key={t} className="rounded-2xl border border-linea bg-white p-5"><p className="text-sm text-tinta-tenue">{t}</p><p className="mt-1 font-display text-3xl">{v}</p></div>
        ))}
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Tarjeta titulo="Para atender">
          <ul className="divide-y divide-linea">
            {pendientes.map((e) => (
              <li key={e} className="flex items-center justify-between py-2.5">
                <Link href={`/pedidos?estado=${e}`} className="hover:underline"><Insignia clase={ESTADOS[e]?.[1]}>{ESTADOS[e]?.[0]}</Insignia></Link>
                <span className="font-bold">{r.porEstado[e] ?? 0}</span>
              </li>
            ))}
            {["esperando_pago", "esperando_transferencia", "a_pagar_en_local"].map((e) => (
              <li key={e} className="flex items-center justify-between py-2.5 text-tinta-suave">
                <Link href={`/pedidos?estado=${e}`} className="hover:underline">{ESTADOS[e]?.[0]}</Link><span>{r.porEstado[e] ?? 0}</span>
              </li>
            ))}
          </ul>
        </Tarjeta>
        <Tarjeta titulo="Catálogo">
          <ul className="divide-y divide-linea">
            <li className="flex justify-between py-2.5"><Link href="/productos?filtro=visibles" className="hover:underline">Publicados</Link><span className="font-bold">{r.catalogo.publicados}</span></li>
            <li className="flex justify-between py-2.5"><Link href="/productos?filtro=sin_fotos" className="hover:underline">Publicados sin fotos</Link><span className={`font-bold ${r.catalogo.sin_fotos ? "text-oferta" : ""}`}>{r.catalogo.sin_fotos}</span></li>
            <li className="flex justify-between py-2.5"><Link href="/productos?filtro=agotados" className="hover:underline">Agotados</Link><span className="font-bold">{r.catalogo.agotados}</span></li>
            <li className="flex justify-between py-2.5"><Link href="/resenas" className="hover:underline">Reseñas por revisar</Link><span className={`font-bold ${r.resenasPorModerar ? "text-marca" : ""}`}>{r.resenasPorModerar ?? 0}</span></li>
          </ul>
          <h3 className="mt-5 text-sm font-bold">Sincronización con Stocker</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {r.sincronizacion.map((s) => (
              <li key={s.tipo} className="flex flex-wrap justify-between gap-2">
                <span>{s.tipo === "catalogo" ? "Catálogo completo" : "Último aviso de stock"}: {fecha(s.inicio)}</span>
                {s.error ? <Insignia clase="bg-red-50 text-oferta">Error</Insignia> : s.fin ? <Insignia clase="bg-ahorro-claro text-ahorro">OK · {s.cambios ?? 0} cambios</Insignia> : <Insignia>En curso</Insignia>}
              </li>
            ))}
            {!r.sincronizacion.length && <li className="text-tinta-tenue">Todavía no hubo ninguna.</li>}
          </ul>
        </Tarjeta>
      </div>
    </>
  );
}
