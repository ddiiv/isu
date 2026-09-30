/*
 * Lo común a todos los transportes. Cada uno (Correo Argentino, Andreani,
 * OCA, Mercado Envíos, Cabify) tiene su API con sus nombres; los adaptadores
 * la traducen a esto, así el resto de la tienda no sabe con quién habla.
 *
 * Plata en CENTAVOS (como en toda la tienda); peso en gramos; medidas en cm.
 */
export const TRANSPORTES = ["correo_argentino", "andreani", "oca", "mercado_envios", "cabify"] as const;
export type Transporte = (typeof TRANSPORTES)[number];
export const SERVICIOS = ["domicilio", "sucursal", "en_el_dia"] as const;
export type Servicio = (typeof SERVICIOS)[number];

export const NOMBRE_TRANSPORTE: Record<Transporte, string> = {
  correo_argentino: "Correo Argentino", andreani: "Andreani", oca: "OCA", mercado_envios: "Mercado Envíos", cabify: "Cabify",
};

/*
 * Dónde está el paquete, en palabras de la tienda (lo que ve el cliente).
 *   creado        la etiqueta existe; el paquete todavía no salió
 *   en_camino     el transporte lo tiene
 *   en_sucursal   llegó a la sucursal del transporte: lo puede ir a buscar
 *   en_reparto    sale hoy a entregarse
 *   entregado · no_entregado (visita fallida) · devuelto · cancelado
 */
export const ESTADOS_ENVIO = ["creado", "en_camino", "en_sucursal", "en_reparto", "entregado", "no_entregado", "devuelto", "cancelado"] as const;
export type EstadoEnvio = (typeof ESTADOS_ENVIO)[number];
export const ESTADOS_FINALES: readonly EstadoEnvio[] = ["entregado", "devuelto", "cancelado"];

export interface Direccion {
  calle: string; numero: string; piso?: string | null; cp: string; localidad: string; provincia: string; indicaciones?: string | null;
}
export interface Persona { nombre: string; apellido: string; email: string; telefono: string; dni: string }
/** De dónde sale el paquete (la tienda / el depósito). */
export interface Origen extends Direccion { nombre: string; email: string; telefono: string; cuit: string }
export interface Paquete { pesoGramos: number; altoCm: number; anchoCm: number; largoCm: number; valorDeclarado: number }

export interface Cotizacion {
  transporte: Transporte;
  servicio: Servicio;
  /** Lo que muestra el transporte ("Clásico", "Estándar a sucursal"…). */
  nombre: string;
  precio: number;
  plazoMin: number | null;
  plazoMax: number | null;
}

export interface Sucursal {
  id: string; nombre: string; direccion: string; localidad: string; cp: string; horario: string | null;
}

export interface NuevoEnvio {
  pedido: string;
  servicio: Servicio;
  destinatario: Persona;
  /** Envío a domicilio. */
  direccion?: Direccion | null;
  /** Envío a una sucursal del transporte. */
  sucursal?: string | null;
  paquete: Paquete;
  origen: Origen;
}

export interface EnvioCreado {
  seguimiento: string;
  /** Id propio del transporte si es distinto del número de seguimiento (orden de retiro, id de viaje…). */
  externoId: string | null;
  /** La etiqueta si vino con la creación (si no, se pide aparte). */
  etiqueta: Buffer | null;
}

export interface EventoEnvio {
  fecha: Date;
  estado: EstadoEnvio;
  descripcion: string;
  ubicacion: string | null;
}

export interface Adaptador {
  transporte: Transporte;
  servicios: readonly Servicio[];
  /** null = no hace ese servicio a ese destino. `origen`: de dónde sale (lo usa quien cotiza por distancia). */
  cotizar(destino: { cp: string; provincia?: string | null; localidad?: string | null }, paquete: Paquete, servicio: Servicio, origen: Origen): Promise<Cotizacion | null>;
  sucursales?(cp: string, provincia?: string | null): Promise<Sucursal[]>;
  crearEnvio(e: NuevoEnvio): Promise<EnvioCreado>;
  /** null = este transporte no da etiqueta por API (se imprime desde su portal). */
  etiqueta(envio: { seguimiento: string; externoId: string | null }): Promise<Buffer | null>;
  seguimiento(envio: { seguimiento: string; externoId: string | null }): Promise<EventoEnvio[]>;
  /** Página pública del transporte para seguir el envío (null si no hay). */
  urlSeguimiento(seguimiento: string): string | null;
}
