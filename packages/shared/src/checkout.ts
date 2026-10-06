import { z } from "zod";
import { EnvioPublico, ID_OPCION, ID_SUCURSAL, OpcionEnvio } from "./envios.js";

/*
 * Carrito, checkout, cuenta y pedido: lo que viaja entre la tienda y la API.
 * La API vuelve a calcular TODO (precios, stock, descuentos, envío): lo que
 * manda el navegador es sólo qué quiere y cuánto.
 */

const texto = (min: number, max: number) => z.string().trim().min(min).max(max);
export const Email = z.string().trim().toLowerCase().max(150).email("Email inválido");
export const Contrasena = z.string().min(8, "Al menos 8 caracteres").max(128);
export const Telefono = z.string().trim().regex(/^[+\d\s()-]{8,25}$/, "Teléfono inválido");
export const Dni = z.string().trim().regex(/^\d{7,8}$|^\d{11}$/, "DNI (7 u 8 números) o CUIT (11)");

export const MEDIOS_PAGO = ["mercadopago", "pagofacil", "transferencia", "local"] as const;
export const MedioPago = z.enum(MEDIOS_PAGO);
export type MedioPago = z.infer<typeof MedioPago>;

export const MAX_UNIDADES_POR_ARTICULO = 20;
export const MAX_LINEAS_CARRITO = 30;

/** Hasta cuántos packs iguales en una línea. */
export const MAX_PACKS_POR_LINEA = 10;

export const ItemSuelto = z.object({
  sku: texto(1, 100),
  cantidad: z.number().int().min(1).max(MAX_UNIDADES_POR_ARTICULO),
}).strict();
export type ItemSuelto = z.infer<typeof ItemSuelto>;

/*
 * Un pack (etapa 10): va aparte de las prendas sueltas, aunque sea la misma
 * prenda. `pack` dice qué lleva UN pack (variante y cuántas de cada una) y
 * `cantidad`, cuántos packs iguales. El % lo pone la API según cuántas
 * prendas lleva el pack; el navegador no lo manda.
 */
export const ItemPack = z.object({
  pack: z.array(z.object({ sku: texto(1, 100), cantidad: z.number().int().min(1).max(20) }).strict()).min(1).max(20),
  cantidad: z.number().int().min(1).max(MAX_PACKS_POR_LINEA),
}).strict();
export type ItemPack = z.infer<typeof ItemPack>;

export const ItemCarrito = z.union([ItemSuelto, ItemPack]);
export type ItemCarrito = z.infer<typeof ItemCarrito>;
export const esPack = (i: ItemCarrito): i is ItemPack => "pack" in i;
export const Items = z.array(ItemCarrito).min(1, "El carrito está vacío").max(MAX_LINEAS_CARRITO);

export const Direccion = z.object({
  calle: texto(2, 100),
  numero: texto(1, 10),
  piso: z.string().trim().max(20).optional().default(""),
  cp: z.string().trim().regex(/^([A-Za-z]\d{4}[A-Za-z]{3}|\d{4})$/, "Código postal inválido"),
  localidad: texto(2, 80),
  provincia: texto(2, 60),
  indicaciones: z.string().trim().max(200).optional().default(""),
}).strict();
export type Direccion = z.infer<typeof Direccion>;

export const Entrega = z.discriminatedUnion("tipo", [
  z.object({
    tipo: z.literal("envio"),
    direccion: Direccion,
    // La opción elegida de las que cotizó la API ("andreani:sucursal"). Sin transportes configurados, el envío estándar.
    opcion: z.string().regex(ID_OPCION, "Elegí cómo te lo mandamos").optional(),
    sucursal: ID_SUCURSAL.optional(),
  }).strict(),
  z.object({ tipo: z.literal("retiro"), local: texto(2, 100) }).strict(),
]);
export type Entrega = z.infer<typeof Entrega>;

export const Contacto = z.object({
  email: Email,
  nombre: texto(2, 100),
  apellido: texto(2, 100),
  telefono: Telefono,
  dni: Dni,
}).strict();
export type Contacto = z.infer<typeof Contacto>;

/* Lo que escribe el cliente; la API lo normaliza (mayúsculas, sin espacios) y lo valida. */
export const CodigoCupon = z.string().trim().max(40);

export const PedidoNuevo = z.object({
  items: Items,
  cupon: CodigoCupon.optional(),
  contacto: Contacto,
  entrega: Entrega,
  medioPago: MedioPago,
  notas: z.string().trim().max(500).optional(),
  // Avisos del envío por WhatsApp (además del email). Opcional: se pide permiso.
  avisosWhatsapp: z.boolean().optional().default(false),
  aceptaTerminos: z.literal(true, { error: "Tenés que aceptar los términos y condiciones" }),
}).strict();
export type PedidoNuevo = z.infer<typeof PedidoNuevo>;

export const PedidoCotizar = z.object({
  items: Items,
  cupon: CodigoCupon.optional(),
  // Con el email del checkout se controla el tope de usos por cliente.
  email: Email.optional(),
  entrega: z.enum(["envio", "retiro"]).optional(),
  medioPago: MedioPago.optional(),
  // Con una opción de envío elegida, el total la incluye (el checkout la manda).
  envio: z.object({ cp: z.string().trim().max(8), provincia: z.string().trim().max(60), localidad: z.string().trim().max(80), opcion: z.string().regex(ID_OPCION) }).strict().optional(),
}).strict();

export const LineaCotizada = z.object({
  sku: z.string(),
  /** Suelta: el SKU. Dentro de un pack: "<clave del pack>|<SKU>" (la misma variante puede ir suelta y en un pack, a otro precio). */
  clave: z.string(),
  productoSlug: z.string().nullable(),
  nombre: z.string(),
  color: z.string().nullable(),
  talle: z.string().nullable(),
  foto: z.string().nullable(),           // clave de la foto (la URL la arma la tienda)
  precio: z.number().int(),              // con el descuento masivo, si hay
  precioLista: z.number().int().nullable(),
  cantidad: z.number().int(),
  disponible: z.number().int(),          // hasta 20
  subtotal: z.number().int(),
  /** Es parte de un pack (etapa 10: de cuál, cuántas prendas lleva cada pack y qué % le toca). Suelta: null. */
  pack: z.object({ clave: z.string(), unidades: z.number().int(), porcentaje: z.number().int() }).nullable().optional(),
});
export type LineaCotizada = z.infer<typeof LineaCotizada>;

/** Un pack del carrito, como se muestra: "Pack x5 Remera …" con lo que lleva y cuántos. */
export const PackCotizado = z.object({
  clave: z.string(),
  productoSlug: z.string(),
  nombre: z.string(),
  foto: z.string().nullable(),
  /** prendas por pack */
  unidades: z.number().int(),
  /** % que se descuenta (el del pack o la rebaja de la prenda, el mayor) */
  porcentaje: z.number().int(),
  /** cuántos packs iguales */
  cantidad: z.number().int(),
  /** precio de UN pack */
  precio: z.number().int(),
  /** lo que saldrían esas prendas sueltas, sin descuento */
  precioLista: z.number().int(),
  subtotal: z.number().int(),
  /** cuántos packs iguales se pueden llevar con el stock que hay (hasta 10) */
  disponible: z.number().int(),
  prendas: z.array(z.object({ sku: z.string(), color: z.string().nullable(), talle: z.string().nullable(), foto: z.string().nullable(), cantidad: z.number().int(), precio: z.number().int() })),
});
export type PackCotizado = z.infer<typeof PackCotizado>;

export const Problema = z.object({
  sku: z.string().nullable(),
  /** sku: el SKU, o la clave del pack ("pack" = ese pack ya no se puede armar así). */
  tipo: z.enum(["no_existe", "sin_stock", "stock_insuficiente", "minimo", "pack"]),
  mensaje: z.string(),
});

export const CuponCotizado = z.object({
  codigo: z.string().nullable(),        // null = promoción automática
  nombre: z.string(),
  envioGratis: z.boolean(),
});
export type CuponCotizado = z.infer<typeof CuponCotizado>;

export const Cotizacion = z.object({
  /** Todas las prendas: las sueltas y las de cada pack (con `pack`). */
  lineas: z.array(LineaCotizada),
  /** Los packs, agrupados para mostrarlos (etapa 10). */
  packs: z.array(PackCotizado).default([]),
  subtotal: z.number().int(),
  /** Cupón o promoción aplicado (uno por compra) y cuánto descuenta. */
  cupon: CuponCotizado.nullable().optional(),
  descuentoCupon: z.number().int().optional(),
  /** Por qué el cupón escrito no se aplicó (vencido, falta monto…). */
  avisoCupon: z.string().nullable().optional(),
  /** La promoción automática más cercana que todavía no alcanza ("te faltan $X para 10% OFF"). */
  promoCerca: z.object({ nombre: z.string(), falta: z.number().int() }).nullable().optional(),
  /** Descuento por transferencia. */
  descuento: z.number().int(),
  envio: z.number().int(),
  total: z.number().int(),
  envioGratisDesde: z.number().int().nullable(),
  faltaParaEnvioGratis: z.number().int().nullable(),
  montoMinimo: z.number().int(),
  problemas: z.array(Problema),
  /** La opción de envío con la que se calculó (null = sin elegir o retiro). */
  opcionEnvio: OpcionEnvio.nullable().optional(),
});
export type Cotizacion = z.infer<typeof Cotizacion>;

export const ESTADOS_PENDIENTES = ["esperando_pago", "esperando_transferencia", "transferencia_informada", "a_pagar_en_local"] as const;

export const PedidoPublico = z.object({
  numero: z.string(),
  estado: z.string(),
  creadoEn: z.string(),
  venceEn: z.string().nullable(),
  pagadoEn: z.string().nullable(),
  medioPago: MedioPago,
  entrega: z.enum(["envio", "retiro"]),
  direccion: Direccion.nullable(),
  local: z.string().nullable(),
  contacto: z.object({ email: z.string(), nombre: z.string(), apellido: z.string(), telefono: z.string() }),
  items: z.array(z.object({ sku: z.string(), nombre: z.string(), color: z.string().nullable(), talle: z.string().nullable(), precio: z.number().int(), cantidad: z.number().int() })),
  subtotal: z.number().int(),
  cupon: z.object({ codigo: z.string().nullable(), nombre: z.string() }).nullable().optional(),
  descuentoCupon: z.number().int().optional(),
  descuento: z.number().int(),
  envio: z.number().int(),
  total: z.number().int(),
  /** Con qué viaja y por dónde anda (null para retiro en el local). */
  envioDetalle: EnvioPublico.nullable().optional(),
  /** Etapa 8: ya se entregó o se retiró → enlace para opinar (/opinar/<numero>?t=…). */
  opinar: z.string().nullable().optional(),
  pago: z.object({
    // Mercado Pago / Pago Fácil: a dónde ir a pagar (si todavía no pagó)
    url: z.string().nullable(),
    // Transferencia: a dónde transferir
    transferencia: z.object({
      titular: z.string(), cuit: z.string(), banco: z.string(), cbu: z.string(), alias: z.string(),
      /** Cuánto transferir, en centavos (con Mercado Pago, con los centavos que identifican el pedido). */
      monto: z.number().int(),
      /** talo: CVU propio del pedido · mercadopago: alias de la cuenta de MP · cuenta: se confirma a mano. */
      via: z.enum(["talo", "mercadopago", "cuenta"]),
      /** Se confirma sola, sin comprobante. */
      automatica: z.boolean(),
    }).nullable(),
    comprobanteSubido: z.boolean(),
  }),
});
export type PedidoPublico = z.infer<typeof PedidoPublico>;

export const PedidoCreado = z.object({
  numero: z.string(),
  acceso: z.string(),
  estado: z.string(),
  redirigir: z.string().nullable(),
});

export const Registro = z.object({
  email: Email,
  contrasena: Contrasena,
  nombre: texto(2, 100),
  apellido: texto(2, 100),
  aceptaNovedades: z.boolean().optional().default(false),
}).strict();
export const Ingreso = z.object({ email: Email, contrasena: z.string().min(1).max(128) }).strict();
export const DatosCuenta = z.object({
  nombre: texto(2, 100),
  apellido: texto(2, 100),
  telefono: Telefono.or(z.literal("")).optional(),
  dni: Dni.or(z.literal("")).optional(),
  aceptaNovedades: z.boolean().optional(),
}).strict();

export const ClientePublico = z.object({
  email: z.string(),
  nombre: z.string(),
  apellido: z.string().nullable(),
  telefono: z.string().nullable(),
  dni: z.string().nullable(),
  aceptaNovedades: z.boolean(),
});
export type ClientePublico = z.infer<typeof ClientePublico>;

export const Arrepentimiento = z.object({
  numero: z.string().trim().toUpperCase().regex(/^ISU-\d{4,10}$/, "El número de pedido tiene la forma ISU-1234"),
  email: Email,
  nombre: texto(2, 150),
  motivo: z.string().trim().max(1000).optional(),
}).strict();
