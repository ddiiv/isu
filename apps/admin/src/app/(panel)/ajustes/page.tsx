"use client";
import { useEffect, useState } from "react";
import type { Local } from "@isu/shared";
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
  packs?: number[];
  resenas?: { publicarSolas: boolean; pedirDias: number };
  cuidados?: string;
  cifras?: Array<{ valor: string; texto: string }>;
} & ValoresEnvios;
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
        {v.packs && (
          <Tarjeta titulo="Packs (llevá más, pagá menos)">
            <p className="mb-3 text-sm text-tinta-suave">% de descuento por llevar 2, 3, 4 y 5 unidades de una prenda marcada «Se vende en pack» (cualquier talle y color). No se suma a la rebaja de la prenda: gana el mayor. Con más de 5, vale el de 5.</p>
            <div className="grid grid-cols-4 gap-2">
              {[2, 3, 4, 5].map((n, i) => (
                <Campo key={n} etiqueta={`x${n}`}>
                  <span className="relative block">
                    <input type="number" min={0} max={60} className={`${claseEntrada} pr-7`} value={v.packs![i] ?? 0}
                      onChange={(e) => poner("packs", v.packs!.map((x, j) => (j === i ? Math.max(0, Math.min(60, Math.trunc(Number(e.target.value)) || 0)) : x)))} />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-tinta-tenue">%</span>
                  </span>
                </Campo>
              ))}
            </div>
            {v.packs.some((x, i) => i > 0 && x < v.packs![i - 1]!) && <p className="mt-2 text-sm font-bold text-oferta">Llevando más, el descuento no puede ser menor.</p>}
          </Tarjeta>
        )}
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
