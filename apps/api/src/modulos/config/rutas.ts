import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type pg from "pg";
import { ConfigPublica, leerPacks, PACKS_POR_DEFECTO } from "@isu/shared";
import { esquema, type Db } from "@isu/db";
import type { CacheCorta } from "../../lib/cache.js";
import { CON_STOCK, EN_LIQUIDACION } from "../productos/consultas.js";

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
  chatbot: { activo: false, saludo: "" },
  packs: PACKS_POR_DEFECTO,
  hayPacks: false,
  packsEn: [],
  hayLiquidacion: false,
  liquidacionEn: [],
  cuidados: "",
  cifras: [],
};

/** Slugs de las categorías de arriba (Hombre, Mujer, Niños…) que tienen algún producto publicado que cumple `condicion`. */
async function categoriasCon(pool: pg.Pool, condicion: string): Promise<string[]> {
  const { rows } = await pool.query<{ slug: string }>(
    `SELECT arriba.slug FROM tienda.categorias arriba
      WHERE arriba.padre_id IS NULL AND arriba.visible AND EXISTS (
        SELECT 1 FROM tienda.productos p
          JOIN tienda.producto_categorias pc ON pc.producto_id = p.id
          JOIN tienda.categorias c ON c.id = pc.categoria_id AND c.visible
         WHERE (c.id = arriba.id OR c.padre_id = arriba.id) AND p.visible AND p.en_stocker AND ${condicion} AND ${CON_STOCK})
      ORDER BY arriba.orden, arriba.id`);
  return rows.map((r) => r.slug);
}

export async function rutasConfig(app: FastifyInstance, deps: { db: Db; pool: pg.Pool; cache: CacheCorta; pagoOnline: boolean }) {
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
      // Packs: también el formato viejo ([x2, x3, x4, x5]) mientras no corra la migración 0015.
      if (clave === "packs") { salida.packs = leerPacks(valor); continue; }
      const campo = forma[clave as keyof typeof forma];
      const r = campo.safeParse(valor);
      if (r.success) salida[clave] = r.data;
      else app.log.warn({ clave }, "ajuste inválido: se usa el valor por defecto");
    }
    // Hay packs si alguna prenda publicada se vende en pack (el menú muestra "Packs"), y en qué categorías de arriba.
    const [packsEn, liquidacionEn, hayPacks, hayLiquidacion] = await Promise.all([
      categoriasCon(deps.pool, "p.pack"), categoriasCon(deps.pool, EN_LIQUIDACION),
      deps.pool.query("SELECT 1 FROM tienda.productos WHERE pack AND visible AND en_stocker LIMIT 1"),
      deps.pool.query(`SELECT 1 FROM tienda.productos p WHERE p.visible AND p.en_stocker AND ${EN_LIQUIDACION} AND ${CON_STOCK} LIMIT 1`),
    ]);
    salida.hayPacks = !!hayPacks.rowCount;
    salida.packsEn = packsEn;
    salida.hayLiquidacion = !!hayLiquidacion.rowCount;
    salida.liquidacionEn = liquidacionEn;
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
