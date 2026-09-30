import type pg from "pg";
import type { Redis } from "ioredis";
import { formatearPesos, NOMBRE_ESTADO_ENVIO, type MensajeChat, type RespuestaChat, type TemaChat } from "@isu/shared";
import { firmaSeguimiento, type Transportes } from "@isu/envios";
import type { CacheCorta } from "../../lib/cache.js";
import type { Descuentos } from "../../lib/descuentos.js";
import { ErrorHttp } from "../../lib/errores.js";
import { frenar } from "../../lib/frenos.js";
import { buscar, tarjetas } from "../productos/consultas.js";
import type { CotizadorEnvios } from "../envios/cotizador.js";
import { envioPublico } from "../envios/publico.js";
import type { Ia } from "./ia.js";
import { alcanza, codigoPostal, indexar, mejores, normalizar, raices, rellenar, tachar } from "./texto.js";

/*
 * El asistente de la tienda. En orden:
 *   1. Lo que se resuelve con datos de verdad: cuánto sale el envío a un CP
 *      (cotiza con los transportes), cómo viene un pedido (número + email),
 *      pasar con una persona (WhatsApp).
 *   2. Las preguntas frecuentes del backoffice (las respuestas son siempre
 *      las que escribió la tienda).
 *   3. Productos ("¿tienen buzos?").
 *   4. Si está prendida, la IA, con la información de la tienda.
 *   5. Si no, lo dice, lo anota (sin datos personales) y ofrece WhatsApp.
 */
export interface DepsAsistente {
  pool: pg.Pool; redis: Redis; cache: CacheCorta; cotizador: CotizadorEnvios; transportes: Transportes; descuentos: Descuentos;
  ia: Ia | null; secreto: string | undefined; log: { warn: (o: object, m: string) => void };
}

interface Faq { id: number; pregunta: string; respuesta: string; palabras: string; tema: TemaChat; enlace_texto: string | null; enlace_url: string | null; orden: number }
interface Local { nombre: string; direccion: string; localidad: string; horario: string; retiro: boolean }

const SUGERENCIAS = ["¿Cuánto sale el envío?", "¿Cómo sé mi talle?", "¿Dónde está mi pedido?", "¿Qué medios de pago aceptan?"];
const HUMANO = /\b(humano|persona|asesor|asesora|atencion al cliente|hablar con alguien|operador|operadora|vendedor|vendedora|whats?app|wpp|wsp)\b/;
// Un pedido: con su número, o hablando del pedido y de dónde/cómo viene ("¿dónde está mi compra?").
const NUMERO_PEDIDO = /\bisu ?-? ?\d{4,10}\b/;
const PEDIDO = /\b(pedido|compra|orden|paquete)\b/;
const ESTADO_PEDIDO = /\b(donde|estado|llego|llega|viene|anda|segui\w*|sigo|rastre\w*|cuando|salio|despach\w*|todavia)\b/;
// Un número de 4 cifras es un CP sólo si habla de envíos ("¿remeras de 5000?" no).
const ENVIO = /\b(envi\w*|mand\w*|llega\w*|flete|correo|cp|codigo postal)\b/;
const SALUDO = /^(hola|buenas|buen dia|buenos dias|buenas tardes|buenas noches|hey|holis)\b/;
const GRACIAS = /^(gracias|muchas gracias|genial|perfecto|dale|ok|joya|listo)\b/;
const PRODUCTO = /\b(tienen|tenes|hay|venden|vendes|busco|buscando|quiero|stock de|tenian)\b/;

export function crearAsistente(d: DepsAsistente) {
  const ahoraAr = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });

  /* Preguntas frecuentes indexadas + los datos de Ajustes (caché corta; el backoffice la limpia al editar). */
  const base = () => d.cache.obtener("chat:base", async () => {
    const [faqs, aj] = await Promise.all([
      d.pool.query<Faq>("SELECT id, pregunta, respuesta, palabras, tema, enlace_texto, enlace_url, orden FROM tienda.faq WHERE activo ORDER BY orden, id"),
      d.pool.query<{ clave: string; valor: unknown }>(
        "SELECT clave, valor FROM tienda.ajustes WHERE clave = ANY($1::text[])",
        [["chatbot", "chatbotIa", "descuentoTransferencia", "cuotasSinInteres", "envioGratisDesde", "whatsapp", "locales", "enviosEnElDia"]]),
    ]);
    const a = Object.fromEntries(aj.rows.map((r) => [r.clave, r.valor])) as Record<string, unknown>;
    const chatbot = (a.chatbot ?? { activo: false, saludo: "" }) as { activo: boolean; saludo: string };
    const chatbotIa = (a.chatbotIa ?? { activo: false, topeDiario: 0 }) as { activo: boolean; topeDiario: number };
    const whatsapp = typeof a.whatsapp === "string" && /^\d{10,15}$/.test(a.whatsapp) ? a.whatsapp : "5491168515444";
    const locales = (Array.isArray(a.locales) ? a.locales : []) as Local[];
    const envioGratis = typeof a.envioGratisDesde === "number" ? formatearPesos(a.envioGratisDesde) : null;
    const vars: Record<string, string> = {
      descuento: String(typeof a.descuentoTransferencia === "number" ? a.descuentoTransferencia : 20),
      cuotas: String(typeof a.cuotasSinInteres === "number" ? a.cuotasSinInteres : 3),
      envioGratis: envioGratis ?? "el monto que figure en la tienda",
      whatsapp: `+${whatsapp.replace(/^549?(\d{2})(\d{4})(\d{4})$/, "54 9 $1 $2-$3")}`,
      horaCorte: ((a.enviosEnElDia as { horaCorte?: string } | undefined)?.horaCorte) ?? "14:00",
      locales: locales.length
        ? locales.map((l) => `${l.nombre}: ${l.direccion}, ${l.localidad} (${l.horario}).`).join(" ")
        : "Por ahora vendemos sólo online.",
    };
    const indexadas = faqs.rows.map((f) => indexar(f));
    // Lo que sabe la IA: lo mismo que la tienda publica (y siempre en el mismo orden: se cachea).
    const contextoIa = [
      `Medios de pago: Mercado Pago (tarjeta de crédito y débito, hasta ${vars.cuotas} cuotas sin interés), Pago Fácil / Rapipago, transferencia (${vars.descuento}% OFF) y pago al retirar en el local.`,
      `Envíos a todo el país con Correo Argentino, Andreani y OCA (domicilio o sucursal), Mercado Envíos y, en CABA, en el día. El precio sale del código postal en el checkout.${envioGratis ? ` Envío gratis desde ${envioGratis}.` : ""}`,
      `Locales: ${vars.locales}`,
      `WhatsApp de atención: ${vars.whatsapp}.`,
      "Cambios: 30 días, prenda sin uso y con etiquetas, gratis en el local. Arrepentimiento: 10 días corridos desde que se recibe, sin costo, desde el Botón de arrepentimiento. Prenda con falla: sin costo, escribir por WhatsApp con foto.",
      "Preguntas frecuentes:",
      ...faqs.rows.map((f) => `P: ${f.pregunta}\nR: ${rellenar(f.respuesta, vars)}`),
    ].join("\n");
    return { chatbot, chatbotIa, whatsapp, vars, faqs: indexadas, contextoIa };
  });

  const enlaceWhatsapp = (numero: string, texto?: string) =>
    ({ texto: "Hablar por WhatsApp", url: `https://wa.me/${numero}?text=${encodeURIComponent(`Hola Isuwaya! ${texto ? `Tengo una consulta: ${tachar(texto).slice(0, 150)}` : "Tengo una consulta."}`)}` });

  /*
   * Contadores (temas del día y veces que se usó cada pregunta): se suman en
   * memoria y se guardan de a tandas cada 10 s. Sumar en la misma fila en
   * cada consulta haría cola de bloqueos en la base compartida en un pico.
   */
  const temas = new Map<string, number>();
  const usos = new Map<number, number>();
  const anotarTema = (tema: string) => temas.set(tema, (temas.get(tema) ?? 0) + 1);
  const anotarUso = (id: number) => usos.set(id, (usos.get(id) ?? 0) + 1);
  async function guardarContadores() {
    const t = [...temas]; temas.clear();
    const u = [...usos]; usos.clear();
    const dia = ahoraAr();
    if (t.length) {
      await d.pool.query(
        `INSERT INTO tienda.chat_temas (dia, tema, veces) SELECT $1, * FROM unnest($2::text[], $3::int[])
         ON CONFLICT (dia, tema) DO UPDATE SET veces = tienda.chat_temas.veces + EXCLUDED.veces`,
        [dia, t.map(([k]) => k), t.map(([, v]) => v)]).catch((e) => d.log.warn({ err: (e as Error).message }, "no se guardaron los temas del asistente"));
    }
    if (u.length) {
      await d.pool.query(
        "UPDATE tienda.faq f SET veces = f.veces + x.n FROM unnest($1::int[], $2::int[]) AS x(id, n) WHERE f.id = x.id",
        [u.map(([k]) => k), u.map(([, v]) => v)]).catch(() => {});
    }
  }
  const reloj = setInterval(() => void guardarContadores(), 10_000);
  reloj.unref();
  async function anotarSinRespuesta(mensaje: string) {
    const ejemplo = tachar(mensaje);
    const clave = raices(ejemplo).sort().join(" ").slice(0, 200);
    if (!clave) return;
    await d.pool.query(
      `INSERT INTO tienda.chat_sin_respuesta (clave, ejemplo) VALUES ($1, $2)
       ON CONFLICT (clave) DO UPDATE SET veces = tienda.chat_sin_respuesta.veces + 1, ultimo = now(), resuelta = false`, [clave, ejemplo]).catch(() => {});
    // Se guardan 90 días (una limpieza por hora como mucho, en cualquier réplica).
    if (await d.redis.set("isu:chat:limpieza", "1", "EX", 3600, "NX").catch(() => null) === "OK") {
      await d.pool.query("DELETE FROM tienda.chat_sin_respuesta WHERE ultimo < now() - interval '90 days'").catch(() => {});
    }
  }

  async function cotizarEnvio(cp: string, ip: string, b: Awaited<ReturnType<typeof base>>): Promise<RespuestaChat> {
    await frenar(d.redis, "envios-ip", ip, 120, 600);
    // Una prenda de peso normal: el precio real sale del carrito en el checkout.
    const r = await d.cotizador.opciones({
      destino: { cp, provincia: "", localidad: "" },
      carrito: { lineas: [{ sku: "_chat", cantidad: 1, subtotal: 0 }], filas: new Map(), neto: 0 },
    }).catch(() => null);
    const opciones = (r?.opciones ?? []).slice(0, 5);
    if (!opciones.length) {
      return { texto: `No pude cotizar el envío al ${cp} en este momento. En el checkout lo ves con tu carrito, o escribinos por WhatsApp.`, tema: "envios", enlaces: [enlaceWhatsapp(b.whatsapp)], sugerencias: [] };
    }
    const gratis = b.vars.envioGratis && !b.vars.envioGratis.startsWith("el monto") ? ` Desde ${b.vars.envioGratis} el envío es gratis.` : "";
    return {
      texto: `Para una prenda al código postal ${cp}, estas son las opciones.${gratis} El precio final lo ves en el checkout con tu carrito.`,
      tema: "envios",
      opcionesEnvio: opciones.map((o) => ({ nombre: o.nombre, detalle: o.detalle, precio: o.precio, gratis: o.gratis })),
      enlaces: [], sugerencias: ["¿Cuánto tarda en llegar?", "¿Puedo retirar en el local?"],
    };
  }

  /** `prueba`: desde el backoffice ("probá una pregunta"): no suma estadísticas ni anota lo sin respuesta. */
  async function responder(m: MensajeChat, ip: string, opciones: { prueba?: boolean } = {}): Promise<RespuestaChat> {
    const b = await base();
    const prueba = opciones.prueba === true;
    if (!b.chatbot.activo) throw new ErrorHttp(503, "chat_apagado", "El asistente no está disponible. Escribinos por WhatsApp.");
    const n = normalizar(m.mensaje);
    const cons = raices(m.mensaje);
    const r = await elegir();
    if (!prueba) anotarTema(r.tema);
    return r;

    async function elegir(): Promise<RespuestaChat> {
      const cp = codigoPostal(n);
      // Esperaba el CP (o lo preguntó junto con el envío): se cotiza de verdad.
      if (cp && (m.esperando === "cp" || ENVIO.test(n))) return cotizarEnvio(cp, ip, b);
      if (HUMANO.test(n)) {
        return { texto: `Te paso con una persona por WhatsApp (${b.vars.whatsapp}). Contanos tu consulta y el número de pedido si tenés.`, tema: "humano", enlaces: [enlaceWhatsapp(b.whatsapp, m.mensaje)], sugerencias: [] };
      }
      if (NUMERO_PEDIDO.test(n) || (PEDIDO.test(n) && ESTADO_PEDIDO.test(n))) {
        return {
          texto: "Te busco el pedido. Poné el número (está en el mail de confirmación, empieza con ISU-) y el email con el que compraste.",
          tema: "pedidos", esperando: "pedido", enlaces: [], sugerencias: [],
        };
      }
      if (!cons.length && SALUDO.test(n)) return { texto: b.chatbot.saludo, tema: "saludo", enlaces: [], sugerencias: SUGERENCIAS };
      if (!cons.length && GRACIAS.test(n)) return { texto: "¡De nada! Si necesitás algo más, preguntame.", tema: "saludo", enlaces: [], sugerencias: [] };
      if (m.esperando === "cp") {
        return { texto: "Pasame el código postal (los 4 números, por ejemplo 5000) y te digo cuánto sale.", tema: "envios", esperando: "cp", enlaces: [], sugerencias: [] };
      }

      const top = mejores(cons, b.faqs, 4);
      const [primera] = top;
      if (primera && alcanza(top)) {
        const f = primera.f;
        if (!prueba) anotarUso(f.id);
        const enlaces = f.enlace_texto && f.enlace_url ? [{ texto: f.enlace_texto, url: f.enlace_url }] : [];
        if (f.tema === "talles" && m.producto) enlaces.unshift({ texto: "Guía de talles de esta prenda", url: `/producto/${m.producto}#guia-talles` });
        if (/\{whatsapp\}/.test(f.respuesta) || f.tema === "cambios") enlaces.push(enlaceWhatsapp(b.whatsapp));
        // "¿Cuánto sale el envío?" sin CP: se lo pide para cotizar.
        const pideCp = f.tema === "envios" && /\b(cost\w*|sale|cuesta|cobr\w*|precio|gratis)\b/.test(n);
        return {
          texto: rellenar(f.respuesta, b.vars), tema: f.tema, faqId: f.id, enlaces,
          ...(pideCp ? { esperando: "cp" as const } : {}),
          sugerencias: top.slice(1).filter((x) => x.puntaje >= 0.3).map((x) => x.f.pregunta).slice(0, 2),
        };
      }

      // "¿Tienen buzos negros?": el buscador de la tienda.
      if (PRODUCTO.test(n) || cons.length <= 3) {
        const q = n.replace(PRODUCTO, " ").split(" ").filter((p) => p.length > 2 && !/^(de|en|la|el|los|las|para|con|algun\w*|un\w*)$/.test(p)).map((p) => p.replace(/(es|s)$/, "")).join(" ");
        const filas = q ? await buscar(d.pool, q, 3).catch(() => []) : [];
        if (filas.length) {
          const ts = await tarjetas(d.pool, filas, false, d.descuentos);
          if (ts.length) {
            return {
              texto: ts.length === 1 ? "Encontré esto:" : "Encontré estas prendas:",
              tema: "productos", enlaces: [{ texto: "Ver más resultados", url: `/buscar?q=${encodeURIComponent(q)}` }], sugerencias: ["¿Cómo sé mi talle?"],
              productos: ts.map((t) => ({ nombre: t.nombre, precio: t.precio, url: `/producto/${t.slug}`, foto: t.foto?.clave ?? null })),
            };
          }
        }
      }

      // La IA (si está prendida y queda cupo del día).
      if (d.ia && b.chatbotIa.activo && cons.length) {
        const ok = await cupoIa(ip, b.chatbotIa.topeDiario);
        if (ok) {
          const texto = await d.ia.responder({ contexto: b.contextoIa, pregunta: m.mensaje, previos: m.previos ?? [] });
          if (texto) {
            return { texto, tema: primera?.f.tema ?? "general", ia: true, enlaces: [enlaceWhatsapp(b.whatsapp, m.mensaje)], sugerencias: [] };
          }
        }
      }

      if (!prueba) await anotarSinRespuesta(m.mensaje);
      const cerca = top.filter((x) => x.puntaje >= 0.25).map((x) => x.f.pregunta).slice(0, 3);
      return {
        texto: cerca.length
          ? "No estoy seguro de haber entendido. ¿Es alguna de estas?"
          : "Todavía no sé responder eso. Te puedo pasar con una persona por WhatsApp, o probá con alguna de estas preguntas.",
        tema: "sin_respuesta", enlaces: [enlaceWhatsapp(b.whatsapp, m.mensaje)], sugerencias: cerca.length ? cerca : SUGERENCIAS,
      };
    }
  }

  /* Tope diario de consultas a la IA (todas las réplicas) y por IP. */
  async function cupoIa(ip: string, tope: number): Promise<boolean> {
    try {
      await frenar(d.redis, "chat-ia", ip, 15, 600);
    } catch {
      return false;
    }
    const k = `isu:chat-ia:${ahoraAr()}`;
    const n = await d.redis.incr(k).catch(() => Number.POSITIVE_INFINITY);
    if (n === 1) await d.redis.expire(k, 2 * 86400).catch(() => 0);
    return n <= tope;
  }

  /*
   * ¿Cómo viene mi pedido? Con número Y email (los dos): la misma respuesta
   * si no existe o si el email no coincide, y frenos por IP y por número
   * para que no se pueda probar emails contra un número.
   */
  async function pedido(numero: string, email: string, ip: string): Promise<RespuestaChat> {
    await frenar(d.redis, "chat-pedido-ip", ip, 10, 600);
    await frenar(d.redis, "chat-pedido-num", numero, 5, 3600);
    const { rows } = await d.pool.query<{ id: number; numero: string; estado: string; entrega: string; transporte: string | null; servicio_envio: string | null; sucursal_envio: { nombre?: string; direccion?: string } | null; local_retiro: string | null }>(
      "SELECT id, numero, estado, entrega, transporte, servicio_envio, sucursal_envio, local_retiro FROM tienda.pedidos WHERE numero = $1 AND lower(email) = $2 AND estado <> 'reservando'",
      [numero, email]);
    const p = rows[0];
    anotarTema("pedidos");
    if (!p) {
      return { texto: "No encontré un pedido con esos datos. Revisá el número (está en el mail de confirmación) y que el email sea el de la compra.", tema: "pedidos", esperando: "pedido", enlaces: [], sugerencias: [] };
    }
    const ESTADO: Record<string, string> = {
      esperando_pago: "está esperando el pago", esperando_transferencia: "está esperando tu transferencia", transferencia_informada: "tiene la transferencia informada: la estamos verificando",
      a_pagar_en_local: "te espera en el local para pagarlo y retirarlo", pagado: "está pago y lo estamos preparando", pagado_tarde: "recibió el pago fuera de término: te vamos a escribir",
      listo_para_retirar: `está listo para retirar${p.local_retiro ? ` en ${p.local_retiro}` : ""}`, retirado: "ya fue retirado", enviado: "está en camino", entregado: "ya fue entregado",
      vencido: "venció sin pago", cancelado: "fue cancelado", sin_stock: "no se pudo confirmar por falta de stock",
    };
    let texto = `Tu pedido ${p.numero} ${ESTADO[p.estado] ?? `está en estado "${p.estado}"`}.`;
    const enlaces: RespuestaChat["enlaces"] = [];
    const e = await envioPublico(d.pool, d.transportes, p).catch(() => null);
    if (e?.estado) texto += ` El envío con ${e.nombreTransporte}: ${NOMBRE_ESTADO_ENVIO[e.estado].toLowerCase()}.`;
    if (e && d.secreto) enlaces.push({ texto: "Ver el seguimiento", url: `/seguimiento/${p.numero}?t=${firmaSeguimiento(p.numero, d.secreto)}` });
    enlaces.push({ texto: "Mis pedidos", url: "/cuenta" });
    return { texto, tema: "pedidos", enlaces, sugerencias: [] };
  }

  async function votar(faqId: number, util: boolean, ip: string) {
    await frenar(d.redis, "chat-voto", ip, 30, 600);
    await d.pool.query(`UPDATE tienda.faq SET ${util ? "util = util + 1" : "no_util = no_util + 1"} WHERE id = $1 AND activo`, [faqId]);
  }

  /** Al apagar: guardar lo que quedó en memoria. */
  async function cerrar() { clearInterval(reloj); await guardarContadores(); }

  return { responder, pedido, votar, base, guardarContadores, cerrar };
}
export type Asistente = ReturnType<typeof crearAsistente>;
