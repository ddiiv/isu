import type pg from "pg";
import { centavos, conDescuento } from "@isu/shared";

/*
 * Descuentos masivos del backoffice, aplicados sobre el precio de Stocker.
 *
 * Un descuento vale para todo, para categorías (incluye sus subcategorías) o
 * para productos elegidos, entre dos fechas opcionales. Si a un producto le
 * tocan varios, gana el mayor: nunca se suman.
 */
interface Regla { porcentaje: number; hastaMs: number | null; relampago: boolean; alcance: "todo" | "categorias" | "productos"; categorias: Set<number>; productos: Set<number> }

export interface Descuentos {
  /** porcentaje de descuento (0 = ninguno) de cada producto pedido */
  para(productoIds: number[]): Promise<Map<number, number>>;
  /** cuándo termina la rebaja que se le aplica a cada producto (sólo los que tienen fin); sólo los relámpagos: el resto de los descuentos no muestra cuenta regresiva */
  vence(productoIds: number[]): Promise<Map<number, string>>;
}

export function crearDescuentos(pool: pg.Pool, cache: { obtener<T>(k: string, f: () => Promise<T>): Promise<T> }): Descuentos {
  const reglas = () => cache.obtener("descuentos", async (): Promise<Regla[]> => {
    const { rows } = await pool.query<{ porcentaje: number; hasta_ms: number | null; relampago: boolean; alcance: Regla["alcance"]; categoria_ids: number[]; producto_ids: number[] }>(
      `SELECT d.porcentaje, d.alcance, d.relampago, d.producto_ids, extract(epoch FROM d.hasta)::float8 * 1000 AS hasta_ms,
              -- una categoría de arriba incluye sus subcategorías
              COALESCE((SELECT array_agg(c.id) FROM tienda.categorias c WHERE c.id = ANY(d.categoria_ids) OR c.padre_id = ANY(d.categoria_ids)), '{}') AS categoria_ids
         FROM tienda.descuentos d
        WHERE d.activo AND (d.desde IS NULL OR d.desde <= now()) AND (d.hasta IS NULL OR d.hasta > now())
          -- los de un evento (Navidad…) sólo valen mientras el evento esté vigente
          AND (d.evento_id IS NULL OR tienda.evento_vigente(d.evento_id))`,
    );
    return rows.map((r) => ({ porcentaje: r.porcentaje, hastaMs: r.hasta_ms, relampago: r.relampago, alcance: r.alcance, categorias: new Set(r.categoria_ids), productos: new Set(r.producto_ids) }));
  });

  // Para cada producto, la regla que gana: la de mayor porcentaje (si empatan, la que termina antes).
  async function ganadoras(ids: number[]) {
      const salida = new Map<number, Regla>();
      const rs = await reglas();
      if (!rs.length || !ids.length) return salida;
      const porCategoria = new Map<number, number[]>();
      if (rs.some((r) => r.alcance === "categorias")) {
        const { rows } = await pool.query<{ producto_id: number; categoria_id: number }>(
          "SELECT producto_id, categoria_id FROM tienda.producto_categorias WHERE producto_id = ANY($1::int[])", [ids],
        );
        for (const r of rows) porCategoria.set(r.producto_id, [...(porCategoria.get(r.producto_id) ?? []), r.categoria_id]);
      }
      for (const id of ids) {
        let mejor: Regla | null = null;
        for (const r of rs) {
          const aplica = r.alcance === "todo"
            || (r.alcance === "productos" && r.productos.has(id))
            || (r.alcance === "categorias" && (porCategoria.get(id) ?? []).some((c) => r.categorias.has(c)));
          if (aplica && (!mejor || r.porcentaje > mejor.porcentaje
            || (r.porcentaje === mejor.porcentaje && r.hastaMs !== null && (mejor.hastaMs === null || r.hastaMs < mejor.hastaMs)))) mejor = r;
        }
        if (mejor && mejor.porcentaje > 0) salida.set(id, mejor);
      }
      return salida;
  }

  return {
    async para(ids) {
      return new Map([...await ganadoras(ids)].map(([id, r]) => [id, r.porcentaje]));
    },
    async vence(ids) {
      return new Map([...await ganadoras(ids)].filter(([, r]) => r.relampago && r.hastaMs !== null).map(([id, r]) => [id, new Date(r.hastaMs!).toISOString()]));
    },
  };
}

/**
 * Precio con descuento, redondeado al peso hacia abajo (como el de transferencia). `mayorista` es el piso:
 * la rebaja no lo baja. Sin mayorista cargado (o mayor que el precio) no se puede verificar el piso: no hay rebaja.
 */
export const conRebaja = (precio: number, porcentaje: number, mayorista: number | null = null) => {
  if (porcentaje <= 0 || mayorista === null || mayorista >= precio) return precio;
  return Math.max(conDescuento(centavos(precio), porcentaje), mayorista);
};

/** El mayor porcentaje (0–90) que la rebaja puede tener sin bajar del mayorista; 0 si no hay rebaja posible. */
export const descuentoMaximo = (precio: number, mayorista: number | null) => {
  if (mayorista === null || mayorista >= precio) return 0;
  for (let p = 90; p > 0; p--) if (conDescuento(centavos(precio), p) >= mayorista) return p;
  return 0;
};
