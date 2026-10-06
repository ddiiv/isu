import { andreani } from "./andreani.js";
import { cabify } from "./cabify.js";
import { correoArgentino } from "./correo-argentino.js";
import { mercadoEnvios, type MercadoEnvios } from "./mercado-envios.js";
import { oca } from "./oca.js";
import { whatsapp, type Whatsapp } from "./whatsapp.js";
import type { Adaptador, Transporte } from "./tipos.js";

export * from "./tipos.js";
export * from "./estados.js";
export { ErrorTransporte } from "./http.js";
export { codigoProvincia } from "./provincias.js";
export { telefonoWhatsapp, type Whatsapp } from "./whatsapp.js";
export type { MercadoEnvios } from "./mercado-envios.js";
export { pdfSimple } from "./pdf.js";
export { firmaSeguimiento, firmaSeguimientoValida, enlaceSeguimiento, firmaOpinar, firmaOpinarValida, enlaceOpinar } from "./firma.js";

/*
 * Qué transportes están disponibles: cada uno se activa sólo si tiene sus
 * credenciales en el entorno (Railway). Sin credenciales, no aparece en el
 * checkout ni en el backoffice. Qué se ofrece y con qué recargo se decide
 * después, en Ajustes del backoffice.
 *
 * TRANSPORTES_SIMULADOR (sólo desarrollo): apunta TODOS al simulador local
 * (pnpm demo:transportes) con credenciales de prueba.
 */
export interface Transportes {
  adaptadores: Partial<Record<Transporte, Adaptador>>;
  mercadoEnvios: MercadoEnvios | null;
  whatsapp: Whatsapp | null;
}

type Env = Record<string, string | undefined>;
const hay = (...v: Array<string | undefined>) => v.every((x) => typeof x === "string" && x.trim() !== "");

export function crearTransportes(envOriginal: Env = process.env): Transportes {
  const sim = envOriginal.TRANSPORTES_SIMULADOR?.replace(/\/+$/, "");
  const env: Env = sim && envOriginal.NODE_ENV !== "production" ? {
    CORREO_AR_URL: `${sim}/correo`, CORREO_AR_USUARIO: "demo", CORREO_AR_CLAVE: "demo", CORREO_AR_CLIENTE: "0001",
    ANDREANI_URL: `${sim}/andreani`, ANDREANI_USUARIO: "demo", ANDREANI_CLAVE: "demo", ANDREANI_CLIENTE: "CL0001", ANDREANI_CONTRATO_DOMICILIO: "400006709", ANDREANI_CONTRATO_SUCURSAL: "400006711",
    OCA_URL: `${sim}/oca`, OCA_USUARIO: "demo", OCA_CLAVE: "demo", OCA_CUIT: "30-00000000-0", OCA_CUENTA: "111757/001", OCA_OPERATIVA_DOMICILIO: "64665", OCA_OPERATIVA_SUCURSAL: "62342",
    ML_API_URL: `${sim}/meli`, MP_API_URL: envOriginal.MP_API_URL ?? `${sim}/mp`, MP_ACCESS_TOKEN: envOriginal.MP_ACCESS_TOKEN ?? "APP_USR-demo", MERCADO_ENVIOS_ACTIVO: "true",
    CABIFY_URL: `${sim}/cabify`, CABIFY_CLIENTE_ID: "demo", CABIFY_CLIENTE_SECRETO: "demo",
    WHATSAPP_META_URL: `${sim}/whatsapp`, WHATSAPP_META_TOKEN: "demo", WHATSAPP_META_PHONE_NUMBER_ID: "100000000000001",
    ...envOriginal,
  } : envOriginal;

  const a: Partial<Record<Transporte, Adaptador>> = {};
  if (hay(env.CORREO_AR_USUARIO, env.CORREO_AR_CLAVE, env.CORREO_AR_CLIENTE)) {
    a.correo_argentino = correoArgentino({ url: env.CORREO_AR_URL ?? "https://api.correoargentino.com.ar/micorreo/v1", usuario: env.CORREO_AR_USUARIO!, clave: env.CORREO_AR_CLAVE!, cliente: env.CORREO_AR_CLIENTE! });
  }
  if (hay(env.ANDREANI_USUARIO, env.ANDREANI_CLAVE, env.ANDREANI_CLIENTE, env.ANDREANI_CONTRATO_DOMICILIO)) {
    a.andreani = andreani({
      url: env.ANDREANI_URL ?? "https://apis.andreani.com", usuario: env.ANDREANI_USUARIO!, clave: env.ANDREANI_CLAVE!, cliente: env.ANDREANI_CLIENTE!,
      contratoDomicilio: env.ANDREANI_CONTRATO_DOMICILIO!, contratoSucursal: env.ANDREANI_CONTRATO_SUCURSAL || null,
    });
  }
  if (hay(env.OCA_USUARIO, env.OCA_CLAVE, env.OCA_CUIT, env.OCA_CUENTA, env.OCA_OPERATIVA_DOMICILIO)) {
    a.oca = oca({
      url: env.OCA_URL ?? "https://webservice.oca.com.ar/ePak_tracking/Oep_TrackEPak.asmx", usuario: env.OCA_USUARIO!, clave: env.OCA_CLAVE!,
      cuit: env.OCA_CUIT!, cuenta: env.OCA_CUENTA!, operativaDomicilio: env.OCA_OPERATIVA_DOMICILIO!, operativaSucursal: env.OCA_OPERATIVA_SUCURSAL || null,
    });
  }
  let me: MercadoEnvios | null = null;
  if (env.MERCADO_ENVIOS_ACTIVO === "true" && hay(env.MP_ACCESS_TOKEN)) {
    me = mercadoEnvios({ urlMl: env.ML_API_URL ?? "https://api.mercadolibre.com", urlMp: env.MP_API_URL ?? "https://api.mercadopago.com", token: env.MP_ACCESS_TOKEN! });
    a.mercado_envios = me;
  }
  if (hay(env.CABIFY_CLIENTE_ID, env.CABIFY_CLIENTE_SECRETO)) {
    a.cabify = cabify({ url: env.CABIFY_URL ?? "https://logistics.api.cabify.com", clienteId: env.CABIFY_CLIENTE_ID!, clienteSecreto: env.CABIFY_CLIENTE_SECRETO! });
  }
  const wa = hay(env.WHATSAPP_META_TOKEN, env.WHATSAPP_META_PHONE_NUMBER_ID)
    ? whatsapp({ url: env.WHATSAPP_META_URL ?? "https://graph.facebook.com", version: env.WHATSAPP_META_API_VERSION ?? "v22.0", token: env.WHATSAPP_META_TOKEN!, telefonoId: env.WHATSAPP_META_PHONE_NUMBER_ID!, idioma: env.WHATSAPP_IDIOMA ?? "es_AR" })
    : null;
  return { adaptadores: a, mercadoEnvios: me, whatsapp: wa };
}
