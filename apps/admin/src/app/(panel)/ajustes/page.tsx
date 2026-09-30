"use client";
import { useEffect, useState } from "react";
import type { Local } from "@isu/shared";
import { api, fecha, useDatos } from "@/lib/api";
import { Boton, Campo, Cargando, Casilla, claseEntrada, EntradaPesos, Mensaje, Tarjeta, Titulo, useAviso } from "@/components/ui";

/* Ajustes de la tienda (sólo el dueño). Cada campo se valida en la API; los cambios quedan en la auditoría. */
type Valores = Record<string, unknown> & {
  anuncio: string | null; whatsapp: string; email: string | null; descuentoTransferencia: number; cuotasSinInteres: number;
  montoMinimoCarrito: number; envioGratisDesde: number | null; costoEnvio: number; avisoUltimas: number; mostrarAgotados: boolean; publicarNuevos: boolean;
  horasPagoOnline: number; horasPagoFacil: number; horasTransferencia: number; horasPagoLocal: number;
  datosTransferencia: { titular: string; cuit: string; banco: string; cbu: string; alias: string };
  locales: Local[];
};
const HORAS: Array<[keyof Valores, string, number, number]> = [
  ["horasPagoOnline", "Mercado Pago (tarjeta)", 1, 72], ["horasPagoFacil", "Pago Fácil / Rapipago", 24, 240],
  ["horasTransferencia", "Transferencia", 2, 240], ["horasPagoLocal", "Pagar al retirar en el local", 24, 720],
];

export default function Ajustes() {
  const { datos, error, recargar } = useDatos<{ ajustes: Array<{ clave: string; valor: unknown; actualizadoPor: string | null; actualizadoEn: string }> }>("ajustes");
  const [v, setV] = useState<Valores | null>(null);
  const aviso = useAviso();
  const original = datos ? Object.fromEntries(datos.ajustes.map((a) => [a.clave, a.valor])) as Valores : null;
  useEffect(() => { if (original) setV(structuredClone(original)); }, [datos]);
  if (error) return <Mensaje>{error}</Mensaje>;
  if (!v || !original) return <Cargando />;
  const poner = <K extends keyof Valores>(k: K, x: Valores[K]) => setV({ ...v, [k]: x });
  const t = v.datosTransferencia ?? { titular: "", cuit: "", banco: "", cbu: "", alias: "" };
  const locales = v.locales ?? [];
  const ultima = datos!.ajustes.reduce((a, b) => (a && a.actualizadoEn > b.actualizadoEn ? a : b), datos!.ajustes[0]);

  async function guardar() {
    const cambios = Object.fromEntries(Object.entries(v!).filter(([k, x]) => JSON.stringify(x) !== JSON.stringify(original![k])));
    if (!Object.keys(cambios).length) return aviso.ok("No hay cambios.");
    try { await api("ajustes", { metodo: "PUT", cuerpo: cambios }); aviso.ok("Guardado. La tienda lo muestra en un minuto."); await recargar(); } catch (e) { aviso.error(e); }
  }

  return (
    <>
      <Titulo acciones={<Boton onClick={() => void guardar()}>Guardar ajustes</Boton>}>Ajustes</Titulo>
      <div className="mb-4 space-y-2"><aviso.Aviso />{ultima && <p className="text-xs text-tinta-tenue">Último cambio: {fecha(ultima.actualizadoEn)} · {ultima.actualizadoPor}</p>}</div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Tarjeta titulo="Tienda">
          <div className="space-y-3">
            <Campo etiqueta="Anuncio (barra de arriba)" ayuda="Vacío = sin barra. Hasta 160 caracteres."><input maxLength={160} className={claseEntrada} value={v.anuncio ?? ""} onChange={(e) => poner("anuncio", e.target.value || null)} /></Campo>
            <Campo etiqueta="WhatsApp" ayuda="Con código de país, sin + ni espacios: 5491122334455"><input inputMode="numeric" className={claseEntrada} value={v.whatsapp} onChange={(e) => poner("whatsapp", e.target.value.replace(/\D/g, ""))} /></Campo>
            <Campo etiqueta="Email público"><input type="email" className={claseEntrada} value={v.email ?? ""} onChange={(e) => poner("email", e.target.value || null)} /></Campo>
          </div>
        </Tarjeta>
        <Tarjeta titulo="Precios y envío">
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="% OFF con transferencia"><input type="number" min={0} max={100} className={claseEntrada} value={v.descuentoTransferencia} onChange={(e) => poner("descuentoTransferencia", Number(e.target.value) || 0)} /></Campo>
            <Campo etiqueta="Cuotas sin interés"><input type="number" min={1} max={24} className={claseEntrada} value={v.cuotasSinInteres} onChange={(e) => poner("cuotasSinInteres", Number(e.target.value) || 1)} /></Campo>
            <Campo etiqueta="Compra mínima"><EntradaPesos valor={v.montoMinimoCarrito} onChange={(c) => poner("montoMinimoCarrito", c ?? 0)} /></Campo>
            <Campo etiqueta="Costo de envío"><EntradaPesos valor={v.costoEnvio} onChange={(c) => poner("costoEnvio", c ?? 0)} /></Campo>
            <Campo etiqueta="Envío gratis desde" ayuda="Vacío = nunca."><EntradaPesos valor={v.envioGratisDesde} onChange={(c) => poner("envioGratisDesde", c)} /></Campo>
          </div>
        </Tarjeta>
        <Tarjeta titulo="Datos para transferir">
          <p className="mb-3 text-xs text-tinta-tenue">Sin CBU o alias, la tienda no ofrece transferencia. Revisalos bien: es donde te pagan.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {([["titular", "Titular"], ["cuit", "CUIT"], ["banco", "Banco"], ["cbu", "CBU / CVU (22 números)"], ["alias", "Alias"]] as const).map(([k, e]) => (
              <Campo key={k} etiqueta={e}><input className={claseEntrada} value={t[k]} onChange={(x) => poner("datosTransferencia", { ...t, [k]: x.target.value })} /></Campo>
            ))}
          </div>
        </Tarjeta>
        <Tarjeta titulo="Tiempo para pagar (horas)">
          <p className="mb-3 text-xs text-tinta-tenue">Mientras tanto la mercadería queda apartada en Stocker. Si no paga, se libera sola.</p>
          <div className="grid grid-cols-2 gap-3">
            {HORAS.map(([k, e, min, max]) => <Campo key={k} etiqueta={e}><input type="number" min={min} max={max} className={claseEntrada} value={v[k] as number} onChange={(x) => poner(k, Number(x.target.value) || min)} /></Campo>)}
          </div>
        </Tarjeta>
        <Tarjeta titulo="Catálogo">
          <div className="space-y-3">
            <Casilla etiqueta="Publicar solos los productos nuevos de Stocker" ayuda="Si no, quedan ocultos hasta que alguien los publique." marcada={v.publicarNuevos} onChange={(x) => poner("publicarNuevos", x)} />
            <Casilla etiqueta="Mostrar agotados (al final)" marcada={v.mostrarAgotados} onChange={(x) => poner("mostrarAgotados", x)} />
            <Campo etiqueta={'Avisar "¡Últimas!" desde'}><input type="number" min={0} max={20} className={`${claseEntrada} w-28`} value={v.avisoUltimas} onChange={(e) => poner("avisoUltimas", Number(e.target.value) || 0)} /></Campo>
          </div>
        </Tarjeta>
        <Tarjeta titulo="Locales" acciones={<Boton variante="borde" onClick={() => poner("locales", [...locales, { nombre: "", direccion: "", localidad: "", horario: "", mapa: null, retiro: true }])}>+ Local</Boton>}>
          <div className="space-y-4">
            {locales.map((l, i) => {
              const cambiar = (c: Partial<Local>) => poner("locales", locales.map((x, j) => (j === i ? { ...x, ...c } : x)));
              return (
                <div key={i} className="space-y-2 rounded-xl border border-linea p-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input aria-label="Nombre" placeholder="Nombre" className={claseEntrada} value={l.nombre} onChange={(e) => cambiar({ nombre: e.target.value })} />
                    <input aria-label="Dirección" placeholder="Dirección" className={claseEntrada} value={l.direccion} onChange={(e) => cambiar({ direccion: e.target.value })} />
                    <input aria-label="Localidad" placeholder="Localidad" className={claseEntrada} value={l.localidad} onChange={(e) => cambiar({ localidad: e.target.value })} />
                    <input aria-label="Horario" placeholder="Horario" className={claseEntrada} value={l.horario} onChange={(e) => cambiar({ horario: e.target.value })} />
                    <input aria-label="Enlace a Google Maps" placeholder="https://maps.google.com/…" className={`${claseEntrada} sm:col-span-2`} value={l.mapa ?? ""} onChange={(e) => cambiar({ mapa: e.target.value || null })} />
                  </div>
                  <div className="flex items-center justify-between">
                    <Casilla etiqueta="Se puede retirar acá" marcada={l.retiro} onChange={(x) => cambiar({ retiro: x })} />
                    <Boton variante="texto" className="text-oferta" onClick={() => poner("locales", locales.filter((_, j) => j !== i))}>Quitar</Boton>
                  </div>
                </div>
              );
            })}
          </div>
        </Tarjeta>
      </div>
    </>
  );
}
