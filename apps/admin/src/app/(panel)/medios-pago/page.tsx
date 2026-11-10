"use client";
import { useEffect, useState } from "react";
import { MEDIOS_PAGO, type MedioPago } from "@isu/shared";
import { api, useDatos } from "@/lib/api";
import { Boton, Campo, Cargando, Casilla, claseEntrada, Insignia, Mensaje, Tarjeta, Titulo, useAviso } from "@/components/ui";
import { puede, useYo } from "@/components/Marco";

/*
 * Medios de pago: qué ofrece la tienda, qué le falta a cada uno y sus ajustes (antes en Ajustes).
 * Todos ven el estado; guardar es sólo del dueño (como Ajustes). Los pedidos ya hechos con un medio apagado siguen su curso.
 */
interface Estado {
  mercadopago: { credencial: boolean; webhook: boolean };
  transferencia: { datos: boolean };
  local: { locales: boolean };
  apagados: MedioPago[];
}
type EstadoTransferencias = { talo: { prendido: boolean; configurado: boolean }; mercadoPago: { prendido: boolean; configurado: boolean } };
type Valores = {
  descuentoTransferencia: number; cuotasSinInteres: number;
  horasPagoOnline: number; horasPagoFacil: number; horasTransferencia: number; horasPagoLocal: number;
  datosTransferencia: { titular: string; cuit: string; banco: string; cbu: string; alias: string };
  transferenciasAuto?: { talo: boolean; mercadoPago: boolean };
  mediosPagoApagados?: MedioPago[];
};
const CLAVES: Array<keyof Valores> = ["descuentoTransferencia", "cuotasSinInteres", "horasPagoOnline", "horasPagoFacil", "horasTransferencia", "horasPagoLocal", "datosTransferencia", "transferenciasAuto", "mediosPagoApagados"];
// Hasta 7 días (168 h): después Stocker libera sola la mercadería que no se cobró.
const HORAS: Record<MedioPago, [keyof Valores, number, number]> = {
  mercadopago: ["horasPagoOnline", 1, 72], pagofacil: ["horasPagoFacil", 24, 168], transferencia: ["horasTransferencia", 2, 168], local: ["horasPagoLocal", 24, 168],
};
const NOMBRE: Record<MedioPago, string> = {
  mercadopago: "Mercado Pago (tarjeta y dinero en cuenta)", pagofacil: "Pago Fácil / Rapipago (sale por Mercado Pago)",
  transferencia: "Transferencia", local: "Pago al retirar en el local",
};
const CREDENCIAL = "falta la credencial de Mercado Pago en Railway (MP_ACCESS_TOKEN)";

/** Lo que falta (el medio no se ofrece) y lo que conviene avisar (se ofrece igual) de cada medio. */
function faltas(m: MedioPago, e: Estado): { faltan: string[]; avisos: string[] } {
  if (m === "mercadopago" || m === "pagofacil") {
    return {
      faltan: e.mercadopago.credencial ? [] : [CREDENCIAL],
      avisos: e.mercadopago.credencial && !e.mercadopago.webhook ? ["falta MP_WEBHOOK_SECRET en Railway: los pagos no se confirman solos y hay que confirmarlos a mano"] : [],
    };
  }
  if (m === "transferencia") return { faltan: e.transferencia.datos ? [] : ["faltan los datos para transferir (CBU o alias)"], avisos: [] };
  return { faltan: e.local.locales ? [] : ["no hay locales cargados para retirar (Ajustes → Locales)"], avisos: [] };
}

export default function MediosPago() {
  const yo = useYo();
  const dueno = puede(yo, "dueno");
  const { datos: est, error, recargar: recargarEstado } = useDatos<Estado>("medios-pago");
  // Los ajustes son sólo del dueño: para los demás la página es de lectura.
  const { datos, recargar } = useDatos<{ ajustes: Array<{ clave: string; valor: unknown }> }>(dueno ? "ajustes" : null);
  // Qué tiene credenciales en el servidor (Talo, Mercado Pago).
  const { datos: tr } = useDatos<{ estado: EstadoTransferencias }>("transferencias");
  const [v, setV] = useState<Valores | null>(null);
  const aviso = useAviso();
  const original = datos ? Object.fromEntries(datos.ajustes.map((a) => [a.clave, a.valor])) as Partial<Valores> : null;
  useEffect(() => {
    if (!original) return;
    const x = structuredClone(Object.fromEntries(CLAVES.filter((k) => original[k] !== undefined).map((k) => [k, original[k]]))) as Valores;
    // Un plazo guardado antes del tope de Stocker se muestra (y se guarda) con el tope.
    for (const [k, , max] of Object.values(HORAS)) if (typeof x[k] === "number") (x as Record<string, unknown>)[k] = Math.min(max, x[k] as number);
    x.mediosPagoApagados ??= [];
    setV(x);
  }, [datos]);
  if (error) return <Mensaje>{error}</Mensaje>;
  if (!est || (dueno && (!v || !original))) return <Cargando />;
  const poner = <K extends keyof Valores>(k: K, x: Valores[K]) => setV({ ...v!, [k]: x });
  const apagados = v?.mediosPagoApagados ?? est.apagados;
  const todosApagados = MEDIOS_PAGO.every((m) => apagados.includes(m));
  const t = v?.datosTransferencia ?? { titular: "", cuit: "", banco: "", cbu: "", alias: "" };

  async function guardar() {
    if (todosApagados) return aviso.error(new Error("Tiene que quedar al menos un medio de pago ofrecido."));
    const cambios = Object.fromEntries(Object.entries(v!).filter(([k, x]) => JSON.stringify(x) !== JSON.stringify(original![k as keyof Valores])));
    if (!Object.keys(cambios).length) return aviso.ok("No hay cambios.");
    try { await api("ajustes", { metodo: "PUT", cuerpo: cambios }); aviso.ok("Guardado. La tienda lo muestra en un minuto."); await Promise.all([recargar(), recargarEstado()]); } catch (e) { aviso.error(e); }
  }

  const plazo = (m: MedioPago) => {
    const [k, min, max] = HORAS[m];
    return (
      <Campo etiqueta="Tiempo para pagar (horas)" ayuda="Mientras tanto la mercadería queda apartada en Stocker; si no paga, se libera sola. Hasta 7 días (168 h).">
        <input type="number" min={min} max={max} disabled={!dueno} className={`${claseEntrada} w-28`} value={(v?.[k] as number | undefined) ?? ""} onChange={(x) => poner(k, (Number(x.target.value) || min) as never)} />
      </Campo>
    );
  };
  const extra: Record<MedioPago, React.ReactNode> = {
    mercadopago: (
      <>
        <Campo etiqueta="Cuotas sin interés"><input type="number" min={1} max={24} disabled={!dueno} className={`${claseEntrada} w-28`} value={v?.cuotasSinInteres ?? ""} onChange={(e) => poner("cuotasSinInteres", Number(e.target.value) || 1)} /></Campo>
        {plazo("mercadopago")}
        <p className="rounded-xl bg-fondo-suave p-3 text-xs text-tinta-suave">Mercado Pago cobra una comisión por cada venta. No se puede cobrar un recargo por pagar con tarjeta (Ley 25.065, art. 37). Para cubrirla: el precio de lista ya la incluye y la transferencia tiene su % OFF. Cobrar a 10, 18 o 35 días en vez de al instante baja la comisión (se elige en tu cuenta de Mercado Pago).</p>
      </>
    ),
    pagofacil: plazo("pagofacil"),
    local: plazo("local"),
    transferencia: (
      <>
        <Campo etiqueta="% OFF con transferencia"><input type="number" min={0} max={100} disabled={!dueno} className={`${claseEntrada} w-28`} value={v?.descuentoTransferencia ?? ""} onChange={(e) => poner("descuentoTransferencia", Number(e.target.value) || 0)} /></Campo>
        {plazo("transferencia")}
        <fieldset className="space-y-3">
          <legend className="mb-1 text-sm font-bold">Datos para transferir</legend>
          <p className="text-xs text-tinta-tenue">Sin CBU o alias, la tienda no ofrece transferencia. Revisalos bien: es donde te pagan.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {([["titular", "Titular"], ["cuit", "CUIT"], ["banco", "Banco"], ["cbu", "CBU / CVU (22 números)"], ["alias", "Alias"]] as const).map(([k, e]) => (
              <Campo key={k} etiqueta={e}><input disabled={!dueno} className={claseEntrada} value={t[k]} onChange={(x) => poner("datosTransferencia", { ...t, [k]: x.target.value })} /></Campo>
            ))}
          </div>
        </fieldset>
        {v?.transferenciasAuto && (
          <fieldset className="space-y-3">
            <legend className="mb-1 text-sm font-bold">Transferencias que se confirman solas</legend>
            <p className="text-xs text-tinta-tenue">El pedido se confirma solo cuando llega la plata, sin esperar el comprobante. Lo que no se pueda asignar solo (por ejemplo, si transfirieron sin los centavos) aparece en Transferencias para asignarlo a mano.</p>
            <Casilla etiqueta="Un CVU por pedido (Talo)" disabled={!dueno}
              ayuda={tr && !tr.estado.talo.configurado
                ? "Faltan las credenciales de Talo en el servidor (TALO_USER_ID, TALO_CLIENT_ID y TALO_CLIENT_SECRET): mientras tanto se usa lo de abajo."
                : "Cada pedido tiene su propia cuenta por el monto exacto y Talo avisa al instante. Talo cobra una comisión por cada transferencia."}
              marcada={v.transferenciasAuto.talo} onChange={(x) => poner("transferenciasAuto", { ...v.transferenciasAuto!, talo: x })} />
            <Casilla etiqueta="Mis datos para transferir son de mi cuenta de Mercado Pago" disabled={!dueno}
              ayuda={tr && !tr.estado.mercadoPago.configurado
                ? "Falta MP_ACCESS_TOKEN en el servidor."
                : "Cada pedido pide un monto con centavos únicos ($ 45.000,37) y se reconoce entre lo que entra a la cuenta. Recibir transferencias en Mercado Pago no tiene costo."}
              marcada={v.transferenciasAuto.mercadoPago} onChange={(x) => poner("transferenciasAuto", { ...v.transferenciasAuto!, mercadoPago: x })} />
            <p className="text-xs text-tinta-tenue">Con las dos prendidas va Talo; si Talo no responde, la cuenta de Mercado Pago. Con ninguna, como siempre: se confirma a mano.</p>
          </fieldset>
        )}
      </>
    ),
  };

  return (
    <>
      <Titulo acciones={dueno ? <Boton onClick={() => void guardar()} disabled={todosApagados}>Guardar</Boton> : undefined}>Medios de pago</Titulo>
      <div className="mb-4 space-y-2">
        <aviso.Aviso />
        {todosApagados && <p role="alert" className="text-sm font-bold text-oferta">Tiene que quedar al menos un medio de pago ofrecido.</p>}
        {!dueno && <p className="text-xs text-tinta-tenue">Sólo el dueño puede cambiar los medios de pago.</p>}
        <p className="text-xs text-tinta-tenue">Apagar un medio lo saca del carrito y del checkout. Los pedidos que ya se hicieron con ese medio siguen: se pueden pagar y confirmar igual.</p>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {MEDIOS_PAGO.map((m) => {
          const apagado = est.apagados.includes(m);
          const { faltan, avisos } = faltas(m, est);
          const [texto, clase] = apagado ? ["Apagado", "bg-fondo-suave text-tinta-suave"]
            : faltan.length ? [`Falta configurar: ${faltan.join("; ")}`, "bg-red-50 text-oferta"]
            : ["Activo en la tienda", "bg-ahorro-claro text-ahorro"];
          return (
            <Tarjeta key={m} titulo={NOMBRE[m]} acciones={<Insignia clase={`!whitespace-normal ${clase}`}>{texto}</Insignia>}>
              <div className="space-y-3">
                {!apagado && avisos.map((a) => <p key={a} className="text-xs font-bold text-oferta">Ojo: {a}.</p>)}
                {v && (
                  <Casilla etiqueta={<>Ofrecer en la tienda<span className="sr-only"> ({NOMBRE[m]})</span></>} disabled={!dueno}
                    marcada={!apagados.includes(m)}
                    onChange={(x) => poner("mediosPagoApagados", x ? apagados.filter((y) => y !== m) : [...apagados, m])} />
                )}
                {v && extra[m]}
              </div>
            </Tarjeta>
          );
        })}
      </div>
    </>
  );
}
