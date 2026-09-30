import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { ConfigPublica } from "@isu/shared";
import { esquema, type Db } from "@isu/db";
import type { CacheCorta } from "../../lib/cache.js";

/*
 * GET /v1/config — lo que la tienda necesita saber sin sesión: monto mínimo
 * del carrito, envío gratis, descuento por transferencia, WhatsApp, locales.
 *
 * Si un ajuste guardado está mal formado, se usa el valor por defecto de ese
 * campo y se deja en el log: una tienda que no carga por un ajuste roto es
 * peor que una con un valor viejo.
 */
const POR_DEFECTO: ConfigPublica = {
  montoMinimoCarrito: 0,
  envioGratisDesde: null,
  descuentoTransferencia: 20,
  cuotasSinInteres: 3,
  whatsapp: "5491168515444",
  email: "isu.isuwaya@gmail.com",
  anuncio: null,
  avisoUltimas: 3,
  mostrarAgotados: true,
  mediosPago: ["local"],
  costoEnvio: 790_000,
  locales: [],
};

export async function rutasConfig(app: FastifyInstance, deps: { db: Db; cache: CacheCorta; pagoOnline: boolean }) {
  const cargar = async (): Promise<ConfigPublica> => {
    const filas = await deps.db.select({ clave: esquema.ajustes.clave, valor: esquema.ajustes.valor }).from(esquema.ajustes);
    const salida: Record<string, unknown> = { ...POR_DEFECTO };
    const forma = ConfigPublica.shape;
    // Medios de pago: sólo los que funcionan. Transferencia, si hay CBU o alias; online, si hay Mercado Pago.
    const t = filas.find((f) => f.clave === "datosTransferencia")?.valor as { cbu?: string; alias?: string } | undefined;
    salida.mediosPago = [
      ...(deps.pagoOnline ? ["mercadopago", "pagofacil"] : []),
      ...(t?.cbu || t?.alias ? ["transferencia"] : []),
      "local",
    ];
    for (const { clave, valor } of filas) {
      if (!(clave in forma)) continue;
      const campo = forma[clave as keyof typeof forma];
      const r = campo.safeParse(valor);
      if (r.success) salida[clave] = r.data;
      else app.log.warn({ clave }, "ajuste inválido: se usa el valor por defecto");
    }
    return ConfigPublica.parse(salida);
  };

  app.withTypeProvider<ZodTypeProvider>().get(
    "/v1/config",
    { schema: { response: { 200: ConfigPublica } } },
    async (_req, reply) => {
      reply.header("cache-control", "public, max-age=60, s-maxage=300, stale-while-revalidate=600");
      return deps.cache.obtener("config", cargar);
    },
  );
}
