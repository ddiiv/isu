"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { formatearPesos, PedidoNuevo, type ConfigPublica, type MedioPago } from "@isu/shared";
import { useCarrito } from "../carrito/Carrito";
import { api, guardarAcceso, type ErrorApi } from "@/lib/cliente-api";
import { evento, pesos } from "@/lib/ga";

/*
 * Checkout en una sola página: contacto, entrega, pago y resumen. El total
 * que se ve lo calcula la API con el medio y la entrega elegidos; al
 * confirmar se vuelve a calcular del lado del servidor.
 */
const MEDIOS: Array<{ id: MedioPago; titulo: string; detalle: (c: ConfigPublica) => string }> = [
  { id: "transferencia", titulo: "Transferencia bancaria", detalle: (c) => `${c.descuentoTransferencia}% OFF. Te damos los datos al confirmar y separamos tus prendas mientras transferís.` },
  { id: "mercadopago", titulo: "Mercado Pago", detalle: (c) => `Tarjeta de crédito o débito, dinero en cuenta. Hasta ${c.cuotasSinInteres} cuotas sin interés.` },
  { id: "pagofacil", titulo: "Pago Fácil / Rapipago", detalle: () => "Pagás en efectivo con el código que te da Mercado Pago. Tenés 3 días." },
  { id: "local", titulo: "Pagar al retirar en el local", detalle: () => "Efectivo, débito o transferencia al retirar. Te guardamos las prendas 3 días." },
];
const PROVINCIAS = ["CABA", "Buenos Aires", "Catamarca", "Chaco", "Chubut", "Córdoba", "Corrientes", "Entre Ríos", "Formosa", "Jujuy", "La Pampa", "La Rioja", "Mendoza", "Misiones", "Neuquén", "Río Negro", "Salta", "San Juan", "San Luis", "Santa Cruz", "Santa Fe", "Santiago del Estero", "Tierra del Fuego", "Tucumán"];

type Campos = { [k: string]: string };
const campo = "w-full rounded-xl border border-linea bg-white px-4 py-3 text-base outline-none focus:border-tinta aria-[invalid=true]:border-oferta";

export function Checkout({ config }: { config: ConfigPublica }) {
  const router = useRouter();
  const { lineas, cotizacion, cotizar, vaciar, unidades } = useCarrito();
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
  const cambiar = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setC((x) => ({ ...x, [k]: e.target.value }));

  // Con sesión: los datos de la cuenta ya completos.
  useEffect(() => {
    api<{ cliente: { email: string; nombre: string; apellido: string | null; telefono: string | null; dni: string | null } } | undefined>("cuenta")
      .then((r) => { if (r) setC((x) => ({ ...x, email: r.cliente.email, nombre: r.cliente.nombre, apellido: r.cliente.apellido ?? "", telefono: r.cliente.telefono ?? "", dni: r.cliente.dni ?? "" })); })
      .catch(() => {});
    evento("begin_checkout", { currency: "ARS", value: pesos(lineas.reduce((a, l) => a + l.precio * l.cantidad, 0)) });
    // Dependencias a propósito: sólo al entrar
  }, []);
  useEffect(() => {
    if (medio === "local" && entrega !== "retiro") setMedio(disponibles.find((m) => m.id !== "local")?.id ?? "local");
  }, [entrega, medio, disponibles]);
  // Con errores de validación, el foco va al primer campo marcado (después de que se dibuja).
  useEffect(() => {
    if (Object.keys(errores).length) document.querySelector<HTMLElement>("[aria-invalid=true]")?.focus();
  }, [errores]);
  // Dependencias a propósito: se recotiza al cambiar entrega, medio o cantidades
  useEffect(() => { void cotizar({ entrega, medioPago: medio }); }, [entrega, medio, unidades]);

  const cuerpo = useMemo(() => ({
    items: lineas.map(({ sku, cantidad }) => ({ sku, cantidad })),
    contacto: { email: c.email, nombre: c.nombre, apellido: c.apellido, telefono: c.telefono, dni: c.dni },
    entrega: entrega === "envio"
      ? { tipo: "envio" as const, direccion: { calle: c.calle, numero: c.numero, piso: c.piso, cp: c.cp, localidad: c.localidad, provincia: c.provincia, indicaciones: c.indicaciones } }
      : { tipo: "retiro" as const, local },
    medioPago: medio,
    ...((c.notas ?? "").trim() ? { notas: (c.notas ?? "").trim() } : {}),
    aceptaTerminos: acepta,
  }), [lineas, c, entrega, local, medio, acepta]);

  async function confirmar(e: React.FormEvent) {
    e.preventDefault();
    setGeneral(null);
    const v = PedidoNuevo.safeParse(cuerpo);
    if (!v.success) {
      const m: Record<string, string> = {};
      for (const i of v.error.issues) m[String(i.path.at(-1))] ??= i.message;
      setErrores(m);
      return;
    }
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
      if (x.codigo === "sin_stock" || x.codigo === "carrito_cambio") await cotizar({ entrega, medioPago: medio });
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

  return (
    <form onSubmit={confirmar} noValidate className="contenedor grid gap-10 py-10 lg:grid-cols-[1fr_400px]">
      <div className="space-y-10">
        <h1 className="text-[clamp(2.2rem,6vw,3.6rem)] leading-none">Finalizar compra</h1>

        <fieldset className="space-y-4">
          <legend className="mb-4 font-display text-2xl">1. Tus datos</legend>
          {inp("email", "Email", { type: "email", autoComplete: "email", inputMode: "email" })}
          <div className="grid gap-4 sm:grid-cols-2">
            {inp("nombre", "Nombre", { autoComplete: "given-name" })}
            {inp("apellido", "Apellido", { autoComplete: "family-name" })}
            {inp("telefono", "Celular", { type: "tel", autoComplete: "tel", placeholder: "11 5555-5555" })}
            {inp("dni", "DNI o CUIT", { inputMode: "numeric", autoComplete: "off" })}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-4 font-display text-2xl">2. Entrega</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {([["envio", "Envío a domicilio", "Todo el país. En CABA y GBA llega hoy o mañana."], ["retiro", "Retiro en el local", "Gratis. Te avisamos cuando esté listo."]] as const).map(([v, t, d]) => (
              <label key={v} className={`cursor-pointer rounded-2xl border-2 p-4 ${entrega === v ? "border-tinta" : "border-linea"}`}>
                <input type="radio" name="entrega" value={v} checked={entrega === v} onChange={() => setEntrega(v)} className="sr-only" />
                <span className="block font-bold">{t}</span><span className="text-sm text-tinta-suave">{d}</span>
              </label>
            ))}
          </div>
          {entrega === "envio" ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-6">
              <div className="sm:col-span-4">{inp("calle", "Calle", { autoComplete: "address-line1" })}</div>
              <div className="sm:col-span-2">{inp("numero", "Número")}</div>
              <div className="sm:col-span-2">{inp("piso", "Piso / depto (opcional)", { autoComplete: "address-line2" })}</div>
              <div className="sm:col-span-2">{inp("cp", "Código postal", { autoComplete: "postal-code" })}</div>
              <div className="sm:col-span-2">{inp("localidad", "Localidad", { autoComplete: "address-level2" })}</div>
              <label className="block sm:col-span-3">
                <span className="mb-1 block text-sm font-bold">Provincia</span>
                <select value={c.provincia} onChange={cambiar("provincia")} className={campo} autoComplete="address-level1">{PROVINCIAS.map((p) => <option key={p}>{p}</option>)}</select>
              </label>
              <div className="sm:col-span-3">{inp("indicaciones", "Indicaciones (opcional)", { placeholder: "Timbre, entre calles…" })}</div>
            </div>
          ) : (
            <div className="mt-4 space-y-2" role="radiogroup" aria-label="Local de retiro">
              {locales.map((l) => (
                <label key={l.nombre} className={`flex cursor-pointer gap-3 rounded-2xl border p-4 ${local === l.nombre ? "border-tinta" : "border-linea"}`}>
                  <input type="radio" name="local" checked={local === l.nombre} onChange={() => setLocal(l.nombre)} className="mt-1 accent-tinta" />
                  <span><b>{l.nombre}</b><br /><span className="text-sm text-tinta-suave">{l.direccion}, {l.localidad} · {l.horario}</span></span>
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <fieldset>
          <legend className="mb-4 font-display text-2xl">3. Pago</legend>
          <div className="space-y-2">
            {disponibles.filter((m) => m.id !== "local" || entrega === "retiro").map((m) => (
              <label key={m.id} className={`flex cursor-pointer gap-3 rounded-2xl border p-4 ${medio === m.id ? "border-tinta" : "border-linea"}`}>
                <input type="radio" name="medio" checked={medio === m.id} onChange={() => setMedio(m.id)} className="mt-1 accent-tinta" />
                <span><b>{m.titulo}</b>{m.id === "transferencia" && <span className="ml-2 rounded-full bg-ahorro px-2 py-0.5 text-xs font-bold text-white">{config.descuentoTransferencia}% OFF</span>}<br />
                  <span className="text-sm text-tinta-suave">{m.detalle(config)}</span></span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="block">
          <span className="mb-1 block text-sm font-bold">¿Algo que tengamos que saber? (opcional)</span>
          <textarea value={c.notas} onChange={cambiar("notas")} maxLength={500} rows={2} className={campo} />
        </label>
      </div>

      <aside className="self-start rounded-[var(--radius-foto)] border border-linea p-5 lg:sticky lg:top-28">
        <h2 className="text-2xl">Resumen</h2>
        <ul className="mt-4 space-y-2 text-sm">
          {cotizacion?.lineas.map((l) => (
            <li key={l.sku} className="flex justify-between gap-3"><span>{l.cantidad} × {l.nombre}{l.talle ? ` · ${l.talle}` : ""}</span><span className="shrink-0">{formatearPesos(l.subtotal)}</span></li>
          ))}
        </ul>
        {cotizacion && (
          <dl className="mt-4 space-y-1 border-t border-linea pt-4 text-[15px]">
            <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatearPesos(cotizacion.subtotal)}</dd></div>
            {cotizacion.descuento > 0 && <div className="flex justify-between text-ahorro"><dt>Descuento transferencia</dt><dd>−{formatearPesos(cotizacion.descuento)}</dd></div>}
            <div className="flex justify-between"><dt>Envío</dt><dd>{entrega === "retiro" ? "Gratis" : cotizacion.envio ? formatearPesos(cotizacion.envio) : "Gratis"}</dd></div>
            <div className="flex justify-between pt-2 font-display text-2xl"><dt>Total</dt><dd>{formatearPesos(cotizacion.total)}</dd></div>
          </dl>
        )}
        {cotizacion?.problemas.map((p) => <p key={p.mensaje} className="mt-2 text-sm font-bold text-oferta" role="alert">{p.mensaje}</p>)}
        <label className="mt-5 flex gap-2 text-sm">
          <input type="checkbox" checked={acepta} onChange={(e) => setAcepta(e.target.checked)} aria-invalid={!!errores.aceptaTerminos} className="mt-0.5 size-4 accent-tinta" />
          <span>Acepto los <Link href="/terminos" target="_blank" className="underline">términos y condiciones</Link> y la <Link href="/privacidad" target="_blank" className="underline">política de privacidad</Link>.</span>
        </label>
        {err("aceptaTerminos")}
        {general && <p className="mt-4 rounded-xl bg-oferta/10 p-3 text-sm font-bold text-oferta" role="alert">{general}</p>}
        <button type="submit" disabled={enviando || !!cotizacion?.problemas.length} className="boton mt-5 w-full bg-tinta py-4 text-base text-white hover:bg-marca-fuerte disabled:cursor-not-allowed disabled:bg-linea disabled:text-tinta-tenue">
          {enviando ? "Confirmando…" : medio === "mercadopago" || medio === "pagofacil" ? "Ir a pagar" : "Confirmar compra"}
        </button>
        <p className="mt-3 text-center text-xs text-tinta-tenue">Tus datos viajan cifrados. No guardamos datos de tarjetas: los maneja Mercado Pago.</p>
      </aside>
    </form>
  );
}
