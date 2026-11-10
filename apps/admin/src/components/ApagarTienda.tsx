"use client";
import { useEffect, useState } from "react";
import { TIENDA_CERRADA_DE_FABRICA, type TiendaCerrada } from "@isu/shared";
import { Boton, Campo, claseEntrada, Tarjeta, useAviso } from "@/components/ui";
import { useTienda } from "@/components/Marco";

/*
 * Apagar la tienda un rato, con un aviso propio (sólo el dueño: es un ajuste más).
 * Apagada, la tienda muestra este aviso en vez de las páginas de compra y la API
 * no deja crear pedidos nuevos. Siguen andando los pedidos ya hechos (pago,
 * seguimiento, arrepentimiento) y las páginas legales. Se prende con un clic,
 * acá o desde el aviso fijo que el marco muestra en todas las pantallas.
 */
export function ApagarTienda() {
  const { tienda, guardar } = useTienda();
  const [t, setT] = useState<TiendaCerrada>(TIENDA_CERRADA_DE_FABRICA);
  const aviso = useAviso();
  useEffect(() => { if (tienda) setT(tienda); }, [tienda]);
  if (!tienda) return null;

  const apagada = tienda.activa;
  const sinTexto = !t.titulo.trim() || !t.mensaje.trim();
  const sinGuardar = apagada && JSON.stringify({ ...t, activa: true }) !== JSON.stringify(tienda);
  async function enviar(activa: boolean) {
    if (activa && !apagada && !window.confirm("¿Apagar la tienda? Nadie va a poder comprar hasta que la vuelvas a prender.")) return;
    try {
      await guardar({ ...t, activa });
      aviso.ok(activa ? "Tienda apagada. Los clientes ven el aviso en unos segundos." : "Tienda prendida. Los clientes vuelven a comprar en unos segundos.");
    } catch (e) { aviso.error(e); }
  }

  return (
    <Tarjeta titulo="Apagar la tienda" className={`lg:col-span-2 ${apagada ? "ring-2 ring-amber-400" : ""}`}>
      <p className="mb-3 text-sm text-tinta-suave">
        {apagada
          ? "La tienda está apagada: los clientes ven este aviso y no pueden comprar. Los pedidos ya hechos siguen andando (pago, seguimiento, arrepentimiento)."
          : "Para hacer cambios sin que nadie compre en el medio. Los clientes ven el aviso de abajo; los pedidos ya hechos siguen andando."}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Título" ayuda="Hasta 80 caracteres."><input maxLength={80} className={claseEntrada} value={t.titulo} onChange={(e) => setT({ ...t, titulo: e.target.value })} /></Campo>
        <Campo etiqueta="Cuándo vuelve (opcional)" ayuda="Texto libre: «Volvemos el lunes 9 hs». Hasta 80 caracteres."><input maxLength={80} className={claseEntrada} value={t.vuelve} onChange={(e) => setT({ ...t, vuelve: e.target.value })} /></Campo>
        <Campo className="sm:col-span-2" etiqueta="Mensaje" ayuda="Hasta 500 caracteres."><textarea rows={3} maxLength={500} className={claseEntrada} value={t.mensaje} onChange={(e) => setT({ ...t, mensaje: e.target.value })} /></Campo>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {apagada ? (
          <>
            <Boton disabled={sinTexto} onClick={() => void enviar(false)}>Prender la tienda</Boton>
            {sinGuardar && <Boton variante="borde" disabled={sinTexto} onClick={() => void enviar(true)}>Guardar el aviso</Boton>}
          </>
        ) : (
          <Boton variante="peligro" disabled={sinTexto} onClick={() => void enviar(true)}>Apagar la tienda</Boton>
        )}
        {sinTexto && <span className="text-sm font-bold text-oferta">Escribí el título y el mensaje.</span>}
      </div>
      <div className="mt-3"><aviso.Aviso /></div>
    </Tarjeta>
  );
}
