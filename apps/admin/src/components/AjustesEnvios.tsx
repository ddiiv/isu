"use client";
import { armarBolsa, leerPaqueteEnvios, NOMBRE_TRANSPORTE, TRANSPORTES, type AjusteTransportes, type EnviosEnElDia, type OrigenEnvios, type PaqueteEnvios } from "@isu/shared";
import { Boton, Campo, Casilla, claseEntrada, Tarjeta } from "./ui";

/*
 * Ajustes de envíos (etapa 4): qué transporte y servicio se ofrece y con qué
 * recargo, desde dónde salen los paquetes, cómo se arma el paquete (etapa 15:
 * todo el pedido en una bolsa, la más chica en la que entra), los envíos en
 * el día y los avisos por WhatsApp. Las credenciales de cada
 * transporte NO van acá: son variables del servidor.
 */
export interface ValoresEnvios {
  transportes?: AjusteTransportes; origenEnvios?: OrigenEnvios; paqueteEnvios?: PaqueteEnvios; enviosEnElDia?: EnviosEnElDia; avisosWhatsapp?: boolean;
}
const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

export function AjustesEnvios({ v, poner }: { v: ValoresEnvios; poner: (k: keyof ValoresEnvios, x: unknown) => void }) {
  const t = v.transportes;
  const o = v.origenEnvios;
  // El formato viejo (cajas por cantidad de prendas) se muestra ya pasado a bolsas.
  const p = v.paqueteEnvios ? leerPaqueteEnvios(v.paqueteEnvios) : null;
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
        <Tarjeta titulo="Paquete: todo en una bolsa">
          <p className="mb-3 text-xs text-tinta-tenue">
            Todo el pedido viaja en una bolsa: las prendas se apilan y se usa la bolsa más chica en la que entran. Se cotiza igual con todos los transportes.
            Cada producto lleva su peso y medidas (en su ficha); el que no los tenga usa la prenda por defecto.
          </p>
          <p className="mb-2 text-sm font-bold">Prenda por defecto (doblada)</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {([["pesoGramos", "Peso (g)"], ["altoCm", "Grosor (cm)"], ["anchoCm", "Ancho (cm)"], ["largoCm", "Largo (cm)"]] as const).map(([k, e]) => (
              <Campo key={k} etiqueta={e}>
                <input type="number" min={1} className={claseEntrada} value={p.prendaPorDefecto[k]} onChange={(x) => poner("paqueteEnvios", { ...p, prendaPorDefecto: { ...p.prendaPorDefecto, [k]: num(x.target.value) } })} />
              </Campo>
            ))}
          </div>
          <p className="mb-2 mt-4 text-sm font-bold">Bolsas que usás</p>
          <div className="space-y-2">
            {p.bolsas.map((b, i) => {
              const cambiar = (x: Partial<typeof b>) => poner("paqueteEnvios", { ...p, bolsas: p.bolsas.map((y, j) => (j === i ? { ...y, ...x } : y)) });
              return (
                <div key={i} className="grid grid-cols-2 items-end gap-2 rounded-xl border border-linea p-2 sm:grid-cols-[1.4fr_1fr_1fr_1fr_auto]">
                  <Campo etiqueta="Nombre"><input className={claseEntrada} maxLength={30} value={b.nombre} onChange={(e) => cambiar({ nombre: e.target.value })} /></Campo>
                  <Campo etiqueta="Ancho cm"><input type="number" min={10} className={claseEntrada} value={b.anchoCm} onChange={(e) => cambiar({ anchoCm: num(e.target.value) })} /></Campo>
                  <Campo etiqueta="Largo cm"><input type="number" min={10} className={claseEntrada} value={b.largoCm} onChange={(e) => cambiar({ largoCm: num(e.target.value) })} /></Campo>
                  <Campo etiqueta="Peso g"><input type="number" min={0} className={claseEntrada} value={b.pesoGramos} onChange={(e) => cambiar({ pesoGramos: num(e.target.value) })} /></Campo>
                  <Boton type="button" variante="texto" disabled={p.bolsas.length <= 1} aria-label={`Quitar la bolsa ${b.nombre}`}
                    onClick={() => poner("paqueteEnvios", { ...p, bolsas: p.bolsas.filter((_, j) => j !== i) })}>Quitar</Boton>
                </div>
              );
            })}
          </div>
          {p.bolsas.length < 8 && (
            <Boton type="button" variante="borde" className="mt-2" onClick={() => poner("paqueteEnvios", { ...p, bolsas: [...p.bolsas, { nombre: "Nueva", anchoCm: 40, largoCm: 50, pesoGramos: 25 }] })}>Agregar bolsa</Boton>
          )}
          <p className="mt-3 text-xs text-tinta-tenue" aria-live="polite">
            Con la prenda por defecto: {[1, 3, 6, 12].map((n) => `${n} ${n === 1 ? "prenda" : "prendas"} → ${armarBolsa([{ ...p.prendaPorDefecto, cantidad: n }], p.bolsas).bolsa}`).join(" · ")}
          </p>
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
