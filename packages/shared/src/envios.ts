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

/* Peso (g) y medidas (cm) de una prenda doblada, como va en la bolsa: alto = el grosor. */
export const MedidasPrenda = z.object({
  pesoGramos: z.number().int().min(10).max(30_000),
  altoCm: z.number().int().min(1).max(100),
  anchoCm: z.number().int().min(1).max(150),
  largoCm: z.number().int().min(1).max(150),
}).strict();
export type MedidasPrenda = z.infer<typeof MedidasPrenda>;

export const BolsaEnvio = z.object({
  nombre: z.string().trim().min(1).max(30),
  anchoCm: z.number().int().min(10).max(150),
  largoCm: z.number().int().min(10).max(150),
  pesoGramos: z.number().int().min(0).max(2000),
}).strict();
export type BolsaEnvio = z.infer<typeof BolsaEnvio>;

/*
 * Cómo se arma el paquete para cotizar (etapa 15): todo el pedido en UNA
 * bolsa, la más chica en la que entran las prendas apiladas. Las prendas sin
 * peso o medidas cargadas usan la prenda por defecto.
 */
export const PaqueteEnvios = z.object({
  prendaPorDefecto: MedidasPrenda,
  bolsas: z.array(BolsaEnvio).min(1).max(8),
}).strict();
export type PaqueteEnvios = z.infer<typeof PaqueteEnvios>;

export const BOLSAS_DE_FABRICA: BolsaEnvio[] = [
  { nombre: "Chica", anchoCm: 30, largoCm: 40, pesoGramos: 15 },
  { nombre: "Mediana", anchoCm: 40, largoCm: 50, pesoGramos: 25 },
  { nombre: "Grande", anchoCm: 50, largoCm: 60, pesoGramos: 40 },
  { nombre: "Extra grande", anchoCm: 60, largoCm: 80, pesoGramos: 60 },
];
export const PAQUETE_DE_FABRICA: PaqueteEnvios = {
  prendaPorDefecto: { pesoGramos: 350, altoCm: 3, anchoCm: 25, largoCm: 30 },
  bolsas: BOLSAS_DE_FABRICA,
};

/** El ajuste guardado; el formato de antes (cajas por cantidad de prendas) se pasa a bolsas. */
export function leerPaqueteEnvios(valor: unknown): PaqueteEnvios | null {
  const v = PaqueteEnvios.safeParse(valor);
  if (v.success) return v.data;
  const viejo = z.object({ pesoPrendaGramos: z.number().int().min(10).max(30_000) }).passthrough().safeParse(valor);
  if (!viejo.success) return null;
  return { prendaPorDefecto: { ...PAQUETE_DE_FABRICA.prendaPorDefecto, pesoGramos: viejo.data.pesoPrendaGramos }, bolsas: BOLSAS_DE_FABRICA };
}

export interface PrendaParaBolsa { pesoGramos: number; altoCm: number; anchoCm: number; largoCm: number; cantidad: number }
export interface BolsaArmada {
  pesoGramos: number;
  /** El grosor de lo que va en la bolsa. */
  altoCm: number;
  anchoCm: number;
  largoCm: number;
  prendas: number;
  /** Qué bolsa usar al armar el paquete. */
  bolsa: string;
  /** false = no entra en ninguna: se cotiza con la más grande y el backoffice lo marca. */
  entra: boolean;
}

/*
 * Todo en una bolsa. Las prendas van apiladas; si la pila queda muy alta se
 * reparte en 2 o 3 pilas una al lado de la otra (como se arma de verdad).
 * La bolsa (un tubo cerrado en las puntas) rodea lo que lleva: para que
 * entre, cada lado de la bolsa tiene que ser al menos el lado de la pila más
 * su grosor. Se elige la bolsa más chica en la que entra.
 */
export function armarBolsa(prendas: PrendaParaBolsa[], bolsas: BolsaEnvio[]): BolsaArmada {
  let grosor = 0, corto = 0, largo = 0, gramos = 0, n = 0;
  for (const p of prendas) {
    if (!(p.cantidad > 0)) continue;
    grosor += p.altoCm * p.cantidad;
    corto = Math.max(corto, Math.min(p.anchoCm, p.largoCm));
    largo = Math.max(largo, Math.max(p.anchoCm, p.largoCm));
    gramos += p.pesoGramos * p.cantidad;
    n += p.cantidad;
  }
  const ordenadas = [...(bolsas.length ? bolsas : BOLSAS_DE_FABRICA)]
    .map((b) => ({ ...b, a: Math.min(b.anchoCm, b.largoCm), l: Math.max(b.anchoCm, b.largoCm) }))
    .sort((x, y) => x.a * x.l - y.a * y.l || x.pesoGramos - y.pesoGramos);
  // Las formas de acomodar la pila: 1, 2 o 3 pilas (el grosor se reparte, el lado corto crece).
  const formas = [1, 2, 3].map((k) => {
    const alto = Math.max(1, Math.ceil(grosor / k));
    const lados = [corto * k, largo].sort((x, y) => x - y) as [number, number];
    return { alto, a: Math.max(1, Math.ceil(lados[0])), l: Math.max(1, Math.ceil(lados[1])) };
  });
  const cabe = (b: { a: number; l: number }, f: { alto: number; a: number; l: number }) => b.a >= f.a + f.alto && b.l >= f.l + f.alto;
  for (const b of ordenadas) {
    const f = formas.find((x) => cabe(b, x));
    if (f) return { pesoGramos: gramos + b.pesoGramos, altoCm: f.alto, anchoCm: f.a, largoCm: f.l, prendas: n, bolsa: b.nombre, entra: true };
  }
  // No entra en ninguna: la más grande, con la forma más compacta.
  const b = ordenadas.at(-1)!;
  const f = [...formas].sort((x, y) => x.alto + x.a + x.l - (y.alto + y.a + y.l))[0]!;
  return { pesoGramos: gramos + b.pesoGramos, altoCm: f.alto, anchoCm: f.a, largoCm: f.l, prendas: n, bolsa: b.nombre, entra: false };
}

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
