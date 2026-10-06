import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type pg from "pg";
import { z } from "zod";
import type { Entorno } from "../../entorno.js";
import { ipDe } from "../../lib/cliente.js";
import { leerAjusteTransferencias, type Transferencias } from "../pedidos/transferencias.js";
import { auditar, exigir } from "./sesion.js";

/*
 * Backoffice → Transferencias: lo que entró (Talo o la cuenta de Mercado
 * Pago) y si se pudo asignar solo a un pedido. Lo que no (el cliente
 * transfirió sin los centavos, de menos, o algo que no es una compra) se
 * asigna a mano a su pedido o se descarta.
 *
 *   GET  /v1/admin/transferencias?estado=por_resolver|todas&pagina=
 *   POST /v1/admin/transferencias/:id/asignar   { pedido: "ISU-1234" }
 *   POST /v1/admin/transferencias/:id/descartar { nota? }
 */
const Id = z.coerce.number().int().positive().max(2_147_483_647);
const POR_PAGINA = 30;

export async function rutasTransferenciasAdmin(app: FastifyInstance, deps: {
  pool: pg.Pool; env: Entorno; transferencias: Transferencias; mpConfigurado: boolean;
}) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const { pool } = deps;
  const ip = (req: FastifyRequest) => ipDe(req, deps.env.INTERNO_TOKEN);

  api.get("/v1/admin/transferencias", {
    schema: {
      querystring: z.object({
        estado: z.enum(["por_resolver", "todas"]).default("por_resolver"),
        pagina: z.coerce.number().int().min(1).max(1000).default(1),
      }).strict(),
    },
  }, async (req) => {
    await exigir(pool, req);
    const { estado, pagina } = req.query;
    const [lista, porResolver, ajuste] = await Promise.all([
      pool.query(
        `SELECT t.id, t.via, t.monto, t.pagador, t.pagador_cuit AS "pagadorCuit", t.recibida_en AS "recibidaEn", t.estado, t.nota,
                t.resuelta_por AS "resueltaPor", t.resuelta_en AS "resueltaEn", p.numero AS pedido, p.total AS "totalPedido",
                count(*) OVER()::int AS "totalFilas"
           FROM tienda.transferencias_recibidas t LEFT JOIN tienda.pedidos p ON p.id = t.pedido_id
          ${estado === "por_resolver" ? "WHERE t.estado IN ('sin_pedido', 'monto_distinto')" : ""}
          ORDER BY t.recibida_en DESC, t.id DESC LIMIT $1 OFFSET $2`, [POR_PAGINA, (pagina - 1) * POR_PAGINA]),
      pool.query<{ n: number }>("SELECT count(*)::int AS n FROM tienda.transferencias_recibidas WHERE estado IN ('sin_pedido', 'monto_distinto')"),
      leerAjusteTransferencias(pool),
    ]);
    return {
      transferencias: lista.rows.map(({ totalFilas: _t, ...r }) => r),
      total: lista.rows[0]?.totalFilas ?? 0,
      porPagina: POR_PAGINA,
      porResolver: porResolver.rows[0]?.n ?? 0,
      // Qué está prendido (Ajustes) y qué tiene credenciales en el servidor.
      estado: {
        talo: { prendido: ajuste.talo, configurado: deps.transferencias.taloActivo },
        mercadoPago: { prendido: ajuste.mercadoPago, configurado: deps.mpConfigurado },
      },
    };
  });

  api.post("/v1/admin/transferencias/:id/asignar", {
    schema: { params: z.object({ id: Id }), body: z.object({ pedido: z.string().trim().toUpperCase().regex(/^ISU-\d{4,10}$/, "Un número de pedido, como ISU-1234") }).strict() },
  }, async (req) => {
    const a = await exigir(pool, req, "operador");
    const r = await deps.transferencias.asignarAMano(req.params.id, req.body.pedido, `${a.email} (a mano)`);
    await auditar(pool, a, "asignar_transferencia", "transferencia", req.params.id, { pedido: req.body.pedido }, ip(req));
    return r;
  });

  api.post("/v1/admin/transferencias/:id/descartar", {
    schema: { params: z.object({ id: Id }), body: z.object({ nota: z.string().trim().max(300).nullable().optional() }).strict() },
  }, async (req) => {
    const a = await exigir(pool, req, "operador");
    const r = await deps.transferencias.descartar(req.params.id, req.body.nota || null, a.email);
    await auditar(pool, a, "descartar_transferencia", "transferencia", req.params.id, { nota: req.body.nota ?? null }, ip(req));
    return r;
  });
}
