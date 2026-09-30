"use client";
import Link from "next/link";
import { use, useState } from "react";
import { api, ESTADOS, fecha, MEDIOS, pesos, useDatos } from "@/lib/api";
import { Boton, Campo, Cargando, claseEntrada, EntradaPesos, Insignia, Mensaje, Tarjeta, Titulo, useAviso } from "@/components/ui";
import { puede, useYo } from "@/components/Marco";

interface Detalle {
  pedido: Record<string, unknown> & {
    numero: string; estado: string; medio_pago: string; entrega: string; total: number; subtotal: number; descuento: number; envio: number;
    nombre: string; apellido: string; email: string; telefono: string; dni: string; direccion: Record<string, string> | null; local_retiro: string | null;
    notas: string | null; notas_internas: string | null; creado_en: string; vence_en: string | null; pagado_en: string | null;
  };
  items: Array<{ sku: string; nombre: string; color: string | null; talle: string | null; precio: number; precioLista: number | null; cantidad: number }>;
  pagos: Array<{ proveedor: string; externo: string; estado: string; monto: number; registradoPor: string | null; creadoEn: string }>;
  eventos: Array<{ estado: string; detalle: string | null; actor: string; creadoEn: string }>;
  comprobantes: Array<{ id: number; tipo: string; bytes: number; creadoEn: string }>;
}
const PENDIENTES = ["esperando_pago", "esperando_transferencia", "transferencia_informada", "a_pagar_en_local"];

export default function Pedido({ params }: { params: Promise<{ numero: string }> }) {
  const { numero } = use(params);
  const yo = useYo();
  const { datos: d, error, recargar } = useDatos<Detalle>(`pedidos/${numero}`);
  const aviso = useAviso();
  const [pago, setPago] = useState<{ monto: number | null; referencia: string } | null>(null);
  const [motivo, setMotivo] = useState("");
  const [cancelando, setCancelando] = useState(false);
  const [notas, setNotas] = useState<string | null>(null);
  const operador = puede(yo, "operador");

  if (error) return <Mensaje>{error}</Mensaje>;
  if (!d) return <Cargando />;
  const p = d.pedido;
  const accion = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); aviso.ok(ok); await recargar(); } catch (e) { aviso.error(e); }
  };
  const medioPago = p.medio_pago === "local" ? "local" : "transferencia";
  const entregas: Array<[string, string]> = p.estado === "pagado"
    ? (p.entrega === "retiro" ? [["listo_para_retirar", "Listo para retirar"], ["retirado", "Retirado"]] : [["enviado", "Marcar enviado"]])
    : p.estado === "listo_para_retirar" ? [["retirado", "Retirado"]] : p.estado === "enviado" ? [["entregado", "Entregado"]] : [];

  return (
    <>
      <p className="mb-2 text-sm"><Link href="/pedidos" className="text-marca hover:underline">← Pedidos</Link></p>
      <Titulo acciones={<Insignia clase={ESTADOS[p.estado]?.[1]}>{ESTADOS[p.estado]?.[0] ?? p.estado}</Insignia>}>{p.numero}</Titulo>
      <div className="mb-4"><aviso.Aviso /></div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Tarjeta titulo="Artículos">
            <ul className="divide-y divide-linea text-sm">
              {d.items.map((i) => (
                <li key={i.sku} className="flex justify-between gap-3 py-2.5">
                  <span><span className="font-bold">{i.cantidad} ×</span> {i.nombre}<span className="text-tinta-tenue">{[i.color, i.talle].filter(Boolean).map((x) => ` · ${x}`).join("")}</span><br /><span className="text-xs text-tinta-tenue">{i.sku}</span></span>
                  <span className="text-right">{i.precioLista && i.precioLista > i.precio && <s className="mr-1 text-xs text-tinta-tenue">{pesos(i.precioLista)}</s>}{pesos(i.precio * i.cantidad)}</span>
                </li>
              ))}
            </ul>
            <dl className="mt-3 space-y-1 border-t border-linea pt-3 text-sm">
              <div className="flex justify-between"><dt>Subtotal</dt><dd>{pesos(p.subtotal)}</dd></div>
              {p.descuento > 0 && <div className="flex justify-between text-ahorro"><dt>Descuento</dt><dd>−{pesos(p.descuento)}</dd></div>}
              <div className="flex justify-between"><dt>Envío</dt><dd>{p.envio ? pesos(p.envio) : "Gratis"}</dd></div>
              <div className="flex justify-between text-base font-bold"><dt>Total</dt><dd>{pesos(p.total)}</dd></div>
            </dl>
          </Tarjeta>
          <Tarjeta titulo="Historial">
            <ol className="space-y-2 text-sm">
              {d.eventos.map((e, i) => (
                <li key={i} className="flex flex-wrap gap-x-3"><span className="text-tinta-tenue">{fecha(e.creadoEn)}</span><span className="font-bold">{ESTADOS[e.estado]?.[0] ?? e.estado}</span><span className="text-tinta-suave">{e.detalle}</span><span className="text-xs text-tinta-tenue">({e.actor})</span></li>
              ))}
            </ol>
          </Tarjeta>
          {(d.pagos.length > 0 || d.comprobantes.length > 0) && (
            <Tarjeta titulo="Pagos y comprobantes">
              <ul className="space-y-1.5 text-sm">
                {d.pagos.map((x) => <li key={x.proveedor + x.externo}>{MEDIOS[x.proveedor] ?? x.proveedor} · {x.externo} · <span className="font-bold">{pesos(x.monto)}</span> · {x.estado} <span className="text-xs text-tinta-tenue">{fecha(x.creadoEn)} {x.registradoPor ? `· ${x.registradoPor}` : ""}</span></li>)}
              </ul>
              {d.comprobantes.length > 0 && (
                <ul className="mt-3 space-y-1 text-sm">
                  {d.comprobantes.map((c) => <li key={c.id}><a className="font-bold text-marca hover:underline" href={`/api/a/pedidos/${p.numero}/comprobantes/${c.id}`} download>Descargar comprobante ({c.tipo === "application/pdf" ? "PDF" : "imagen"}, {Math.ceil(c.bytes / 1024)} KB)</a> <span className="text-xs text-tinta-tenue">{fecha(c.creadoEn)}</span></li>)}
                </ul>
              )}
            </Tarjeta>
          )}
        </div>

        <div className="space-y-6">
          <Tarjeta titulo="Cliente">
            <p className="font-bold">{p.nombre} {p.apellido}</p>
            <p className="text-sm">{p.email}<br />{p.telefono} · DNI {p.dni}</p>
            <p className="mt-3 text-sm"><span className="font-bold">{p.entrega === "envio" ? "Envío a:" : "Retira en:"}</span><br />
              {p.entrega === "envio" && p.direccion ? `${p.direccion.calle} ${p.direccion.numero}${p.direccion.piso ? ` ${p.direccion.piso}` : ""}, ${p.direccion.localidad}, ${p.direccion.provincia} (${p.direccion.cp})` : p.local_retiro}</p>
            {p.entrega === "envio" && p.direccion?.indicaciones && <p className="text-sm text-tinta-suave">{p.direccion.indicaciones}</p>}
            {p.notas && <p className="mt-3 rounded-xl bg-fondo-suave p-3 text-sm">“{p.notas}”</p>}
            <p className="mt-3 text-xs text-tinta-tenue">Pago: {MEDIOS[p.medio_pago]} · Creado {fecha(p.creado_en)}{p.vence_en && PENDIENTES.includes(p.estado) ? ` · Vence ${fecha(p.vence_en)}` : ""}</p>
          </Tarjeta>

          {operador && PENDIENTES.includes(p.estado) && p.medio_pago !== "mercadopago" && p.medio_pago !== "pagofacil" && (
            <Tarjeta titulo={p.medio_pago === "local" ? "Registrar cobro en el local" : "Registrar transferencia"}>
              {!pago ? <Boton onClick={() => setPago({ monto: p.total, referencia: "" })}>Registrar pago</Boton> : (
                <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void accion(() => api(`pedidos/${p.numero}/pago`, { cuerpo: { medio: medioPago, monto: pago.monto, referencia: pago.referencia } }), "Pago registrado. Stocker ya lo deja despachar."); setPago(null); }}>
                  <Campo etiqueta="Monto recibido"><EntradaPesos valor={pago.monto} onChange={(m) => setPago({ ...pago, monto: m })} /></Campo>
                  <Campo etiqueta={p.medio_pago === "local" ? "Referencia (ticket, caja…)" : "Número de operación"}><input required minLength={3} className={claseEntrada} value={pago.referencia} onChange={(e) => setPago({ ...pago, referencia: e.target.value })} /></Campo>
                  <div className="flex gap-2"><Boton type="submit">Confirmar</Boton><Boton variante="borde" onClick={() => setPago(null)}>Cancelar</Boton></div>
                </form>
              )}
            </Tarjeta>
          )}

          {operador && entregas.length > 0 && (
            <Tarjeta titulo="Entrega">
              <div className="flex flex-wrap gap-2">
                {entregas.map(([e, t]) => <Boton key={e} variante="borde" onClick={() => void accion(() => api(`pedidos/${p.numero}/entrega`, { cuerpo: { estado: e } }), "Estado actualizado.")}>{t}</Boton>)}
              </div>
              <p className="mt-2 text-xs text-tinta-tenue">En la etapa 4 esto lo hacen solos los correos.</p>
            </Tarjeta>
          )}

          <Tarjeta titulo="Notas internas">
            <textarea className={`${claseEntrada} min-h-24`} maxLength={1000} disabled={!operador} value={notas ?? p.notas_internas ?? ""} onChange={(e) => setNotas(e.target.value)} placeholder="Sólo las ve el equipo." />
            {operador && notas !== null && <Boton className="mt-2" onClick={() => void accion(() => api(`pedidos/${p.numero}/notas`, { cuerpo: { notas } }), "Notas guardadas.").then(() => setNotas(null))}>Guardar notas</Boton>}
          </Tarjeta>

          {operador && (PENDIENTES.includes(p.estado) || p.estado === "pagado") && (
            <Tarjeta titulo="Cancelar pedido">
              {!cancelando ? <Boton variante="peligro" onClick={() => setCancelando(true)}>Cancelar pedido…</Boton> : (
                <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void accion(async () => { const r = await api<{ reembolsar: boolean }>(`pedidos/${p.numero}/cancelar`, { cuerpo: { motivo } }); if (r.reembolsar) alert("Cancelado. Acordate de devolverle el dinero al cliente."); }, "Pedido cancelado y mercadería devuelta al stock."); setCancelando(false); }}>
                  <Campo etiqueta="Motivo" ayuda="Queda en el historial del pedido."><input required minLength={3} maxLength={300} className={claseEntrada} value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Campo>
                  {p.estado === "pagado" && <Mensaje tipo="info">Está pagado: sólo se puede cancelar si todavía no salió del depósito, y hay que devolver el dinero.</Mensaje>}
                  <div className="flex gap-2"><Boton type="submit" variante="peligro">Confirmar cancelación</Boton><Boton variante="borde" onClick={() => setCancelando(false)}>Volver</Boton></div>
                </form>
              )}
            </Tarjeta>
          )}
        </div>
      </div>
    </>
  );
}
