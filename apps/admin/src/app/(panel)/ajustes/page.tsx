"use client";
import { useEffect, useState } from "react";
import { leerPacks, PACK_TOPE, type AjusteDirecciones, type AjustePacks, type Local } from "@isu/shared";
import { api, fecha, useDatos } from "@/lib/api";
import { Boton, Campo, Cargando, Casilla, claseEntrada, EntradaPesos, Mensaje, Tarjeta, Titulo, useAviso } from "@/components/ui";
import { AjustesEnvios, type ValoresEnvios } from "@/components/AjustesEnvios";

/* Ajustes de la tienda (sólo el dueño). Cada campo se valida en la API; los cambios quedan en la auditoría. */
type Valores = Record<string, unknown> & {
  anuncio: string | null; whatsapp: string; email: string | null; descuentoTransferencia: number; cuotasSinInteres: number;
  montoMinimoCarrito: number; envioGratisDesde: number | null; costoEnvio: number; avisoUltimas: number; mostrarAgotados: boolean; publicarNuevos: boolean;
  horasPagoOnline: number; horasPagoFacil: number; horasTransferencia: number; horasPagoLocal: number;
  datosTransferencia: { titular: string; cuit: string; banco: string; cbu: string; alias: string };
  locales: Local[];
  chatbot?: { activo: boolean; saludo: string };
  chatbotIa?: { activo: boolean; topeDiario: number };
  // Etapa 8
  packs?: AjustePacks;
  resenas?: { publicarSolas: boolean; pedirDias: number };
  cuidados?: string;
  cifras?: Array<{ valor: string; texto: string }>;
  // Transferencias que se confirman solas
  transferenciasAuto?: { talo: boolean; mercadoPago: boolean };
  // Etapa 11
  direcciones?: AjusteDirecciones;
} & ValoresEnvios;
type EstadoDirecciones = { google: boolean; georef: boolean; hoy: { sugerencias: number | null; lugares: number | null } };
type EstadoTransferencias = { talo: { prendido: boolean; configurado: boolean }; mercadoPago: { prendido: boolean; configurado: boolean } };
const HORAS: Array<[keyof Valores, string, number, number]> = [
  ["horasPagoOnline", "Mercado Pago (tarjeta)", 1, 72], ["horasPagoFacil", "Pago Fácil / Rapipago", 24, 240],
  ["horasTransferencia", "Transferencia", 2, 240], ["horasPagoLocal", "Pagar al retirar en el local", 24, 720],
];

export default function Ajustes() {
  const { datos, error, recargar } = useDatos<{ ajustes: Array<{ clave: string; valor: unknown; actualizadoPor: string | null; actualizadoEn: string }> }>("ajustes");
  const [v, setV] = useState<Valores | null>(null);
  // Qué tiene credenciales en el servidor (Talo, Mercado Pago).
  const { datos: tr } = useDatos<{ estado: EstadoTransferencias }>("transferencias");
  // Si la clave de Google está en el servidor y cuánto se usó hoy.
  const { datos: dir } = useDatos<EstadoDirecciones>("direcciones");
  const aviso = useAviso();
  const original = datos ? Object.fromEntries(datos.ajustes.map((a) => [a.clave, a.valor])) as Valores : null;
  // Packs: el formato viejo ([x2…x5]) se muestra ya pasado al nuevo (al guardar queda así).
  useEffect(() => { if (original) setV(structuredClone({ ...original, ...(original.packs ? { packs: leerPacks(original.packs) } : {}) })); }, [datos]);
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
            <Campo etiqueta="Costo de envío estándar" ayuda="Si no hay transportes o ninguno responde."><EntradaPesos valor={v.costoEnvio} onChange={(c) => poner("costoEnvio", c ?? 0)} /></Campo>
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
        {v.transferenciasAuto && (
          <Tarjeta titulo="Transferencias que se confirman solas">
            <p className="mb-3 text-xs text-tinta-tenue">El pedido se confirma solo cuando llega la plata, sin esperar el comprobante. Lo que no se pueda asignar solo (por ejemplo, si transfirieron sin los centavos) aparece en Transferencias para asignarlo a mano.</p>
            <div className="space-y-3">
              <Casilla etiqueta="Un CVU por pedido (Talo)"
                ayuda={tr && !tr.estado.talo.configurado
                  ? "Faltan las credenciales de Talo en el servidor (TALO_USER_ID, TALO_CLIENT_ID y TALO_CLIENT_SECRET): mientras tanto se usa lo de abajo."
                  : "Cada pedido tiene su propia cuenta por el monto exacto y Talo avisa al instante. Talo cobra una comisión por cada transferencia."}
                marcada={v.transferenciasAuto.talo} onChange={(x) => poner("transferenciasAuto", { ...v.transferenciasAuto!, talo: x })} />
              <Casilla etiqueta="Mis datos para transferir son de mi cuenta de Mercado Pago"
                ayuda={tr && !tr.estado.mercadoPago.configurado
                  ? "Falta MP_ACCESS_TOKEN en el servidor."
                  : "Cada pedido pide un monto con centavos únicos ($ 45.000,37) y se reconoce entre lo que entra a la cuenta. Recibir transferencias en Mercado Pago no tiene costo."}
                marcada={v.transferenciasAuto.mercadoPago} onChange={(x) => poner("transferenciasAuto", { ...v.transferenciasAuto!, mercadoPago: x })} />
            </div>
            <p className="mt-3 text-xs text-tinta-tenue">Con las dos prendidas va Talo; si Talo no responde, la cuenta de Mercado Pago. Con ninguna, como siempre: se confirma a mano.</p>
          </Tarjeta>
        )}
        {v.direcciones && (() => {
          const d = v.direcciones;
          const tope = (k: "topeSugerencias" | "topeLugares", x: string) => poner("direcciones", { ...d, [k]: Math.max(0, Math.min(5000, Math.trunc(Number(x)) || 0)) });
          const uso = (n: number | null | undefined, t: number) => (n === null || n === undefined ? "" : `Hoy: ${Math.min(n, t)} de ${t}.`);
          return (
            <Tarjeta titulo="Direcciones en el checkout">
              <p className="mb-3 text-xs text-tinta-tenue">Ayudan a que la dirección llegue bien escrita. Si algo no responde o se llega al tope del día, el checkout sigue como siempre: se escribe a mano.</p>
              <div className="space-y-3">
                <Casilla etiqueta="Sugerencias mientras se escribe la calle (Google)"
                  ayuda={dir && !dir.google
                    ? "Falta GOOGLE_MAPS_API_KEY en el servidor: mientras tanto no se muestran."
                    : "Al elegir una, completa número, código postal, localidad y provincia."}
                  marcada={d.google} onChange={(x) => poner("direcciones", { ...d, google: x })} />
                {d.google && (
                  <div className="grid grid-cols-2 gap-3 pl-7">
                    <Campo etiqueta="Tope por día: búsquedas" ayuda={uso(dir?.hoy.sugerencias, d.topeSugerencias)}>
                      <input type="number" min={0} max={5000} className={claseEntrada} value={d.topeSugerencias} onChange={(e) => tope("topeSugerencias", e.target.value)} />
                    </Campo>
                    <Campo etiqueta="Tope por día: direcciones completadas" ayuda={uso(dir?.hoy.lugares, d.topeLugares)}>
                      <input type="number" min={0} max={5000} className={claseEntrada} value={d.topeLugares} onChange={(e) => tope("topeLugares", e.target.value)} />
                    </Campo>
                    <p className="col-span-2 text-xs text-tinta-tenue">Google da gratis 10.000 de cada cosa por mes. Con 300 por día no se pasa nunca. Si los subís, pasado lo gratis cuesta unos USD 5 cada 1.000 direcciones completadas y USD 2,83 cada 1.000 búsquedas que no terminan en una dirección elegida. Al llegar al tope, ese día se escribe a mano.</p>
                  </div>
                )}
                <Casilla etiqueta="Revisar que la calle y la altura existan (Georef, gratis)"
                  ayuda={dir && !dir.georef
                    ? "Apagado en el servidor (GEOREF_URL=off)."
                    : "Servicio del Gobierno, sin costo. Si no encuentra la calle o la altura, avisa; si está escrita distinto, propone la oficial. Nunca frena la compra."}
                  marcada={d.georef} onChange={(x) => poner("direcciones", { ...d, georef: x })} />
              </div>
            </Tarjeta>
          );
        })()}
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
        {v.packs && (() => {
          const pk = v.packs;
          // Cambiar el rango conserva el % de las cantidades que siguen; las nuevas arrancan con el del extremo más cercano.
          const rango = (minimo: number, maximo: number) => {
            const pctDe = (q: number) => pk.porcentajes[Math.min(Math.max(q, pk.minimo), pk.maximo) - pk.minimo] ?? 0;
            poner("packs", { minimo, maximo, porcentajes: Array.from({ length: maximo - minimo + 1 }, (_, i) => pctDe(minimo + i)) });
          };
          const entero = (x: string, min: number, max: number) => Math.max(min, Math.min(max, Math.trunc(Number(x)) || min));
          return (
            <Tarjeta titulo="Packs (llevá más, pagá menos)">
              <p className="mb-3 text-sm text-tinta-suave">Una prenda marcada «Se vende en pack» se arma de un mínimo a un máximo de unidades, cada una con su talle y su color (siempre con el stock que hay de cada variante). El % sale de cuántas prendas lleva el pack. En el carrito el pack va aparte: las prendas sueltas, aunque sean la misma, van a su precio. No se suma a la rebaja de la prenda: gana el mayor.</p>
              <div className="flex flex-wrap gap-3">
                <Campo etiqueta="Mínimo"><input type="number" min={2} max={pk.maximo} className={`${claseEntrada} w-24`} value={pk.minimo} onChange={(e) => rango(entero(e.target.value, 2, pk.maximo), pk.maximo)} /></Campo>
                <Campo etiqueta="Máximo"><input type="number" min={pk.minimo} max={PACK_TOPE} className={`${claseEntrada} w-24`} value={pk.maximo} onChange={(e) => rango(pk.minimo, entero(e.target.value, pk.minimo, PACK_TOPE))} /></Campo>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
                {pk.porcentajes.map((x, i) => (
                  <Campo key={pk.minimo + i} etiqueta={`x${pk.minimo + i}`}>
                    <span className="relative block">
                      <input type="number" min={0} max={60} className={`${claseEntrada} pr-7`} value={x}
                        onChange={(e) => poner("packs", { ...pk, porcentajes: pk.porcentajes.map((y, j) => (j === i ? entero(e.target.value, 0, 60) : y)) })} />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-tinta-tenue">%</span>
                    </span>
                  </Campo>
                ))}
              </div>
              {pk.porcentajes.some((x, i) => i > 0 && x < pk.porcentajes[i - 1]!) && <p className="mt-2 text-sm font-bold text-oferta">Llevando más, el descuento no puede ser menor.</p>}
            </Tarjeta>
          );
        })()}
        {v.resenas && (
          <Tarjeta titulo="Reseñas">
            <div className="space-y-3">
              <Campo etiqueta="Pedir la opinión a los … días de entregado" ayuda="Un mail con estrellas para tocar. Sale una sola vez por pedido.">
                <input type="number" min={1} max={60} className={`${claseEntrada} w-28`} value={v.resenas.pedirDias} onChange={(e) => poner("resenas", { ...v.resenas!, pedirDias: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })} />
              </Campo>
              <Casilla etiqueta="Publicarlas sin revisar" ayuda="Apagado: entran a Reseñas → Por revisar y se publican desde ahí." marcada={v.resenas.publicarSolas} onChange={(x) => poner("resenas", { ...v.resenas!, publicarSolas: x })} />
            </div>
          </Tarjeta>
        )}
        {v.cuidados !== undefined && (
          <Tarjeta titulo="Ficha de producto">
            <Campo etiqueta="Cuidados de las prendas" ayuda="Se ven en todas las fichas, en «Composición y cuidados». Hasta 600 caracteres.">
              <textarea className={claseEntrada} rows={3} maxLength={600} value={v.cuidados} onChange={(e) => poner("cuidados", e.target.value)} />
            </Campo>
          </Tarjeta>
        )}
        {v.cifras && (
          <Tarjeta titulo="Números de la marca (inicio)" acciones={v.cifras.length < 4 ? <Boton variante="borde" onClick={() => poner("cifras", [...v.cifras!, { valor: "", texto: "" }])}>+ Número</Boton> : undefined}>
            <p className="mb-3 text-sm text-tinta-suave">Hasta 4, sólo datos ciertos («+10 años · diseñando y fabricando», «+5.000 · pedidos entregados»). El promedio de las reseñas y los locales se suman solos.</p>
            <ul className="space-y-2">
              {v.cifras.map((c, i) => (
                <li key={i} className="grid grid-cols-[7rem_1fr_auto] gap-2">
                  <input className={claseEntrada} maxLength={20} placeholder="+10 años" aria-label="Número" value={c.valor} onChange={(e) => poner("cifras", v.cifras!.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)))} />
                  <input className={claseEntrada} maxLength={60} placeholder="diseñando y fabricando" aria-label="Qué es" value={c.texto} onChange={(e) => poner("cifras", v.cifras!.map((x, j) => (j === i ? { ...x, texto: e.target.value } : x)))} />
                  <button type="button" className="px-2 text-oferta" aria-label="Sacar" onClick={() => poner("cifras", v.cifras!.filter((_, j) => j !== i))}>✕</button>
                </li>
              ))}
            </ul>
          </Tarjeta>
        )}
        <AjustesEnvios v={v} poner={(k, x) => setV({ ...v, [k]: x } as Valores)} />
        {v.chatbot && (
          <Tarjeta titulo="Asistente de la tienda">
            <div className="space-y-3">
              <Casilla etiqueta="Mostrar el asistente (burbuja de chat)" ayuda="Apagado, la burbuja es el botón de WhatsApp." marcada={v.chatbot.activo} onChange={(x) => poner("chatbot", { ...v.chatbot!, activo: x })} />
              <Campo etiqueta="Saludo" ayuda="Lo primero que dice. Hasta 200 caracteres."><textarea className={claseEntrada} rows={2} maxLength={200} value={v.chatbot.saludo} onChange={(e) => poner("chatbot", { ...v.chatbot!, saludo: e.target.value })} /></Campo>
              {v.chatbotIa && (
                <>
                  <Casilla etiqueta="Responder con IA lo que no está en las preguntas frecuentes" ayuda="Necesita ANTHROPIC_API_KEY en el servidor. Tiene costo por consulta: el tope lo limita." marcada={v.chatbotIa.activo} onChange={(x) => poner("chatbotIa", { ...v.chatbotIa!, activo: x })} />
                  <Campo etiqueta="Tope de consultas con IA por día"><input type="number" min={0} max={20000} className={`${claseEntrada} w-32`} value={v.chatbotIa.topeDiario} onChange={(e) => poner("chatbotIa", { ...v.chatbotIa!, topeDiario: Number(e.target.value) || 0 })} /></Campo>
                </>
              )}
            </div>
          </Tarjeta>
        )}
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
