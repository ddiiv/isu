"use client";
import { useEffect, useState } from "react";
import { api, useDatos } from "@/lib/api";
import { Boton, Campo, Cargando, Casilla, claseEntrada, EntradaPesos, Insignia, Mensaje, Tarjeta, Titulo, useAviso } from "@/components/ui";
import { puede, useYo } from "@/components/Marco";

/*
 * Ruleta de descuentos. Aparece sola, una vez por semana por cuenta, mientras haya un evento vigente (Navidad…), y se puede prender a
 * mano cuando se quiera. El sorteo lo hace el servidor; acá se elige cuándo aparece, cada cuánto, cuánto dura el cupón y qué premios
 * hay con su peso (la probabilidad de cada uno es su peso sobre la suma de los activos). Los cupones ganados son personales y de un uso.
 */
type Tipo = "porcentaje" | "monto" | "envio_gratis" | "segunda_unidad" | "nada";
interface Premio { id?: number; etiqueta: string; tipo: Tipo; valor: number; minimo: number; peso: number; activo: boolean; giros?: number; detalle?: string }
interface Datos {
  config: { manual: boolean; conEventos: boolean; cadaDias: number; venceDias: number }; abierta: boolean; evento: string | null;
  premios: Premio[]; giros: { total: number; semana: number };
}
const TIPOS: Array<[Tipo, string]> = [["porcentaje", "% de descuento"], ["monto", "Monto fijo"], ["envio_gratis", "Envío gratis"], ["segunda_unidad", "2da unidad con %"], ["nada", "Sin premio"]];

export default function Ruleta() {
  const operador = puede(useYo(), "operador");
  const { datos, error, recargar } = useDatos<Datos>("ruleta");
  const aviso = useAviso();
  const [config, setConfig] = useState<Datos["config"] | null>(null);
  const [premios, setPremios] = useState<Premio[]>([]);
  useEffect(() => { if (datos) { setConfig(datos.config); setPremios(datos.premios); } }, [datos]);
  if (error) return <Mensaje>{error}</Mensaje>;
  if (!datos || !config) return <Cargando />;

  const suma = premios.filter((p) => p.activo).reduce((s, p) => s + p.peso, 0);
  const prob = (p: Premio) => (p.activo && suma > 0 ? Math.round((p.peso / suma) * 1000) / 10 : 0);
  const cambiar = (i: number, c: Partial<Premio>) => setPremios((ps) => ps.map((p, j) => (j === i ? { ...p, ...c } : p)));
  const estado = datos.abierta ? [datos.config.manual ? "Abierta: prendida a mano" : `Abierta por ${datos.evento}`, "bg-ahorro-claro text-ahorro"] : ["Cerrada ahora", ""];

  async function guardarConfig() {
    try { await api("ruleta", { metodo: "PUT", cuerpo: config }); aviso.ok("Guardado."); await recargar(); } catch (e) { aviso.error(e); }
  }
  async function guardarPremios() {
    try {
      await api("ruleta/premios", { metodo: "PUT", cuerpo: { premios: premios.map((p) => ({ id: p.id, etiqueta: p.etiqueta, tipo: p.tipo, valor: p.valor, minimo: p.minimo, peso: p.peso, activo: p.activo })) } });
      aviso.ok("Premios guardados."); await recargar();
    } catch (e) { aviso.error(e); }
  }

  return (
    <>
      <Titulo>Ruleta</Titulo>
      <p className="mb-2"><Insignia clase={estado[1]}>{estado[0]}</Insignia> <span className="text-sm text-tinta-tenue">{datos.giros.semana} giros esta semana · {datos.giros.total} en total</span></p>
      <div className="mb-4"><aviso.Aviso /></div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Tarjeta titulo="Cuándo aparece">
          <div className="space-y-3">
            <Casilla disabled={!operador} etiqueta="Aparece sola mientras haya un evento vigente" marcada={config.conEventos} onChange={(v) => setConfig({ ...config, conEventos: v })}
              ayuda="Navidad, Cupido, Halloween… El cupón que se gana vale mientras el evento siga vigente." />
            <Casilla disabled={!operador} etiqueta="Prendida a mano (aunque no haya evento)" marcada={config.manual} onChange={(v) => setConfig({ ...config, manual: v })}
              ayuda="Para cuando quieras lanzarla por tu cuenta. Apagala cuando termine." />
            <Campo etiqueta="Cada cuántos días puede girar una cuenta" ayuda="7 = una vez por semana. El primer giro es apenas se registra.">
              <input type="number" min={1} max={365} disabled={!operador} className={`${claseEntrada} w-28`} value={config.cadaDias} onChange={(e) => setConfig({ ...config, cadaDias: Math.max(1, Math.min(365, Math.trunc(Number(e.target.value)) || 1)) })} />
            </Campo>
            <Campo etiqueta="Cuántos días dura el cupón ganado" ayuda="Si salió de un evento, nunca pasa de cuando el evento termina.">
              <input type="number" min={1} max={365} disabled={!operador} className={`${claseEntrada} w-28`} value={config.venceDias} onChange={(e) => setConfig({ ...config, venceDias: Math.max(1, Math.min(365, Math.trunc(Number(e.target.value)) || 1)) })} />
            </Campo>
            {operador && <Boton onClick={() => void guardarConfig()}>Guardar</Boton>}
          </div>
        </Tarjeta>

        <Tarjeta titulo="Premios y probabilidades" acciones={operador && <Boton onClick={() => void guardarPremios()} disabled={suma <= 0}>Guardar premios</Boton>}>
          <p className="mb-3 text-xs text-tinta-tenue">La probabilidad de cada premio es su peso sobre la suma de los pesos de los activos. «Sin premio» (Seguís participando, Casi ganás) gasta el giro y no da cupón. Los cupones ganados no se suman a la rebaja de la prenda: rige el mejor precio.</p>
          <ul className="space-y-3">
            {premios.map((p, i) => (
              <li key={p.id ?? `n${i}`} className="grid grid-cols-2 items-end gap-2 rounded-xl border border-linea p-3 sm:grid-cols-[1.3fr_1.5fr_1fr_1fr_84px_auto]">
                <Campo etiqueta="Nombre"><input maxLength={40} disabled={!operador} className={claseEntrada} value={p.etiqueta} onChange={(e) => cambiar(i, { etiqueta: e.target.value })} /></Campo>
                <Campo etiqueta="Tipo">
                  <select disabled={!operador} className={claseEntrada} value={p.tipo} onChange={(e) => { const t = e.target.value as Tipo; cambiar(i, { tipo: t, valor: t === "porcentaje" ? 10 : t === "segunda_unidad" ? 50 : t === "monto" ? 300_000 : 0 }); }}>
                    {TIPOS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
                  </select>
                </Campo>
                <Campo etiqueta="Valor">
                  {p.tipo === "porcentaje" || p.tipo === "segunda_unidad"
                    ? <span className="relative block"><input type="number" min={1} max={90} disabled={!operador} className={`${claseEntrada} pr-7`} value={p.valor} onChange={(e) => cambiar(i, { valor: Math.max(1, Math.min(90, Math.trunc(Number(e.target.value)) || 1)) })} /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-tinta-tenue">%</span></span>
                    : p.tipo === "monto" ? <EntradaPesos valor={p.valor} onChange={(v) => cambiar(i, { valor: v ?? 100 })} /> : <span className="block py-2.5 text-sm text-tinta-tenue">—</span>}
                </Campo>
                <Campo etiqueta="Compra mínima">{p.tipo === "nada" ? <span className="block py-2.5 text-sm text-tinta-tenue">—</span> : <EntradaPesos valor={p.minimo || null} onChange={(v) => cambiar(i, { minimo: v ?? 0 })} />}</Campo>
                <Campo etiqueta="Peso"><input type="number" min={0} max={1000} disabled={!operador} className={claseEntrada} value={p.peso} onChange={(e) => cambiar(i, { peso: Math.max(0, Math.min(1000, Math.trunc(Number(e.target.value)) || 0)) })} /></Campo>
                <div className="col-span-2 flex items-center justify-between gap-3 sm:col-span-1 sm:flex-col sm:items-end">
                  <span className="text-sm font-bold">{prob(p)}%</span>
                  <Casilla disabled={!operador} etiqueta="Activo" marcada={p.activo} onChange={(v) => cambiar(i, { activo: v })} />
                  {operador && premios.length > 2 && <button type="button" className="text-xs font-bold text-oferta" onClick={() => setPremios((ps) => ps.filter((_, j) => j !== i))}>Quitar</button>}
                </div>
                {p.giros ? <p className="col-span-full text-xs text-tinta-tenue">Salió {p.giros} {p.giros === 1 ? "vez" : "veces"}{p.detalle ? ` · ${p.detalle}` : ""}</p> : null}
              </li>
            ))}
          </ul>
          {operador && premios.length < 16 && <Boton className="mt-3" variante="borde" onClick={() => setPremios((ps) => [...ps, { etiqueta: "Nuevo premio", tipo: "porcentaje", valor: 10, minimo: 0, peso: 5, activo: true }])}>Agregar premio</Boton>}
          <p className="mt-3 text-xs text-tinta-tenue">Suma de pesos activos: {suma}.</p>
        </Tarjeta>
      </div>
    </>
  );
}
