"use client";
import { useEffect, useRef, useState } from "react";
import { formatearPesos, type OpcionEnvio, type SucursalEnvio } from "@isu/shared";
import { api, type ErrorApi } from "@/lib/cliente-api";

/*
 * Cómo te lo mandamos: con el código postal, la API cotiza con cada
 * transporte y devuelve las opciones (precio, plazo, envío gratis, llega
 * hoy). A sucursal se elige la sucursal de una lista del transporte.
 * El precio que se ve es informativo: al confirmar la API lo vuelve a cotizar.
 */
export interface EleccionEnvio { opcion: OpcionEnvio | null; sucursal: string | null }

const CP_VALIDO = /^([A-Za-z]\d{4}[A-Za-z]{3}|\d{4})$/;
const cp4 = (cp: string) => (/^\d{4}$/.test(cp) ? cp : cp.slice(1, 5));

export function OpcionesEnvio({ items, destino, medioPago, cupon, valor, alCambiar, error, recargar }: {
  items: Array<{ sku: string; cantidad: number }>;
  /** con un cupón de envío gratis, las opciones salen en $0 */
  cupon?: string | null;
  destino: { cp: string; provincia: string; localidad: string };
  medioPago: string;
  valor: EleccionEnvio;
  alCambiar: (e: EleccionEnvio) => void;
  error?: string;
  /** Cambia cuando hay que volver a pedir las opciones (p. ej. la API dijo que una ya no está). */
  recargar: number;
}) {
  const [opciones, setOpciones] = useState<OpcionEnvio[] | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [falla, setFalla] = useState<string | null>(null);
  const [sucursales, setSucursales] = useState<SucursalEnvio[] | null>(null);
  const [cargandoSuc, setCargandoSuc] = useState(false);
  const ultimo = useRef(0);
  const cp = destino.cp.trim();
  const listo = CP_VALIDO.test(cp) && destino.localidad.trim().length >= 2;
  const clave = JSON.stringify([items, cp, destino.provincia, destino.localidad.trim(), medioPago, cupon ?? null, recargar]);

  // Se pide con una pausa (mientras escribe el CP no se cotiza cada tecla) y gana siempre el último pedido.
  useEffect(() => {
    if (!listo || !items.length) { setOpciones(null); return; }
    const n = ++ultimo.current;
    const t = setTimeout(async () => {
      setCargando(true); setFalla(null);
      try {
        const r = await api<{ opciones: OpcionEnvio[]; aviso: string | null }>("envios/opciones", {
          cuerpo: { items, destino: { cp, provincia: destino.provincia, localidad: destino.localidad.trim() }, medioPago, ...(cupon ? { cupon } : {}) },
        });
        if (n !== ultimo.current) return;
        setOpciones(r.opciones); setAviso(r.aviso);
        const sigue = valor.opcion && r.opciones.find((o) => o.id === valor.opcion!.id);
        alCambiar({ opcion: sigue ?? r.opciones.find((o) => !o.requiereSucursal) ?? r.opciones[0] ?? null, sucursal: sigue ? valor.sucursal : null });
      } catch (e) {
        if (n !== ultimo.current) return;
        setOpciones(null);
        setFalla((e as ErrorApi).message ?? "No pudimos cotizar el envío.");
        alCambiar({ opcion: null, sucursal: null });
      } finally {
        if (n === ultimo.current) setCargando(false);
      }
    }, 450);
    return () => clearTimeout(t);
    // `clave` resume todo lo que cambia la cotización
  }, [clave, listo]);

  // A sucursal: la lista del transporte para ese CP.
  const transporteSuc = valor.opcion?.requiereSucursal ? valor.opcion.transporte : null;
  useEffect(() => {
    if (!transporteSuc || !listo) { setSucursales(null); return; }
    let vale = true;
    setCargandoSuc(true);
    const q = new URLSearchParams({ transporte: transporteSuc, cp: cp4(cp), provincia: destino.provincia });
    api<{ sucursales: SucursalEnvio[] }>(`envios/sucursales?${q}`)
      .then((r) => { if (vale) setSucursales(r.sucursales); })
      .catch(() => { if (vale) setSucursales([]); })
      .finally(() => { if (vale) setCargandoSuc(false); });
    return () => { vale = false; };
  }, [transporteSuc, cp, destino.provincia, listo]);

  if (!listo) {
    return <p className="rounded-2xl bg-fondo-suave p-4 text-sm text-tinta-suave">Completá el código postal y la localidad para ver cómo te lo mandamos y cuánto sale.</p>;
  }
  if (cargando && !opciones) return <p className="rounded-2xl bg-fondo-suave p-4 text-sm" aria-live="polite">Cotizando el envío…</p>;
  if (falla) return <p className="rounded-2xl bg-oferta/10 p-4 text-sm font-bold text-oferta" role="alert">{falla}</p>;
  if (!opciones) return null;

  return (
    <div className="space-y-2" aria-busy={cargando}>
      <p className="font-bold" id="titulo-opciones">¿Cómo te lo mandamos?</p>
      <div role="radiogroup" aria-labelledby="titulo-opciones" aria-describedby={error ? "e-opcionEnvio" : undefined} className="space-y-2">
        {opciones.map((o) => {
          const elegida = valor.opcion?.id === o.id;
          return (
            <label key={o.id} className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 ${elegida ? "border-tinta bg-white" : "border-linea"}`}>
              <input type="radio" name="opcionEnvio" checked={elegida} onChange={() => alCambiar({ opcion: o, sucursal: null })} className="mt-1 accent-tinta" />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <b>{o.nombre}</b>
                  {o.llegaHoy && <span className="rounded-full bg-marca px-2 py-0.5 text-xs font-bold text-white">Llega hoy</span>}
                </span>
                <span className="block text-sm text-tinta-suave">{o.detalle}</span>
              </span>
              <span className="shrink-0 text-right">
                {o.gratis ? <b className="text-ahorro">Gratis</b> : o.soloMercadoPago ? <b>{formatearPesos(o.precio)}*</b> : <b>{formatearPesos(o.precio)}</b>}
                {o.precioOriginal > o.precio && <s className="block text-xs text-tinta-tenue">{formatearPesos(o.precioOriginal)}</s>}
              </span>
            </label>
          );
        })}
      </div>
      {opciones.some((o) => o.soloMercadoPago) && <p className="text-xs text-tinta-tenue">* Mercado Envíos: el envío lo cobra Mercado Pago al pagar.</p>}
      {aviso && <p className="text-sm text-tinta-suave" role="status">{aviso}</p>}
      {error && <p id="e-opcionEnvio" className="text-sm text-oferta">{error}</p>}

      {valor.opcion?.requiereSucursal && (
        <div className="mt-3 rounded-2xl border border-linea p-4">
          <p className="mb-2 font-bold" id="titulo-sucursal">Elegí la sucursal</p>
          {cargandoSuc ? <p className="text-sm">Buscando sucursales cerca…</p>
            : !sucursales?.length ? <p className="text-sm text-oferta">No encontramos sucursales para ese código postal. Elegí envío a domicilio.</p>
            : (
              <div role="radiogroup" aria-labelledby="titulo-sucursal" className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {sucursales.map((s) => (
                  <label key={s.id} className={`flex cursor-pointer gap-3 rounded-xl border p-3 text-sm ${valor.sucursal === s.id ? "border-tinta" : "border-linea"}`}>
                    <input type="radio" name="sucursal" checked={valor.sucursal === s.id} onChange={() => alCambiar({ opcion: valor.opcion, sucursal: s.id })} className="mt-0.5 accent-tinta" />
                    <span className="min-w-0"><b>{s.nombre}</b><br /><span className="text-tinta-suave">{s.direccion}{s.localidad ? `, ${s.localidad}` : ""}{s.horario ? ` · ${s.horario}` : ""}</span></span>
                  </label>
                ))}
              </div>
            )}
        </div>
      )}
    </div>
  );
}
