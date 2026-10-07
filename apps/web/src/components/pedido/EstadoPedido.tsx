"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatearPesos, formatearPesosExactos, type PedidoPublico } from "@isu/shared";
import { api, guardarAcceso, leerAcceso, type ErrorApi } from "@/lib/cliente-api";
import { evento, pesos } from "@/lib/ga";
import { SeguimientoEnvio } from "./SeguimientoEnvio";

/*
 * El pedido y su pago. Mientras el pago está en camino (volviendo de Mercado
 * Pago, o con la transferencia informada) la pantalla dice "aguardá un
 * momento" y se actualiza sola: el cliente no tiene que recargar ni escribir
 * por WhatsApp para saber si le llegó.
 */
const TEXTO: Record<string, [string, string]> = {
  esperando_pago: ["Falta el pago", "Tus prendas están separadas. Terminá el pago para confirmar la compra."],
  esperando_transferencia: ["Esperamos tu transferencia", "Tus prendas están separadas. Transferí y subí el comprobante."],
  transferencia_informada: ["Aguardá un momento…", "Estamos verificando tu transferencia. Esta pantalla se actualiza sola cuando se acredite."],
  a_pagar_en_local: ["Te esperamos en el local", "Tus prendas están separadas. Las pagás al retirarlas."],
  pagado: ["¡Pago confirmado!", "Gracias por tu compra. Te avisamos por mail cada novedad."],
  pagado_tarde: ["Recibimos tu pago", "Llegó después del vencimiento: te escribimos para confirmar el stock o devolverte el dinero."],
  vencido: ["El pedido venció", "No recibimos el pago a tiempo y liberamos las prendas. Si ya pagaste, escribinos con el comprobante."],
  cancelado: ["Pedido cancelado", "Si pagaste, te devolvemos el dinero por el mismo medio."],
  sin_stock: ["No pudimos confirmar el pedido", "Justo se vendió algo de tu carrito. No se te cobró nada."],
  listo_para_retirar: ["¡Listo para retirar!", "Ya podés pasar a buscarlo por el local."],
  retirado: ["Pedido retirado", "¡Gracias por tu compra!"],
  enviado: ["¡Tu pedido está en camino!", "Te avisamos cuando esté por llegar. Abajo ves cómo viene."],
  entregado: ["Pedido entregado", "¡Esperamos que te encante! Si algo no te queda bien, escribinos."],
};
const PENDIENTE_DE_CONFIRMAR = new Set(["esperando_pago", "transferencia_informada", "esperando_transferencia"]);

function Copiar({ valor }: { valor: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" onClick={() => { void navigator.clipboard?.writeText(valor); setOk(true); setTimeout(() => setOk(false), 1500); }}
      className="rounded-full border border-linea px-3 py-1 text-xs font-bold hover:border-tinta">{ok ? "¡Copiado!" : "Copiar"}</button>
  );
}

export function EstadoPedido({ numero, whatsapp }: { numero: string; whatsapp: string }) {
  const [p, setP] = useState<PedidoPublico | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [volviendoDeMp, setVolviendoDeMp] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const acceso = useRef<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const x = await api<PedidoPublico>(`pedidos/${numero}`, { acceso: acceso.current });
      setP(x); setError(null);
      if (x.estado === "pagado") {
        // purchase una sola vez por pedido y navegador.
        try {
          if (!localStorage.getItem(`isu:ga:${numero}`)) {
            evento("purchase", { transaction_id: numero, currency: "ARS", value: pesos(x.total), shipping: pesos(x.envio), items: x.items.map((i) => ({ item_id: i.sku, item_name: i.nombre, price: pesos(i.precio), quantity: i.cantidad })) });
            localStorage.setItem(`isu:ga:${numero}`, "1");
          }
        } catch { /* */ }
      }
    } catch (e) {
      setError((e as ErrorApi).status === 404 ? "No encontramos ese pedido en este navegador. Abrilo desde el enlace del mail o ingresá a tu cuenta." : (e as Error).message);
    }
  }, [numero]);

  useEffect(() => {
    // El enlace del mail trae el acceso en el fragmento (#c=…): se guarda y se saca de la barra.
    const m = window.location.hash.match(/c=([A-Za-z0-9_-]{30,40})/);
    if (m) { guardarAcceso(numero, m[1]!); history.replaceState(null, "", window.location.pathname + window.location.search); }
    acceso.current = m?.[1] ?? leerAcceso(numero);
    const q = new URLSearchParams(window.location.search);
    setVolviendoDeMp(q.has("payment_id") || q.has("collection_status") || q.has("status"));
    void cargar();
  }, [numero, cargar]);

  // Mientras falta confirmar el pago, se consulta sola cada tanto.
  useEffect(() => {
    if (!p || !PENDIENTE_DE_CONFIRMAR.has(p.estado)) return;
    const cada = p.estado === "esperando_pago" && volviendoDeMp ? 4000 : 10_000;
    const t = setInterval(() => { if (document.visibilityState === "visible") void cargar(); }, cada);
    return () => clearInterval(t);
  }, [p, volviendoDeMp, cargar]);

  async function pagar() {
    setAviso(null);
    try {
      const { url } = await api<{ url: string }>(`pedidos/${numero}/pagar`, { cuerpo: {}, acceso: acceso.current });
      if (/^https?:\/\//.test(url)) window.location.assign(url);
    } catch (e) { setAviso((e as Error).message); }
  }

  async function subir(archivo: File | undefined) {
    if (!archivo) return;
    if (archivo.size > 6 * 1024 * 1024) { setAviso("El archivo pesa más de 6 MB."); return; }
    setSubiendo(true); setAviso(null);
    try {
      await api(`pedidos/${numero}/comprobante`, { metodo: "POST", archivo, acceso: acceso.current });
      setAviso("¡Listo! Recibimos el comprobante.");
      await cargar();
    } catch (e) { setAviso((e as Error).message); } finally { setSubiendo(false); }
  }

  if (error) {
    return (
      <div className="contenedor py-20 text-center">
        <h1 className="text-4xl">Pedido {numero}</h1>
        <p className="mx-auto mt-4 max-w-md text-tinta-suave">{error}</p>
        <div className="mt-6 flex justify-center gap-3"><Link href="/cuenta" className="boton-primario">Ingresar</Link><Link href="/" className="boton-borde">Ir a la tienda</Link></div>
      </div>
    );
  }
  if (!p) return <div className="contenedor py-24 text-center text-tinta-tenue" aria-busy="true">Cargando tu pedido…</div>;

  const esperandoMp = p.estado === "esperando_pago" && volviendoDeMp;
  const t = p.pago.transferencia;
  const [titulo, bajada] = esperandoMp ? ["Aguardá un momento…", "Estamos confirmando tu pago con Mercado Pago. Esta pantalla se actualiza sola."]
    : p.estado === "esperando_transferencia" && t?.automatica ? ["Esperamos tu transferencia", "Tus prendas están separadas. Transferí el monto exacto: cuando llegue, esta pantalla se actualiza sola."]
      : (TEXTO[p.estado] ?? [p.estado, ""]);
  const girando = esperandoMp || p.estado === "transferencia_informada";
  const vence = p.venceEn ? new Date(p.venceEn).toLocaleString("es-AR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : null;

  return (
    <div className="contenedor grid gap-10 py-10 lg:grid-cols-[1fr_380px]">
      <section aria-live="polite">
        <p className="text-sm text-tinta-tenue">Pedido {p.numero}</p>
        <h1 className="mt-1 flex items-center gap-3 text-[clamp(2rem,5vw,3.2rem)] leading-tight">
          {girando && <span className="inline-block size-7 shrink-0 animate-spin rounded-full border-4 border-marca-claro border-t-marca" aria-hidden="true" />}
          {p.estado === "pagado" && <span className="grid size-10 shrink-0 place-items-center rounded-full bg-ahorro text-xl text-white" aria-hidden="true">✓</span>}
          {titulo}
        </h1>
        <p className="mt-3 text-lg text-tinta-suave">{bajada}</p>
        {vence && ["esperando_pago", "esperando_transferencia", "a_pagar_en_local"].includes(p.estado) && (
          <p className="mt-2 text-sm">Te las guardamos hasta el <b>{vence}</b>.</p>
        )}

        {p.estado === "esperando_pago" && (
          <button type="button" onClick={pagar} className="boton mt-6 bg-tinta px-8 py-4 text-base text-white hover:bg-marca-fuerte">
            {p.medioPago === "pagofacil" ? "Obtener el código para pagar en efectivo" : volviendoDeMp ? "Volver a intentar el pago" : "Pagar con Mercado Pago"}
          </button>
        )}

        {t && (
          <div className="mt-6 rounded-[var(--radius-foto)] bg-ahorro-claro p-5">
            <p className="flex flex-wrap items-center gap-2 text-lg">
              Transferí <b className="text-ahorro">{formatearPesosExactos(t.monto)}</b>
              <Copiar valor={(t.monto / 100).toFixed(2).replace(".", ",")} />
            </p>
            {t.via === "mercadopago" && (
              <p className="mt-2 text-[15px]"><b>Con los centavos, el monto exacto:</b> así reconocemos tu pago y se confirma solo.</p>
            )}
            {t.via === "talo" && (
              <p className="mt-2 text-[15px]">Esta cuenta es <b>sólo para tu pedido</b>. Transferí desde tu banco o billetera y se confirma solo.</p>
            )}
            <dl className="mt-3 space-y-2 text-[15px]">
              {([["Titular", t.titular], ["CUIT", t.cuit], ["Banco", t.banco], [t.via === "talo" ? "CVU" : "CBU / CVU", t.cbu], ["Alias", t.alias]] as const).filter(([, v]) => v).map(([k, v]) => (
                <div key={k} className="flex flex-wrap items-center justify-between gap-2"><dt className="text-tinta-suave">{k}</dt><dd className="flex items-center gap-2 font-bold break-all">{v}{(k !== "Titular" && k !== "Banco") && <Copiar valor={v} />}</dd></div>
              ))}
            </dl>
            {t.automatica ? (
              <details className="mt-4 text-sm">
                <summary className="cursor-pointer text-tinta-suave underline">¿Pasaron más de 15 minutos y no se confirmó?</summary>
                <p className="mt-2 text-tinta-suave">Subí el comprobante o mandalo por <a className="underline" href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(`Hola! Te mando el comprobante del pedido ${p.numero}`)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a> y lo revisamos.</p>
                <label className="boton-borde mt-3 cursor-pointer">
                  {subiendo ? "Subiendo…" : p.pago.comprobanteSubido ? "Subir otro comprobante" : "Subir el comprobante"}
                  <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" className="sr-only" disabled={subiendo} onChange={(e) => subir(e.target.files?.[0])} />
                </label>
              </details>
            ) : (
              <>
                <label className="boton mt-5 cursor-pointer bg-tinta text-white hover:bg-marca-fuerte">
                  {subiendo ? "Subiendo…" : p.pago.comprobanteSubido ? "Subir otro comprobante" : "Subir el comprobante"}
                  <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" className="sr-only" disabled={subiendo} onChange={(e) => subir(e.target.files?.[0])} />
                </label>
                <p className="mt-2 text-xs text-tinta-suave">Foto o PDF, hasta 6 MB. También podés mandarlo por <a className="underline" href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(`Hola! Te mando el comprobante del pedido ${p.numero}`)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>.</p>
              </>
            )}
          </div>
        )}
        {aviso && <p className="mt-4 text-sm font-bold" role="status">{aviso}</p>}

        {p.estado === "a_pagar_en_local" && p.local && <p className="mt-6 rounded-2xl bg-marca-claro p-4">Retirás en <b>{p.local}</b>. Llevá tu DNI y el número de pedido.{p.localEnlace && <> <a href={p.localEnlace} target="_blank" rel="noopener noreferrer" className="font-bold text-marca underline">Cómo llegar ↗</a></>}</p>}
        {p.estado === "listo_para_retirar" && p.local && p.localEnlace && <p className="mt-6 rounded-2xl bg-marca-claro p-4">Te esperamos en <b>{p.local}</b>. <a href={p.localEnlace} target="_blank" rel="noopener noreferrer" className="font-bold text-marca underline">Cómo llegar ↗</a></p>}
        {p.envioDetalle && ["pagado", "enviado", "entregado"].includes(p.estado) && <SeguimientoEnvio envio={p.envioDetalle} />}
        {/* Etapa 8: ya le llegó → que nos cuente cómo le quedó. */}
        {p.opinar && (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-marca-claro p-4">
            <p><b>¿Qué te pareció?</b> Contanos cómo te quedó: ayuda a otras personas a elegir su talle.</p>
            <Link href={`/opinar/${encodeURIComponent(p.numero)}?t=${encodeURIComponent(p.opinar)}`} className="boton-marca shrink-0">Opinar ★</Link>
          </div>
        )}
        {["pagado", "vencido", "cancelado", "sin_stock", "enviado", "entregado", "retirado"].includes(p.estado) && <Link href="/" className="boton-borde mt-6">Seguir comprando</Link>}
      </section>

      <aside className="self-start rounded-[var(--radius-foto)] border border-linea p-5">
        <h2 className="text-2xl">Tu compra</h2>
        <ul className="mt-4 space-y-2 text-sm">
          {p.items.map((i) => <li key={i.sku} className="flex justify-between gap-3"><span>{i.cantidad} × {i.nombre}{i.color ? ` · ${i.color}` : ""}{i.talle ? ` · ${i.talle}` : ""}</span><span className="shrink-0">{formatearPesos(i.precio * i.cantidad)}</span></li>)}
        </ul>
        <dl className="mt-4 space-y-1 border-t border-linea pt-4 text-[15px]">
          {p.cupon && (
            <div className="flex justify-between gap-3 text-ahorro">
              <dt>{p.cupon.codigo ? <>Cupón <b>{p.cupon.codigo}</b></> : <>Promo: {p.cupon.nombre}</>}</dt>
              <dd className="shrink-0">{p.descuentoCupon ? `−${formatearPesos(p.descuentoCupon)}` : "Envío gratis"}</dd>
            </div>
          )}
          {p.descuento > 0 && <div className="flex justify-between text-ahorro"><dt>Descuento{p.medioPago === "transferencia" ? " transferencia" : ""}</dt><dd>−{formatearPesos(p.descuento)}</dd></div>}
          <div className="flex justify-between gap-3">
            <dt>{p.entrega === "retiro" ? "Retiro en el local" : "Envío"}{p.envioDetalle && <span className="block text-xs text-tinta-suave">{p.envioDetalle.nombreTransporte}</span>}</dt>
            <dd className="shrink-0 text-right">{p.envioDetalle?.transporte === "mercado_envios" ? <span className="text-sm">Pagado en Mercado Pago</span> : p.envio ? formatearPesos(p.envio) : "Gratis"}</dd>
          </div>
          <div className="flex justify-between pt-1 font-display text-2xl"><dt>Total</dt><dd>{formatearPesos(p.total)}</dd></div>
        </dl>
        <p className="mt-4 text-sm text-tinta-suave">{p.entrega === "envio" && p.direccion ? `${p.direccion.calle} ${p.direccion.numero}${p.direccion.piso ? `, ${p.direccion.piso}` : ""} · ${p.direccion.localidad}, ${p.direccion.provincia}` : p.localEnlace
          ? <a href={p.localEnlace} target="_blank" rel="noopener noreferrer" className="underline hover:text-marca">{p.local}</a> : p.local}</p>
        <p className="mt-4 text-xs text-tinta-tenue">¿Te arrepentiste? Podés cancelar desde el <Link href="/arrepentimiento" className="underline">botón de arrepentimiento</Link>.</p>
      </aside>
    </div>
  );
}
