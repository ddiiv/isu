"use client";
import { useState } from "react";
import { api, fecha, useDatos } from "@/lib/api";
import { Boton, Campo, Cargando, Casilla, claseEntrada, Insignia, Mensaje, Tarjeta, Titulo, useAviso } from "@/components/ui";
import { puede, useYo } from "@/components/Marco";

/*
 * Eventos de temporada (Navidad hoy; Cupido, Halloween… se suman como una fila más).
 * Un evento agrupa descuentos, cupones/promociones y banners: valen sólo mientras el evento esté vigente
 * (prendido y dentro de sus fechas). Se prende todo junto; al apagarlo, la tienda vuelve a la normalidad.
 * Hay un solo evento prendido a la vez: al prender uno se apaga el otro.
 */
interface Evento { id: number; clave: string; nombre: string; activo: boolean; desde: string | null; hasta: string | null; vigente: boolean; descuentoMax: number | null; descuentos: number; cupones: number; banners: number }
interface Item { id: number; nombre: string; activo: boolean; evento: string | null; codigo?: string | null; automatico?: boolean; porcentaje?: number }
interface Datos { eventos: Evento[]; disponibles: { descuentos: Item[]; cupones: Item[]; banners: Item[] } }
type Tipo = "descuentos" | "cupones" | "banners";
const TIPOS: Array<[Tipo, string]> = [["descuentos", "Descuentos"], ["cupones", "Cupones y promociones"], ["banners", "Banners"]];

// <input type="datetime-local"> trabaja en hora local, sin zona.
const aLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");
const aIso = (v: string) => (v ? new Date(v).toISOString() : null);

export default function Eventos() {
  const { datos, error, recargar } = useDatos<Datos>("eventos");
  if (error) return <Mensaje>{error}</Mensaje>;
  if (!datos) return <Cargando />;
  return (
    <>
      <Titulo>Eventos</Titulo>
      <p className="mb-4 max-w-3xl text-sm text-tinta-suave">
        Atá descuentos, cupones y banners a un evento: no se ven en la tienda hasta que lo prendas, y al apagarlo desaparecen todos juntos.
        Lo que no está atado a ningún evento funciona como siempre.
      </p>
      <div className="space-y-6">
        {datos.eventos.map((e) => <TarjetaEvento key={e.clave} e={e} disponibles={datos.disponibles} recargar={recargar} />)}
      </div>
    </>
  );
}

function TarjetaEvento({ e, disponibles, recargar }: { e: Evento; disponibles: Datos["disponibles"]; recargar: () => Promise<void> }) {
  const operador = puede(useYo(), "operador");
  const aviso = useAviso();
  const [desde, setDesde] = useState(aLocal(e.desde));
  const [hasta, setHasta] = useState(aLocal(e.hasta));
  const [elegidos, setElegidos] = useState<Record<Tipo, Set<number>>>(() => ({
    descuentos: new Set(disponibles.descuentos.filter((x) => x.evento === e.clave).map((x) => x.id)),
    cupones: new Set(disponibles.cupones.filter((x) => x.evento === e.clave).map((x) => x.id)),
    banners: new Set(disponibles.banners.filter((x) => x.evento === e.clave).map((x) => x.id)),
  }));
  const fechasMal = !!desde && !!hasta && new Date(hasta) <= new Date(desde);

  async function guardarEstado(activo: boolean) {
    try {
      await api(`eventos/${e.clave}`, { metodo: "PUT", cuerpo: { activo, desde: aIso(desde), hasta: aIso(hasta) } });
      aviso.ok(activo ? `${e.nombre} prendido.` : `${e.nombre} apagado.`); await recargar();
    } catch (x) { aviso.error(x); }
  }
  async function guardarVinculos() {
    try {
      await api(`eventos/${e.clave}/vinculos`, { metodo: "PUT", cuerpo: { descuentos: [...elegidos.descuentos], cupones: [...elegidos.cupones], banners: [...elegidos.banners] } });
      aviso.ok("Guardado."); await recargar();
    } catch (x) { aviso.error(x); }
  }
  const estado = e.vigente ? ["Vigente: se ve en la tienda", "bg-ahorro-claro text-ahorro"] : e.activo ? ["Prendido, fuera de fechas", "bg-fondo-suave text-tinta"] : ["Apagado", ""];

  return (
    <Tarjeta titulo={e.nombre}
      acciones={operador && (e.activo
        ? <Boton variante="borde" onClick={() => void guardarEstado(false)}>Apagar</Boton>
        : <Boton disabled={fechasMal} onClick={() => confirm(`¿Prender ${e.nombre}? Se activan sus descuentos, promociones y banners.`) && void guardarEstado(true)}>Prender</Boton>)}>
      <p className="mb-3"><Insignia clase={estado[1]}>{estado[0]}</Insignia></p>
      <div className="mb-4"><aviso.Aviso /></div>
      {e.descuentoMax && <p className="mb-3 text-sm text-tinta-suave">Los descuentos atados a {e.nombre} pueden ser de hasta <b>{e.descuentoMax}%</b>.</p>}
      <div className="grid max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
        <Campo etiqueta="Desde (opcional)" ayuda="Vacío = apenas lo prendas."><input type="datetime-local" className={claseEntrada} disabled={!operador} value={desde} onChange={(x) => setDesde(x.target.value)} /></Campo>
        <Campo etiqueta="Hasta (opcional)" ayuda="Vacío = hasta que lo apagues." error={fechasMal ? "El fin tiene que ser posterior al inicio." : null}><input type="datetime-local" className={claseEntrada} disabled={!operador} value={hasta} onChange={(x) => setHasta(x.target.value)} /></Campo>
      </div>
      {operador && e.activo && <Boton className="mt-3" variante="borde" disabled={fechasMal} onClick={() => void guardarEstado(true)}>Guardar fechas</Boton>}
      {e.activo && (e.desde || e.hasta) && <p className="mt-2 text-xs text-tinta-tenue">Guardado: {fecha(e.desde)} → {fecha(e.hasta)}</p>}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {TIPOS.map(([tipo, titulo]) => (
          <div key={tipo}>
            <h3 className="mb-2 text-sm font-bold">{titulo} <span className="font-normal text-tinta-tenue">({elegidos[tipo].size} atados)</span></h3>
            <ul className="max-h-64 divide-y divide-linea overflow-y-auto rounded-xl border border-linea px-3 text-sm">
              {disponibles[tipo].map((x) => (
                <li key={x.id} className="py-1.5">
                  <Casilla disabled={!operador || (tipo === "descuentos" && !!e.descuentoMax && (x.porcentaje ?? 0) > e.descuentoMax)} marcada={elegidos[tipo].has(x.id)}
                    onChange={(v) => setElegidos((p) => { const n = new Set(p[tipo]); if (v) n.add(x.id); else n.delete(x.id); return { ...p, [tipo]: n }; })}
                    etiqueta={<span className="font-normal">{x.nombre}{x.porcentaje ? ` · -${x.porcentaje}%` : ""}{x.codigo ? ` · ${x.codigo}` : x.automatico ? " · automática" : ""}
                      {tipo === "descuentos" && !!e.descuentoMax && (x.porcentaje ?? 0) > e.descuentoMax && <span className="text-xs text-oferta"> · pasa del tope</span>}
                      {!x.activo && <span className="text-tinta-tenue"> (apagado)</span>}
                      {x.evento && x.evento !== e.clave && <span className="text-xs text-oferta"> · hoy de «{x.evento}»</span>}</span>} />
                </li>
              ))}
              {!disponibles[tipo].length && <li className="py-4 text-center text-tinta-tenue">No hay.</li>}
            </ul>
          </div>
        ))}
      </div>
      {operador && <Boton className="mt-4" onClick={() => void guardarVinculos()}>Guardar lo atado</Boton>}
    </Tarjeta>
  );
}
