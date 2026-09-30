import type pg from "pg";
import { centavos, conDescuento } from "@isu/shared";

/*
 * Descuentos masivos del backoffice, aplicados sobre el precio de Stocker.
 *
 * Un descuento vale para todo, para categorías (incluye sus subcategorías) o
 * para productos elegidos, entre dos fechas opcionales. Si a un producto le
 * tocan varios, gana el mayor: nunca se suman.
 */
interface Regla { porcentaje: number; alcance: "todo" | "categorias" | "productos"; categorias: Set<number>; productos: Set<number> }

export interface Descuentos {
  /** porcentaje de descuento (0 = ninguno) de cada producto pedido */
  para(productoIds: number[]): Promise<Map<number, number>>;
}

export function crearDescuentos(pool: pg.Pool, cache: { obtener<T>(k: string, f: () => Promise<T>): Promise<T> }): Descuentos {
  const reglas = () => cache.obtener("descuentos", async (): Promise<Regla[]> => {
    const { rows } = await pool.query<{ porcentaje: number; alcance: Regla["alcance"]; categoria_ids: number[]; producto_ids: number[] }>(
      `SELECT d.porcentaje, d.alcance, d.producto_ids,
              -- una categoría de arriba incluye sus subcategorías
              COALESCE((SELECT array_agg(c.id) FROM tienda.categorias c WHERE c.id = ANY(d.categoria_ids) OR c.padre_id = ANY(d.categoria_ids)), '{}') AS categoria_ids
         FROM tienda.descuentos d
        WHERE d.activo AND (d.desde IS NULL OR d.desde <= now()) AND (d.hasta IS NULL OR d.hasta > now())`,
    );
    return rows.map((r) => ({ porcentaje: r.porcentaje, alcance: r.alcance, categorias: new Set(r.categoria_ids), productos: new Set(r.producto_ids) }));
  });

  return {
    async para(ids) {
      const salida = new Map<number, number>();
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
        let max = 0;
        for (const r of rs) {
          const aplica = r.alcance === "todo"
            || (r.alcance === "productos" && r.productos.has(id))
            || (r.alcance === "categorias" && (porCategoria.get(id) ?? []).some((c) => r.categorias.has(c)));
          if (aplica && r.porcentaje > max) max = r.porcentaje;
        }
        if (max > 0) salida.set(id, max);
      }
      return salida;
    },
  };
}

/** Precio con descuento, redondeado al peso hacia abajo (como el de transferencia). */
export const conRebaja = (precio: number, porcentaje: number) =>
  porcentaje > 0 ? conDescuento(centavos(precio), porcentaje) : precio;
