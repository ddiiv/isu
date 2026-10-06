"use client";
import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { formatearPesos, formatearPesosExactos } from "@isu/shared";
import { api, fecha, useDatos } from "@/lib/api";
import { Boton, Cargando, claseEntrada, Insignia, Mensaje, Paginador, Tarjeta, Titulo, useAviso } from "@/components/ui";
import { puede, useYo } from "@/components/Marco";

/*
 * Transferencias que entraron (Talo o la cuenta de Mercado Pago). Las que
 * coinciden con un pedido lo confirman solas; acá quedan las que no: el
 * cliente transfirió sin los centavos, de menos, o es plata que no es de
 * una compra. Se asignan a su pedido o se descartan.
 */
interface Recibida {
  id: number; via: "talo" | "mercadopago"; monto: number; pagador: string | null; pagadorCuit: string | null; recibidaEn: string;
  estado: "aplicada" | "sin_pedido" | "monto_distinto" | "descartada"; nota: string | null; resueltaPor: string | null; resueltaEn: string | null;
  pedido: string | null; totalPedido: number | null;
}
type Estado = { talo: { prendido: boolean; configurado: boolean }; mercadoPago: { prendido: boolean; configurado: boolean } };
const VIA: Record<Recibida["via"], string> = { talo: "Talo", mercadopago: "Mercado Pago" };
const ESTADO: Record<Recibida["estado"], [string, string]> = {
  aplicada: ["Asignada", "bg-ahorro-claro text-ahorro"],
  sin_pedido: ["Sin pedido", "bg-marca-claro text-marca-fuerte"],
  monto_distinto: ["Monto distinto", "bg-red-50 text-oferta"],
  descartada: ["Descartada", "bg-fondo-suave text-tinta-suave"],
};

function Transferencias() {
  const yo = useYo();
  const operador = puede(yo, "operador");
  const sp = useSearchParams();
  const router = useRouter();
  const estado = sp.get("estado") === "todas" ? "todas" : "por_resolver";
  const pagina = Number(sp.get("pagina") ?? 1) || 1;
  const { datos, error, recargar } = useDatos<{ transferencias: Recibida[]; total: number; porPagina: number; porResolver: number; estado: Estado }>("transferencias", { estado, pagina });
  const [asignando, setAsignando] = useState<{ id: number; pedido: string } | null>(null);
  const aviso = useAviso();
  const ir = (cambios: Record<string, string | null>) => {
    const u = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(cambios)) { if (v) u.set(k, v); else u.delete(k); }
    router.push(`/transferencias?${u}`);
  };

  async function asignar(t: Recibida, pedido: string) {
    try {
      await api(`transferencias/${t.id}/asignar`, { cuerpo: { pedido: pedido.trim() } });
      aviso.ok(`Asignada a ${pedido.trim().toUpperCase()}: el pedido quedó pagado y Stocker ya lo puede despachar.`);
      setAsignando(null); await recargar();
    } catch (e) { aviso.error(e); }
  }
  async function descartar(t: Recibida) {
    const nota = window.prompt("¿Por qué se descarta? (opcional: por ejemplo «no es de una compra»)");
    if (nota === null) return;
    try { await api(`transferencias/${t.id}/descartar`, { cuerpo: { nota: nota.trim() || null } }); aviso.ok("Descartada."); await recargar(); } catch (e) { aviso.error(e); }
  }

  if (error) return <Mensaje>{error}</Mensaje>;
  if (!datos) return <Cargando />;
  const { talo, mercadoPago } = datos.estado;
  const nada = !talo.prendido && !mercadoPago.prendido;
  return (
    <>
      <Titulo>Transferencias</Titulo>
      <p className="-mt-2 mb-4 max-w-3xl text-sm text-tinta-suave">
        Lo que entra por Talo o a la cuenta de Mercado Pago confirma solo su pedido. Acá quedan las que no se pudieron asignar solas:
        transfirieron sin los centavos, de menos, o es plata que no es de una compra.
      </p>
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <Insignia clase={talo.prendido && talo.configurado ? "bg-ahorro-claro text-ahorro" : "bg-fondo-suave text-tinta-suave"}>
          Talo: {talo.prendido ? (talo.configurado ? "prendido" : "prendido, sin credenciales") : "apagado"}
        </Insignia>
        <Insignia clase={mercadoPago.prendido && mercadoPago.configurado ? "bg-ahorro-claro text-ahorro" : "bg-fondo-suave text-tinta-suave"}>
          Mercado Pago: {mercadoPago.prendido ? (mercadoPago.configurado ? "prendido" : "prendido, sin credencial") : "apagado"}
        </Insignia>
        {nada && <span className="text-tinta-tenue">Se prenden en <Link href="/ajustes" className="text-marca hover:underline">Ajustes → Transferencias que se confirman solas</Link>.</span>}
      </div>
      <aviso.Aviso />
      <div className="mb-4 flex flex-wrap gap-2">
        {([["por_resolver", `Por resolver${datos.porResolver ? ` (${datos.porResolver})` : ""}`], ["todas", "Todas"]] as const).map(([k, t]) => (
          <button key={k} type="button" onClick={() => ir({ estado: k === "por_resolver" ? null : k, pagina: null })} aria-pressed={estado === k}
            className={`rounded-full px-4 py-1.5 text-sm font-bold ${estado === k ? "bg-tinta text-white" : "bg-fondo-suave hover:bg-linea"}`}>{t}</button>
        ))}
      </div>
      <ul className="space-y-3">
        {datos.transferencias.map((t) => {
          const [texto, clase] = ESTADO[t.estado];
          const abierta = t.estado === "sin_pedido" || t.estado === "monto_distinto";
          return (
            <li key={t.id}>
              <Tarjeta>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <b className="text-xl">{formatearPesosExactos(t.monto)}</b>
                  <Insignia clase={clase}>{texto}</Insignia>
                  <span className="text-sm text-tinta-tenue">{VIA[t.via]} · {fecha(t.recibidaEn)}</span>
                </div>
                <p className="mt-1 text-sm">
                  {t.pagador ? <>De <b>{t.pagador}</b></> : "Sin nombre de quien transfirió"}{t.pagadorCuit && ` · CUIT/CUIL ${t.pagadorCuit}`}
                  {t.pedido && <> · pedido <Link href={`/pedidos/${t.pedido}`} className="font-bold text-marca hover:underline">{t.pedido}</Link>{t.totalPedido !== null && ` (total ${formatearPesos(t.totalPedido)})`}</>}
                </p>
                {t.estado === "monto_distinto" && <p className="mt-1 text-sm text-oferta">Llegó un monto distinto del pedido: escribile al cliente o asignala si ya está todo.</p>}
                {t.nota && <p className="mt-1 text-sm text-tinta-suave">Nota: {t.nota}</p>}
                {t.resueltaPor && <p className="mt-1 text-xs text-tinta-tenue">Resuelta por {t.resueltaPor} el {fecha(t.resueltaEn)}</p>}
                {operador && abierta && (
                  asignando?.id === t.id ? (
                    <form className="mt-3 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void asignar(t, asignando.pedido); }}>
                      <input className={`${claseEntrada} w-44`} placeholder="ISU-1234" value={asignando.pedido} autoFocus
                        onChange={(e) => setAsignando({ id: t.id, pedido: e.target.value })} aria-label="Número de pedido" />
                      <Boton type="submit" disabled={!/^isu-\d{4,10}$/i.test(asignando.pedido.trim())}>Asignar y dar por pagado</Boton>
                      <Boton variante="borde" onClick={() => setAsignando(null)}>Cancelar</Boton>
                    </form>
                  ) : (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Boton onClick={() => setAsignando({ id: t.id, pedido: t.pedido ?? "" })}>Asignar a un pedido</Boton>
                      <Boton variante="borde" onClick={() => void descartar(t)}>Descartar</Boton>
                    </div>
                  )
                )}
              </Tarjeta>
            </li>
          );
        })}
        {!datos.transferencias.length && (
          <li className="rounded-2xl border border-dashed border-linea p-10 text-center text-tinta-tenue">
            {estado === "por_resolver" ? "No hay transferencias por resolver: todas se asignaron solas." : "Todavía no entró ninguna transferencia."}
          </li>
        )}
      </ul>
      <Paginador pagina={pagina} total={datos.total} porPagina={datos.porPagina} onCambiar={(p) => ir({ pagina: String(p) })} />
    </>
  );
}

export default function Pagina() { return <Suspense fallback={<Cargando />}><Transferencias /></Suspense>; }
