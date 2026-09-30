import { z } from "zod";

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

export const ItemCarrito = z.object({
  sku: texto(1, 100),
  cantidad: z.number().int().min(1).max(MAX_UNIDADES_POR_ARTICULO),
}).strict();
export type ItemCarrito = z.infer<typeof ItemCarrito>;
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
  z.object({ tipo: z.literal("envio"), direccion: Direccion }).strict(),
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

export const PedidoNuevo = z.object({
  items: Items,
  contacto: Contacto,
  entrega: Entrega,
  medioPago: MedioPago,
  notas: z.string().trim().max(500).optional(),
  aceptaTerminos: z.literal(true, { error: "Tenés que aceptar los términos y condiciones" }),
}).strict();
export type PedidoNuevo = z.infer<typeof PedidoNuevo>;

export const PedidoCotizar = z.object({
  items: Items,
  entrega: z.enum(["envio", "retiro"]).optional(),
  medioPago: MedioPago.optional(),
}).strict();

export const LineaCotizada = z.object({
  sku: z.string(),
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
});
export type LineaCotizada = z.infer<typeof LineaCotizada>;

export const Problema = z.object({
  sku: z.string().nullable(),
  tipo: z.enum(["no_existe", "sin_stock", "stock_insuficiente", "minimo"]),
  mensaje: z.string(),
});

export const Cotizacion = z.object({
  lineas: z.array(LineaCotizada),
  subtotal: z.number().int(),
  descuento: z.number().int(),
  envio: z.number().int(),
  total: z.number().int(),
  envioGratisDesde: z.number().int().nullable(),
  faltaParaEnvioGratis: z.number().int().nullable(),
  montoMinimo: z.number().int(),
  problemas: z.array(Problema),
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
  descuento: z.number().int(),
  envio: z.number().int(),
  total: z.number().int(),
  pago: z.object({
    // Mercado Pago / Pago Fácil: a dónde ir a pagar (si todavía no pagó)
    url: z.string().nullable(),
    // Transferencia: a dónde transferir
    transferencia: z.object({ titular: z.string(), cuit: z.string(), banco: z.string(), cbu: z.string(), alias: z.string() }).nullable(),
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
