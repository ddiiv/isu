"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { centavos, conDescuento, formatearPesos, NOMBRES_PROVINCIAS, PedidoNuevo, type ConfigPublica, type Cotizacion, type LugarDireccion, type MedioPago } from "@isu/shared";
import { itemDe, useCarrito } from "../carrito/Carrito";
import { Foto } from "../Foto";
import { CampoCupon, LineaCupon } from "../carrito/LineasCarrito";
import { api, guardarAcceso, type ErrorApi } from "@/lib/cliente-api";
import { evento, pesos } from "@/lib/ga";
import { OpcionesEnvio, type EleccionEnvio } from "./OpcionesEnvio";
import { AvisoDireccion, CampoCalle } from "./Direccion";

/*
 * Checkout en una sola página, como el de las tiendas de referencia:
 * contacto, entrega, envío y pago a la izquierda; el resumen (prendas,
 * packs, cupón y total) a la derecha, fijo. En el celular el resumen va
 * arriba, plegado, con el total a la vista.
 *
 * Cada forma de pago muestra cuánto sale con ella. El total lo calcula la
 * API con el medio y la entrega elegidos; al confirmar se vuelve a calcular
 * del lado del servidor. Del carrito se llega con el pago ya elegido
 * (/checkout?pago=transferencia).
 */
const MEDIOS: Array<{ id: MedioPago; titulo: string; detalle: (c: ConfigPublica) => string }> = [
  { id: "transferencia", titulo: "Transferencia bancaria", detalle: (c) => `${c.descuentoTransferencia}% OFF. Te damos los datos al confirmar y separamos tus prendas mientras transferís.` },
  { id: "mercadopago", titulo: "Mercado Pago", detalle: (c) => `Tarjeta de crédito o débito, dinero en cuenta. Hasta ${c.cuotasSinInteres} cuotas sin interés.` },
  { id: "pagofacil", titulo: "Pago Fácil / Rapipago", detalle: () => "Pagás en efectivo con el código que te da Mercado Pago. Tenés 3 días." },
  { id: "local", titulo: "Pagar al retirar en el local", detalle: () => "Efectivo, débito o transferencia al retirar. Te guardamos las prendas 3 días." },
];

type Campos = { [k: string]: string };
const campo = "w-full rounded-lg border border-linea bg-white px-3.5 py-3 text-base outline-none transition focus:border-tinta focus:ring-2 focus:ring-tinta/10 aria-[invalid=true]:border-oferta";

export function Checkout({ config }: { config: ConfigPublica }) {
  const router = useRouter();
  const { lineas, cotizacion, cotizar, vaciar, unidades, cupon, ponerCupon } = useCarrito();
  const locales = config.locales.filter((l) => l.retiro);
  const [c, setC] = useState<Campos>({ email: "", nombre: "", apellido: "", telefono: "", dni: "", calle: "", numero: "", piso: "", cp: "", localidad: "", provincia: "CABA", indicaciones: "", notas: "" });
  const [entrega, setEntrega] = useState<"envio" | "retiro">("envio");
  const [local, setLocal] = useState(locales[0]?.nombre ?? "");
  const disponibles = MEDIOS.filter((m) => config.mediosPago.includes(m.id));
  const [medio, setMedio] = useState<MedioPago>(disponibles[0]?.id ?? "local");
  const [acepta, setAcepta] = useState(false);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  // Etapa 4: la opción de envío (transporte + servicio), la sucursal y los avisos por WhatsApp.
  const [envio, setEnvio] = useState<EleccionEnvio>({ opcion: null, sucursal: null });
  const [recargarEnvio, setRecargarEnvio] = useState(0);
  const [avisosWhatsapp, setAvisosWhatsapp] = useState(true);
  const cambiar = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setC((x) => ({ ...x, [k]: e.target.value }));
  // Etapa 11: la sugerencia de Google elegida completa la dirección (lo que no trae queda como estaba).
  const elegirLugar = (l: LugarDireccion) => {
    setC((x) => ({ ...x, calle: l.calle || (x.calle ?? ""), numero: l.numero || (x.numero ?? ""), cp: l.cp || (x.cp ?? ""), localidad: l.localidad || (x.localidad ?? ""), provincia: l.provincia ?? x.provincia ?? "CABA" }));
    // Sin altura en la sugerencia (se eligió sólo la calle): el foco va al número.
    if (!l.numero) setTimeout(() => document.querySelector<HTMLInputElement>('input[name="numero"]')?.focus(), 0);
  };

  // Con sesión: los datos de la cuenta ya completos.
  useEffect(() => {
    api<{ cliente: { email: string; nombre: string; apellido: string | null; telefono: string | null; dni: string | null } } | undefined>("cuenta")
      .then((r) => { if (r) setC((x) => ({ ...x, email: r.cliente.email, nombre: r.cliente.nombre, apellido: r.cliente.apellido ?? "", telefono: r.cliente.telefono ?? "", dni: r.cliente.dni ?? "" })); })
      .catch(() => {});
    evento("begin_checkout", { currency: "ARS", value: pesos(lineas.reduce((a, l) => a + l.precio * l.cantidad, 0)) });
    // Del carrito: "Pagar con transferencia" o "Tarjeta o Mercado Pago".
    const pedido = new URLSearchParams(window.location.search).get("pago");
    if (pedido && disponibles.some((m) => m.id === pedido)) setMedio(pedido as MedioPago);
    // Dependencias a propósito: sólo al entrar
  }, []);
  useEffect(() => {
    if (medio === "local" && entrega !== "retiro") setMedio(disponibles.find((m) => m.id !== "local")?.id ?? "local");
  }, [entrega, medio, disponibles]);
  // Con errores de validación, el foco va al primer campo marcado (después de que se dibuja).
  useEffect(() => {
    if (Object.keys(errores).length) document.querySelector<HTMLElement>("[aria-invalid=true]")?.focus();
  }, [errores]);
  const opcionId = entrega === "envio" ? envio.opcion?.id ?? null : null;
  const destino = { cp: c.cp ?? "", provincia: c.provincia ?? "", localidad: c.localidad ?? "" };
  const datosEnvio = () => (opcionId ? { cp: destino.cp.trim(), provincia: destino.provincia, localidad: destino.localidad.trim(), opcion: opcionId } : undefined);
  // Dependencias a propósito: se recotiza al cambiar entrega, medio, cantidades o la opción de envío
  useEffect(() => { void cotizar({ entrega, medioPago: medio, envio: datosEnvio() }); }, [entrega, medio, unidades, opcionId]);
  const items = useMemo(() => lineas.map(itemDe), [lineas]);
  const [verResumen, setVerResumen] = useState(false);

  const cuerpo = useMemo(() => ({
    items: lineas.map(itemDe),
    contacto: { email: c.email, nombre: c.nombre, apellido: c.apellido, telefono: c.telefono, dni: c.dni },
    entrega: entrega === "envio"
      ? {
        tipo: "envio" as const, direccion: { calle: c.calle, numero: c.numero, piso: c.piso, cp: c.cp, localidad: c.localidad, provincia: c.provincia, indicaciones: c.indicaciones },
        ...(envio.opcion ? { opcion: envio.opcion.id } : {}), ...(envio.opcion?.requiereSucursal && envio.sucursal ? { sucursal: envio.sucursal } : {}),
      }
      : { tipo: "retiro" as const, local },
    medioPago: medio,
    ...(cupon ? { cupon } : {}),
    avisosWhatsapp: entrega === "envio" && avisosWhatsapp,
    ...((c.notas ?? "").trim() ? { notas: (c.notas ?? "").trim() } : {}),
    aceptaTerminos: acepta,
  }), [lineas, c, entrega, local, medio, acepta, envio, avisosWhatsapp, cupon]);

  async function confirmar(e: React.FormEvent) {
    e.preventDefault();
    setGeneral(null);
    const v = PedidoNuevo.safeParse(cuerpo);
    const m: Record<string, string> = {};
    if (!v.success) for (const i of v.error.issues) m[String(i.path.at(-1))] ??= i.message;
    if (entrega === "envio" && !envio.opcion) m.opcionEnvio = "Elegí cómo te lo mandamos.";
    else if (entrega === "envio" && envio.opcion?.requiereSucursal && !envio.sucursal) m.opcionEnvio = "Elegí la sucursal donde lo vas a retirar.";
    if (!v.success || Object.keys(m).length) { setErrores(m); return; }
    setErrores({});
    setEnviando(true);
    evento("add_payment_info", { currency: "ARS", value: pesos(cotizacion?.total ?? 0), payment_type: medio });
    try {
      const r = await api<{ numero: string; acceso: string; estado: string; redirigir: string | null }>("pedidos", { cuerpo: v.data });
      guardarAcceso(r.numero, r.acceso);
      vaciar();
      if (r.redirigir && /^https?:\/\//.test(r.redirigir)) window.location.assign(r.redirigir);
      else router.push(`/pedido/${r.numero}`);
    } catch (err) {
      const x = err as ErrorApi;
      setGeneral(x.message);
      if (x.codigo === "sin_stock" || x.codigo === "carrito_cambio") await cotizar({ entrega, medioPago: medio, envio: datosEnvio() });
      // El cupón dejó de servir (se agotó, ya lo usó…): se saca y se muestra el total sin él.
      if (x.codigo === "cupon") ponerCupon(null);
      // La opción de envío ya no está (cambió la tarifa o el horario): se vuelven a pedir.
      if (x.codigo === "envio_no_disponible") setRecargarEnvio((n) => n + 1);
      setEnviando(false);
    }
  }

  if (!lineas.length) {
    return (
      <div className="contenedor py-20 text-center">
        <h1 className="text-4xl">Tu carrito está vacío</h1>
        <Link href="/" className="boton-primario mt-6">Ver la tienda</Link>
      </div>
    );
  }
  const err = (k: string) => errores[k] ? <p id={`e-${k}`} className="mt-1 text-sm text-oferta">{errores[k]}</p> : null;
  const inp = (k: string, etiqueta: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block">
      <span className="mb-1 block text-sm font-bold">{etiqueta}</span>
      <input name={k} value={c[k]} onChange={cambiar(k)} aria-invalid={!!errores[k]} aria-describedby={errores[k] ? `e-${k}` : undefined} className={campo} {...props} />
      {err(k)}
    </label>
  );

  const titulo = "mb-3 text-xl font-bold font-sans";
  // Lo que sale con cada forma de pago (el envío aparte): transferencia con su %, el resto a precio de lista.
  const base = cotizacion ? Math.max(0, cotizacion.subtotal - (cotizacion.descuentoCupon ?? 0)) : null;
  const precioCon = (m: MedioPago) => (base === null ? null : m === "transferencia" ? conDescuento(centavos(base), config.descuentoTransferencia) : base);

  return (
    <form onSubmit={confirmar} noValidate className="lg:grid lg:min-h-[calc(100vh-5rem)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* Celular: el resumen arriba, plegado, con el total a la vista. */}
      <div className="border-b border-linea bg-fondo-suave lg:hidden">
        <button type="button" onClick={() => setVerResumen((v) => !v)} aria-expanded={verResumen} aria-controls="resumen-pedido"
          className="contenedor flex w-full items-center justify-between py-4 text-left">
          <span className="text-sm font-bold text-marca">{verResumen ? "Ocultar resumen del pedido" : "Mostrar resumen del pedido"} <span aria-hidden="true">{verResumen ? "▴" : "▾"}</span></span>
          <span className="font-display text-xl">{cotizacion ? formatearPesos(cotizacion.total) : "…"}</span>
        </button>
      </div>

      <div className="order-1 bg-white">
        <div className="mx-auto max-w-[36rem] space-y-9 px-4 py-8 sm:px-6 lg:ml-auto lg:mr-0 lg:px-12 lg:py-12">
          <div>
            <p className="text-sm text-tinta-tenue"><Link href="/carrito" className="underline">Carrito</Link> › <b className="text-tinta">Datos, envío y pago</b></p>
            <h1 className="mt-2 text-[clamp(2rem,5vw,2.8rem)] leading-none">Finalizar compra</h1>
          </div>

          <fieldset className="space-y-3">
            <legend className={titulo}>Contacto</legend>
            {inp("email", "Email", { type: "email", autoComplete: "email", inputMode: "email" })}
            <div className="grid gap-3 sm:grid-cols-2">
              {inp("nombre", "Nombre", { autoComplete: "given-name" })}
              {inp("apellido", "Apellido", { autoComplete: "family-name" })}
              {inp("telefono", "Celular", { type: "tel", autoComplete: "tel", placeholder: "11 5555-5555" })}
              {inp("dni", "DNI o CUIT", { inputMode: "numeric", autoComplete: "off" })}
            </div>
          </fieldset>

          <fieldset>
            <legend className={titulo}>Entrega</legend>
            <div className="divide-y divide-linea overflow-hidden rounded-xl border border-linea">
              {([["envio", "Envío", "A domicilio o a sucursal, a todo el país. En CABA puede llegar hoy."], ["retiro", "Retiro en el local", "Gratis. Te avisamos cuando esté listo."]] as const).map(([v, t, d]) => (
                <label key={v} className={`flex cursor-pointer items-start gap-3 p-4 ${entrega === v ? "bg-marca-claro/40" : ""}`}>
                  <input type="radio" name="entrega" value={v} checked={entrega === v} onChange={() => setEntrega(v)} className="mt-1 size-4 accent-tinta" />
                  <span><span className="block font-bold">{t}</span><span className="text-sm text-tinta-suave">{d}</span></span>
                </label>
              ))}
            </div>
            {entrega === "envio" ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-6">
                <div className="sm:col-span-4">
                  <CampoCalle valor={c.calle ?? ""} alCambiar={(v) => setC((x) => ({ ...x, calle: v }))} alElegir={elegirLugar}
                    activo={config.direcciones.sugerencias} error={errores.calle} clase={campo} />
                </div>
                <div className="sm:col-span-2">{inp("numero", "Número")}</div>
                {/* La revisión de Georef, pegada a calle y número (en el celular queda a la vista al escribir). */}
                <div className="sm:col-span-6 empty:hidden -mt-1">
                  <AvisoDireccion activo={config.direcciones.revisar} d={{ calle: c.calle ?? "", numero: c.numero ?? "", localidad: c.localidad ?? "", provincia: c.provincia ?? "" }}
                    alUsar={(s) => setC((x) => ({ ...x, calle: s.calle, numero: s.numero, localidad: s.localidad || (x.localidad ?? ""), provincia: s.provincia }))} />
                </div>
                <div className="sm:col-span-2">{inp("piso", "Piso / depto (opcional)", { autoComplete: "address-line2" })}</div>
                <div className="sm:col-span-2">{inp("cp", "Código postal", { autoComplete: "postal-code" })}</div>
                <div className="sm:col-span-2">{inp("localidad", "Localidad", { autoComplete: "address-level2" })}</div>
                <label className="block sm:col-span-3">
                  <span className="mb-1 block text-sm font-bold">Provincia</span>
                  <select value={c.provincia} onChange={cambiar("provincia")} className={campo} autoComplete="address-level1">{NOMBRES_PROVINCIAS.map((p) => <option key={p}>{p}</option>)}</select>
                </label>
                <div className="sm:col-span-3">{inp("indicaciones", "Indicaciones (opcional)", { placeholder: "Timbre, entre calles…" })}</div>
                <div className="sm:col-span-6">
                  <h3 className="mb-2 mt-4 text-lg font-bold font-sans">Métodos de envío</h3>
                  <OpcionesEnvio items={items} destino={destino} medioPago={medio} cupon={cupon}
                    valor={envio} alCambiar={setEnvio} error={errores.opcionEnvio} recargar={recargarEnvio} />
                </div>
                <label className="flex gap-2 text-sm sm:col-span-6">
                  <input type="checkbox" checked={avisosWhatsapp} onChange={(e) => setAvisosWhatsapp(e.target.checked)} className="mt-0.5 size-4 accent-tinta" />
                  <span>Avisame por WhatsApp cuando salga, cuando esté por llegar y cuando se entregue (al número de arriba).</span>
                </label>
              </div>
            ) : (
              <div className="mt-4 divide-y divide-linea overflow-hidden rounded-xl border border-linea" role="radiogroup" aria-label="Local de retiro">
                {locales.map((l) => (
                  <label key={l.nombre} className={`flex cursor-pointer gap-3 p-4 ${local === l.nombre ? "bg-marca-claro/40" : ""}`}>
                    <input type="radio" name="local" checked={local === l.nombre} onChange={() => setLocal(l.nombre)} className="mt-1 size-4 accent-tinta" />
                    <span><b>{l.nombre}</b><br /><span className="text-sm text-tinta-suave">{l.direccion}, {l.localidad} · {l.horario}</span></span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          <fieldset>
            <legend className={titulo}>Pago</legend>
            <p className="-mt-2 mb-3 text-sm text-tinta-suave">Todas las transacciones son seguras y están cifradas.</p>
            <div className="divide-y divide-linea overflow-hidden rounded-xl border border-linea">
              {disponibles.filter((m) => m.id !== "local" || entrega === "retiro").map((m) => {
                const precio = precioCon(m.id);
                return (
                  <div key={m.id}>
                    <label className={`flex cursor-pointer items-start gap-3 p-4 ${medio === m.id ? "bg-marca-claro/40" : ""}`}>
                      <input type="radio" name="medio" checked={medio === m.id} onChange={() => setMedio(m.id)} className="mt-1 size-4 accent-tinta" />
                      <span className="flex-1">
                        <b>{m.titulo}</b>{m.id === "transferencia" && config.descuentoTransferencia > 0 && <span className="ml-2 rounded-full bg-ahorro px-2 py-0.5 text-xs font-bold text-white">{config.descuentoTransferencia}% OFF</span>}
                      </span>
                      {precio !== null && <span className={`shrink-0 font-bold ${m.id === "transferencia" ? "text-ahorro" : ""}`}>{formatearPesos(precio)}</span>}
                    </label>
                    {medio === m.id && <p className="border-t border-linea bg-fondo-suave px-4 py-3 text-sm text-tinta-suave">{m.detalle(config)}</p>}
                  </div>
                );
              })}
            </div>
          </fieldset>

          <label className="block">
            <span className="mb-1 block text-sm font-bold">¿Algo que tengamos que saber? (opcional)</span>
            <textarea value={c.notas} onChange={cambiar("notas")} maxLength={500} rows={2} className={campo} />
          </label>

          <div>
            <label className="flex gap-2 text-sm">
              <input type="checkbox" checked={acepta} onChange={(e) => setAcepta(e.target.checked)} aria-invalid={!!errores.aceptaTerminos} className="mt-0.5 size-4 accent-tinta" />
              <span>Acepto los <Link href="/terminos" target="_blank" className="underline">términos y condiciones</Link> y la <Link href="/privacidad" target="_blank" className="underline">política de privacidad</Link>.</span>
            </label>
            {err("aceptaTerminos")}
            {cotizacion?.problemas.map((p) => <p key={p.mensaje} className="mt-3 text-sm font-bold text-oferta" role="alert">{p.mensaje}</p>)}
            {general && <p className="mt-4 rounded-xl bg-oferta/10 p-3 text-sm font-bold text-oferta" role="alert">{general}</p>}
            <button type="submit" disabled={enviando || !!cotizacion?.problemas.length} className="boton mt-5 w-full bg-tinta py-4 text-base text-white hover:bg-marca-fuerte disabled:cursor-not-allowed disabled:bg-linea disabled:text-tinta-tenue">
              {enviando ? "Confirmando…" : medio === "mercadopago" || medio === "pagofacil" ? "Ir a pagar" : "Confirmar compra"}
              {!enviando && cotizacion ? ` · ${formatearPesos(cotizacion.total)}` : ""}
            </button>
            <p className="mt-3 text-center text-xs text-tinta-tenue">Tus datos viajan cifrados. No guardamos datos de tarjetas: los maneja Mercado Pago.</p>
          </div>
        </div>
      </div>

      <aside id="resumen-pedido" aria-label="Resumen del pedido"
        className={`${verResumen ? "block" : "hidden"} order-2 border-linea bg-fondo-suave lg:order-2 lg:block lg:border-l`}>
        <div className="mx-auto max-w-[36rem] px-4 py-6 sm:px-6 lg:sticky lg:top-20 lg:mx-0 lg:px-12 lg:py-12">
          <ResumenPedido c={cotizacion} />
          <div className="mt-5"><CampoCupon /></div>
          {cotizacion && (
            <dl className="mt-5 space-y-1.5 text-[15px]">
              <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatearPesos(cotizacion.subtotal)}</dd></div>
              <LineaCupon c={cotizacion} Etiqueta="dt" />
              {cotizacion.descuento > 0 && <div className="flex justify-between text-ahorro"><dt>Descuento transferencia</dt><dd>−{formatearPesos(cotizacion.descuento)}</dd></div>}
              <div className="flex justify-between gap-3">
                <dt>Envío{entrega === "envio" && envio.opcion ? <span className="block text-xs text-tinta-suave">{envio.opcion.nombre}</span> : null}</dt>
                <dd className="shrink-0 text-right">{entrega === "retiro" ? "Gratis"
                  : !envio.opcion ? <span className="text-sm text-tinta-suave">Ingresá tu dirección</span>
                  : envio.opcion.soloMercadoPago ? <span className="text-sm">Se paga en Mercado Pago</span>
                  : cotizacion.envio ? formatearPesos(cotizacion.envio) : "Gratis"}</dd>
              </div>
              <div className="flex items-baseline justify-between pt-3 text-lg font-bold"><dt>Total</dt><dd><span className="mr-1.5 text-xs font-normal text-tinta-tenue">ARS</span><span className="font-display text-3xl">{formatearPesos(cotizacion.total)}</span></dd></div>
              {ahorro(cotizacion) > 0 && <p className="pt-1 text-sm font-bold text-ahorro">Ahorrás {formatearPesos(ahorro(cotizacion))}</p>}
            </dl>
          )}
        </div>
      </aside>
    </form>
  );
}

/** Lo que se ahorra entre rebajas, packs, cupón y transferencia. */
const ahorro = (c: Cotizacion) =>
  c.lineas.reduce((a, l) => a + (l.precioLista ? (l.precioLista - l.precio) * l.cantidad : 0), 0) + (c.descuentoCupon ?? 0) + c.descuento;

/* Las prendas del pedido con su foto y la cantidad encima; los packs con lo que llevan. */
function ResumenPedido({ c }: { c: Cotizacion | null }) {
  if (!c) return <p className="text-sm text-tinta-suave">Calculando…</p>;
  const miniatura = (foto: string | null, n: number, alt: string) => (
    <span className="relative block size-16 shrink-0">
      <span className="block size-16 overflow-hidden rounded-lg border border-linea bg-white">
        <Foto foto={foto ? { clave: foto, ancho: 400, alto: 500, alt: null } : null} alt={alt} sizes="64px" />
      </span>
      <span className="absolute -right-2 -top-2 grid min-w-5 place-items-center rounded-full bg-tinta-suave px-1.5 text-xs font-bold leading-5 text-white" aria-label={`${n} ${n === 1 ? "unidad" : "unidades"}`}>{n}</span>
    </span>
  );
  return (
    <ul className="space-y-4 text-sm" aria-label="Prendas del pedido">
      {c.lineas.filter((l) => !l.pack).map((l) => (
        <li key={l.clave} className="flex items-center gap-4">
          {miniatura(l.foto, l.cantidad, l.nombre)}
          <span className="min-w-0 flex-1"><span className="block font-bold">{l.nombre}</span><span className="text-tinta-suave">{[l.talle, l.color].filter(Boolean).join(" / ")}</span></span>
          <span className="shrink-0 text-right">{formatearPesos(l.subtotal)}{l.precioLista ? <s className="block text-xs text-tinta-tenue">{formatearPesos(l.precioLista * l.cantidad)}</s> : null}</span>
        </li>
      ))}
      {(c.packs ?? []).map((p) => (
        <li key={p.clave} className="flex items-start gap-4">
          {miniatura(p.foto, p.cantidad, `Pack x${p.unidades} ${p.nombre}`)}
          <span className="min-w-0 flex-1">
            <span className="block font-bold">Pack x{p.unidades} {p.nombre}</span>
            <span className="block text-xs font-bold text-ahorro">−{p.porcentaje}%</span>
            {p.prendas.map((x) => <span key={x.sku} className="block text-tinta-suave">{x.cantidad}× {[x.talle, x.color].filter(Boolean).join(" / ")}</span>)}
          </span>
          <span className="shrink-0 text-right">{formatearPesos(p.subtotal)}{p.precioLista > p.precio ? <s className="block text-xs text-tinta-tenue">{formatearPesos(p.precioLista * p.cantidad)}</s> : null}</span>
        </li>
      ))}
    </ul>
  );
}
