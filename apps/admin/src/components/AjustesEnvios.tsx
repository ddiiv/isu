"use client";
import { NOMBRE_TRANSPORTE, TRANSPORTES, type AjusteTransportes, type EnviosEnElDia, type OrigenEnvios, type PaqueteEnvios } from "@isu/shared";
import { Campo, Casilla, claseEntrada, Tarjeta } from "./ui";

/*
 * Ajustes de envíos (etapa 4): qué transporte y servicio se ofrece y con qué
 * recargo, desde dónde salen los paquetes, cómo se calcula el paquete, los
 * envíos en el día y los avisos por WhatsApp. Las credenciales de cada
 * transporte NO van acá: son variables del servidor.
 */
export interface ValoresEnvios {
  transportes?: AjusteTransportes; origenEnvios?: OrigenEnvios; paqueteEnvios?: PaqueteEnvios; enviosEnElDia?: EnviosEnElDia; avisosWhatsapp?: boolean;
}
const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

export function AjustesEnvios({ v, poner }: { v: ValoresEnvios; poner: (k: keyof ValoresEnvios, x: unknown) => void }) {
  const t = v.transportes;
  const o = v.origenEnvios;
  const p = v.paqueteEnvios;
  const d = v.enviosEnElDia;
  const num = (s: string) => (s === "" ? 0 : Number(s));
  return (
    <>
      {t && (
        <Tarjeta titulo="Transportes" className="lg:col-span-2">
          <p className="mb-3 text-xs text-tinta-tenue">Sólo se ofrecen los que además tienen credenciales en el servidor. Recargo: % sobre lo que cotiza el transporte (negativo = lo subsidiás). Cabify es sólo en el día; Mercado Envíos sólo pagando con Mercado Pago.</p>
          <div className="overflow-x-auto">
            <table className="tabla-apilada w-full min-w-[560px] text-left text-sm">
              <thead className="text-tinta-tenue"><tr><th className="py-2 pr-3">Transporte</th><th className="py-2 pr-3">Activo</th><th className="py-2 pr-3">A domicilio</th><th className="py-2 pr-3">A sucursal</th><th className="py-2">Recargo %</th></tr></thead>
              <tbody className="divide-y divide-linea">
                {TRANSPORTES.map((k) => {
                  const a = t[k];
                  const cambiar = (c: Partial<typeof a>) => poner("transportes", { ...t, [k]: { ...a, ...c } });
                  return (
                    <tr key={k}>
                      <td className="py-2 pr-3 font-bold">{NOMBRE_TRANSPORTE[k]}</td>
                      <td className="py-2 pr-3" data-etiqueta="Activo"><input type="checkbox" aria-label={`${NOMBRE_TRANSPORTE[k]} activo`} checked={a.activo} onChange={(e) => cambiar({ activo: e.target.checked })} className="size-4 accent-tinta" /></td>
                      <td className="py-2 pr-3" data-etiqueta="A domicilio"><input type="checkbox" aria-label={`${NOMBRE_TRANSPORTE[k]} a domicilio`} disabled={k === "cabify"} checked={a.domicilio} onChange={(e) => cambiar({ domicilio: e.target.checked })} className="size-4 accent-tinta" /></td>
                      <td className="py-2 pr-3" data-etiqueta="A sucursal"><input type="checkbox" aria-label={`${NOMBRE_TRANSPORTE[k]} a sucursal`} disabled={k === "cabify" || k === "mercado_envios"} checked={a.sucursal} onChange={(e) => cambiar({ sucursal: e.target.checked })} className="size-4 accent-tinta" /></td>
                      <td className="py-2" data-etiqueta="Recargo %"><input type="number" min={-50} max={200} aria-label={`Recargo ${NOMBRE_TRANSPORTE[k]}`} className={`${claseEntrada} w-24`} value={a.recargo} onChange={(e) => cambiar({ recargo: num(e.target.value) })} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Tarjeta>
      )}
      {o && (
        <Tarjeta titulo="Remitente (desde dónde salen)">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {([["nombre", "Nombre"], ["cuit", "CUIT"], ["calle", "Calle"], ["numero", "Número"], ["piso", "Piso / depto"], ["cp", "Código postal"], ["localidad", "Localidad"], ["provincia", "Provincia"], ["email", "Email"], ["telefono", "Teléfono"]] as const).map(([k, e]) => (
              <Campo key={k} etiqueta={e}><input className={claseEntrada} value={o[k]} onChange={(x) => poner("origenEnvios", { ...o, [k]: x.target.value })} /></Campo>
            ))}
          </div>
        </Tarjeta>
      )}
      {p && (
        <Tarjeta titulo="Paquete (para cotizar)">
          <p className="mb-3 text-xs text-tinta-tenue">Peso de cada prenda (si el producto no tiene el suyo) + la caja. La caja se elige por cantidad de prendas.</p>
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Peso por prenda (g)"><input type="number" min={10} max={5000} className={claseEntrada} value={p.pesoPrendaGramos} onChange={(e) => poner("paqueteEnvios", { ...p, pesoPrendaGramos: num(e.target.value) })} /></Campo>
            <Campo etiqueta="Peso de la caja (g)"><input type="number" min={0} max={5000} className={claseEntrada} value={p.pesoCajaGramos} onChange={(e) => poner("paqueteEnvios", { ...p, pesoCajaGramos: num(e.target.value) })} /></Campo>
          </div>
          <div className="mt-3 space-y-2">
            {p.cajas.map((c, i) => {
              const cambiar = (x: Partial<typeof c>) => poner("paqueteEnvios", { ...p, cajas: p.cajas.map((y, j) => (j === i ? { ...y, ...x } : y)) });
              return (
                <div key={i} className="grid grid-cols-2 items-end gap-2 rounded-xl border border-linea p-2 sm:grid-cols-4">
                  <Campo etiqueta="Hasta prendas"><input type="number" min={1} className={claseEntrada} value={c.hastaPrendas} onChange={(e) => cambiar({ hastaPrendas: num(e.target.value) })} /></Campo>
                  <Campo etiqueta="Alto cm"><input type="number" min={1} className={claseEntrada} value={c.altoCm} onChange={(e) => cambiar({ altoCm: num(e.target.value) })} /></Campo>
                  <Campo etiqueta="Ancho cm"><input type="number" min={1} className={claseEntrada} value={c.anchoCm} onChange={(e) => cambiar({ anchoCm: num(e.target.value) })} /></Campo>
                  <Campo etiqueta="Largo cm"><input type="number" min={1} className={claseEntrada} value={c.largoCm} onChange={(e) => cambiar({ largoCm: num(e.target.value) })} /></Campo>
                </div>
              );
            })}
          </div>
        </Tarjeta>
      )}
      {d && (
        <Tarjeta titulo="Envíos en el día (Cabify)">
          <div className="space-y-3">
            <Campo etiqueta="Códigos postales" ayuda="Rangos separados por coma: 1000-1499,1600-1899"><input className={claseEntrada} value={d.cps} onChange={(e) => poner("enviosEnElDia", { ...d, cps: e.target.value })} /></Campo>
            <fieldset>
              <legend className="mb-1 text-sm font-bold">Días</legend>
              <div className="flex flex-wrap gap-2">
                {DIAS.map((n, i) => (
                  <label key={n} className={`cursor-pointer rounded-full px-3 py-1.5 text-sm ring-1 ${d.dias.includes(i) ? "bg-tinta text-white ring-tinta" : "ring-linea"}`}>
                    <input type="checkbox" className="sr-only" checked={d.dias.includes(i)} onChange={(e) => poner("enviosEnElDia", { ...d, dias: e.target.checked ? [...d.dias, i].sort() : d.dias.filter((x) => x !== i) })} />{n}
                  </label>
                ))}
              </div>
            </fieldset>
            <Campo etiqueta="Hora de corte" ayuda="Pagado antes de esta hora, llega hoy."><input type="time" className={`${claseEntrada} w-36`} value={d.horaCorte} onChange={(e) => poner("enviosEnElDia", { ...d, horaCorte: e.target.value })} /></Campo>
          </div>
        </Tarjeta>
      )}
      {v.avisosWhatsapp !== undefined && (
        <Tarjeta titulo="Avisos de envío">
          <Casilla etiqueta="Mandar avisos por WhatsApp (a quien lo pidió en el checkout)" ayuda="Los mails se mandan siempre. WhatsApp necesita las plantillas aprobadas en Meta." marcada={v.avisosWhatsapp} onChange={(x) => poner("avisosWhatsapp", x)} />
        </Tarjeta>
      )}
    </>
  );
}
