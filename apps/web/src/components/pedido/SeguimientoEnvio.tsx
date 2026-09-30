import { NOMBRE_ESTADO_ENVIO, type EnvioPublico, type EstadoEnvioTienda } from "@isu/shared";

/*
 * Cómo viene el envío: con qué transporte, el número y el enlace del
 * transporte, y lo que fue pasando (lo más nuevo arriba). Lo usan la página
 * del pedido y la de seguimiento público (enlace del WhatsApp o del mail).
 */
const PASOS: EstadoEnvioTienda[] = ["creado", "en_camino", "en_reparto", "entregado"];
const PASO_DE: Partial<Record<EstadoEnvioTienda, number>> = { creado: 0, en_camino: 1, en_sucursal: 2, en_reparto: 2, no_entregado: 2, entregado: 3 };
const fecha = (iso: string) => new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function SeguimientoEnvio({ envio }: { envio: EnvioPublico }) {
  const actual = envio.estado ?? "creado";
  const paso = PASO_DE[actual] ?? 0;
  const problema = actual === "no_entregado" || actual === "devuelto" || actual === "cancelado";
  const nombres = PASOS.map((p) => (p === "en_reparto" && envio.servicio === "sucursal" ? "En la sucursal" : NOMBRE_ESTADO_ENVIO[p]));
  return (
    <section className="mt-8 rounded-[var(--radius-foto)] border border-linea p-5" aria-labelledby="titulo-envio">
      <h2 id="titulo-envio" className="text-2xl">Tu envío</h2>
      <p className="mt-1 text-sm text-tinta-suave">
        {envio.nombreTransporte}{envio.servicio === "sucursal" ? " · a sucursal" : envio.servicio === "en_el_dia" ? " · en el día" : " · a domicilio"}
        {envio.sucursal && <><br />Retirás en <b>{envio.sucursal.nombre}</b>{envio.sucursal.direccion ? ` (${envio.sucursal.direccion})` : ""}. Llevá tu DNI.</>}
      </p>

      <ol className="mt-5 grid grid-cols-4 gap-1" aria-label="Estado del envío">
        {PASOS.map((p, i) => (
          <li key={p} className="min-w-0" aria-current={i === paso && !problema ? "step" : undefined}>
            <span className={`block h-1.5 rounded-full ${i <= paso && !(problema && i === paso) ? "bg-ahorro" : problema && i === paso ? "bg-oferta" : "bg-linea"}`} />
            <span className={`mt-1.5 block text-[11px] leading-tight sm:text-xs ${i === paso ? "font-bold" : "text-tinta-tenue"}`}>{i === paso && problema ? NOMBRE_ESTADO_ENVIO[actual] : nombres[i]}</span>
          </li>
        ))}
      </ol>

      {envio.seguimiento && (
        <p className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span>Número de seguimiento: <b className="break-all">{envio.seguimiento}</b></span>
          {envio.url && /^https:\/\//.test(envio.url) && <a href={envio.url} target="_blank" rel="noopener noreferrer" className="underline">Ver en {envio.nombreTransporte}</a>}
        </p>
      )}
      {!envio.estado && <p className="mt-5 text-sm text-tinta-suave">Estamos preparando tu paquete. Te avisamos cuando salga.</p>}

      {envio.eventos.length > 0 && (
        <ol className="mt-5 space-y-3 border-l-2 border-linea pl-4 text-sm">
          {envio.eventos.map((e, i) => (
            <li key={`${e.fecha}-${i}`} className="relative">
              <span className={`absolute -left-[23px] top-1 size-3 rounded-full border-2 border-white ${i === 0 ? "bg-tinta" : "bg-linea"}`} aria-hidden="true" />
              <span className="block text-xs text-tinta-tenue">{fecha(e.fecha)}{e.ubicacion ? ` · ${e.ubicacion}` : ""}</span>
              <span className={i === 0 ? "font-bold" : ""}>{e.descripcion}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
