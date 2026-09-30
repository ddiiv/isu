import { z } from "zod";

/*
 * Envíos (etapa 4): lo que viaja entre la tienda, la API y el backoffice.
 * Las opciones las calcula SIEMPRE la API (cotiza con cada transporte); el
 * navegador sólo elige una por su id ("andreani:domicilio").
 */
export const TRANSPORTES = ["correo_argentino", "andreani", "oca", "mercado_envios", "cabify"] as const;
export type TransporteTienda = (typeof TRANSPORTES)[number];
export const SERVICIOS_ENVIO = ["domicilio", "sucursal", "en_el_dia"] as const;
export type ServicioEnvio = (typeof SERVICIOS_ENVIO)[number];

export const NOMBRE_TRANSPORTE: Record<TransporteTienda | "estandar", string> = {
  correo_argentino: "Correo Argentino", andreani: "Andreani", oca: "OCA", mercado_envios: "Mercado Envíos", cabify: "Cabify", estandar: "Envío a domicilio",
};

export const ESTADOS_ENVIO = ["creado", "en_camino", "en_sucursal", "en_reparto", "entregado", "no_entregado", "devuelto", "cancelado"] as const;
export type EstadoEnvioTienda = (typeof ESTADOS_ENVIO)[number];
export const NOMBRE_ESTADO_ENVIO: Record<EstadoEnvioTienda, string> = {
  creado: "Preparando el envío", en_camino: "En camino", en_sucursal: "Listo para retirar en la sucursal", en_reparto: "Llega hoy",
  entregado: "Entregado", no_entregado: "No se pudo entregar", devuelto: "Devuelto", cancelado: "Envío cancelado",
};

export const ID_OPCION = /^(correo_argentino|andreani|oca|mercado_envios|cabify|estandar):(domicilio|sucursal|en_el_dia)$/;
export const CP = z.string().trim().regex(/^([A-Za-z]\d{4}[A-Za-z]{3}|\d{4})$/, "Código postal inválido")
  // CPA ("C1406ABC") → los 4 números, que es lo que cotizan los transportes.
  .transform((v) => (/^\d{4}$/.test(v) ? v : v.slice(1, 5)));

export const OpcionEnvio = z.object({
  id: z.string().regex(ID_OPCION),
  transporte: z.enum([...TRANSPORTES, "estandar"]),
  servicio: z.enum(SERVICIOS_ENVIO),
  nombre: z.string(),
  /** Lo que ve el cliente debajo del nombre: "Llega en 3 a 6 días hábiles". */
  detalle: z.string(),
  precio: z.number().int(),
  /** Antes de aplicar el envío gratis (para mostrarlo tachado). */
  precioOriginal: z.number().int(),
  gratis: z.boolean(),
  requiereSucursal: z.boolean(),
  llegaHoy: z.boolean(),
  /** Mercado Envíos: sólo pagando con Mercado Pago, y el envío lo cobra Mercado Pago. */
  soloMercadoPago: z.boolean(),
});
export type OpcionEnvio = z.infer<typeof OpcionEnvio>;

export const DestinoEnvio = z.object({
  cp: CP,
  provincia: z.string().trim().min(2).max(60),
  localidad: z.string().trim().min(2).max(80),
}).strict();

export const RespuestaOpcionesEnvio = z.object({
  opciones: z.array(OpcionEnvio),
  /** Si algún transporte no respondió, se avisa sin frenar la compra. */
  aviso: z.string().nullable(),
});
export type RespuestaOpcionesEnvio = z.infer<typeof RespuestaOpcionesEnvio>;

export const SucursalEnvio = z.object({
  id: z.string(), nombre: z.string(), direccion: z.string(), localidad: z.string(), cp: z.string(), horario: z.string().nullable(),
});
export type SucursalEnvio = z.infer<typeof SucursalEnvio>;
export const ID_SUCURSAL = z.string().trim().regex(/^[A-Za-z0-9_-]{1,40}$/, "Sucursal inválida");

export const EventoEnvioPublico = z.object({ fecha: z.string(), estado: z.enum(ESTADOS_ENVIO), descripcion: z.string(), ubicacion: z.string().nullable() });
export const EnvioPublico = z.object({
  transporte: z.enum([...TRANSPORTES, "estandar"]),
  nombreTransporte: z.string(),
  servicio: z.enum(SERVICIOS_ENVIO),
  sucursal: z.object({ nombre: z.string(), direccion: z.string() }).nullable(),
  seguimiento: z.string().nullable(),
  url: z.string().nullable(),
  estado: z.enum(ESTADOS_ENVIO).nullable(),
  eventos: z.array(EventoEnvioPublico),
});
export type EnvioPublico = z.infer<typeof EnvioPublico>;

/* ── Ajustes (backoffice) ── */
export const AjusteTransporte = z.object({
  activo: z.boolean(), domicilio: z.boolean(), sucursal: z.boolean(),
  recargo: z.number().min(-50).max(200), // % sobre lo que cotiza el transporte
}).strict();
export const AjusteTransportes = z.object(Object.fromEntries(TRANSPORTES.map((t) => [t, AjusteTransporte])) as Record<TransporteTienda, typeof AjusteTransporte>).strict();
export type AjusteTransportes = z.infer<typeof AjusteTransportes>;

export const OrigenEnvios = z.object({
  nombre: z.string().trim().min(2).max(100), calle: z.string().trim().min(2).max(100), numero: z.string().trim().min(1).max(10),
  piso: z.string().trim().max(20), cp: z.string().trim().regex(/^\d{4}$/, "4 números"), localidad: z.string().trim().min(2).max(80),
  provincia: z.string().trim().min(2).max(60), email: z.string().trim().email(), telefono: z.string().trim().regex(/^[\d\s()+-]{8,25}$/),
  cuit: z.string().trim().regex(/^$|^\d{2}-?\d{8}-?\d$/, "CUIT inválido"),
}).strict();
export type OrigenEnvios = z.infer<typeof OrigenEnvios>;

export const PaqueteEnvios = z.object({
  pesoPrendaGramos: z.number().int().min(10).max(5000),
  pesoCajaGramos: z.number().int().min(0).max(5000),
  cajas: z.array(z.object({
    hastaPrendas: z.number().int().min(1).max(999), altoCm: z.number().min(1).max(200), anchoCm: z.number().min(1).max(200), largoCm: z.number().min(1).max(200),
  }).strict()).min(1).max(10),
}).strict();
export type PaqueteEnvios = z.infer<typeof PaqueteEnvios>;

export const EnviosEnElDia = z.object({
  // "1000-1499,1600-1899,1702"
  // eslint-disable-next-line security/detect-unsafe-regex -- sin alternativas que se solapen y con largo máximo de 500
  cps: z.string().trim().max(500).regex(/^(\d{4}(-\d{4})?)(,\s*\d{4}(-\d{4})?)*$|^$/, "Rangos como 1000-1499,1600-1899"),
  dias: z.array(z.number().int().min(0).max(6)).max(7),
  horaCorte: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora como 14:00"),
}).strict();
export type EnviosEnElDia = z.infer<typeof EnviosEnElDia>;

/** ¿El CP está en los rangos? ("1000-1499,1600-1899") */
export function cpEnRangos(cp: string, rangos: string): boolean {
  const n = Number(cp);
  if (!Number.isInteger(n)) return false;
  return rangos.split(",").map((r) => r.trim()).filter(Boolean).some((r) => {
    const [a, b] = r.split("-").map(Number);
    return b === undefined ? n === a : n >= a! && n <= b;
  });
}
