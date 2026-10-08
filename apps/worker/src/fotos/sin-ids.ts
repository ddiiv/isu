import type pg from "pg";
import { claveNueva, type Almacen } from "@isu/almacen";

/*
 * Pasa las fotos viejas (p/139/… y b/12/…, con el id del producto o del
 * banner en la dirección) a claves sin ids (p/3f9a0c1b2d4e/…). Por cada una:
 * copia sus tamaños a la clave nueva, cambia la clave en la base y, si se
 * pide, borra los archivos viejos. Se puede cortar y volver a correr: sigue
 * con las que faltan.
 *
 * Por defecto los archivos viejos quedan: lo que Google o alguien ya tenía
 * guardado sigue andando. Con `borrarViejas` se borran.
 */
const TAMANOS_FOTO = [400, 800, 1200];
const TAMANOS_BANNER = [800, 1600, 2400];

/** `productos`: los slugs de los que cambiaron (para regenerar sus páginas). */
export interface ResultadoSinIds { fotos: number; banners: number; faltantes: string[]; productos: string[] }

async function copiar(almacen: Almacen, vieja: string, nueva: string, tamanos: number[]): Promise<boolean> {
  let alguna = false;
  for (const w of tamanos) {
    const datos = await almacen.leer(`${vieja}-${w}.webp`);
    if (!datos) continue;
    await almacen.guardar(`${nueva}-${w}.webp`, datos, "image/webp");
    alguna = true;
  }
  return alguna;
}
const borrar = async (almacen: Almacen, vieja: string, tamanos: number[]) => { for (const w of tamanos) await almacen.borrar(`${vieja}-${w}.webp`).catch(() => {}); };

export async function pasarFotosSinIds(pool: pg.Pool, almacenes: { fotos: Almacen; banners: Almacen }, o: { borrarViejas?: boolean; log?: (s: string) => void } = {}): Promise<ResultadoSinIds> {
  const log = o.log ?? (() => {});
  const r: ResultadoSinIds = { fotos: 0, banners: 0, faltantes: [], productos: [] };

  const fotos = await pool.query<{ id: number; slug: string; clave: string }>(
    "SELECT f.id, p.slug, f.clave FROM tienda.fotos f JOIN tienda.productos p ON p.id = f.producto_id WHERE f.clave ~ '^p/[0-9]+/' ORDER BY f.id");
  for (const f of fotos.rows) {
    const nueva = claveNueva("p");
    if (!(await copiar(almacenes.fotos, f.clave, nueva, TAMANOS_FOTO))) { r.faltantes.push(f.clave); log(`· ${f.clave}: no están los archivos, queda como está`); continue; }
    // Sólo si nadie la cambió mientras tanto.
    const u = await pool.query("UPDATE tienda.fotos SET clave = $1 WHERE id = $2 AND clave = $3", [nueva, f.id, f.clave]);
    if (!u.rowCount) { await borrar(almacenes.fotos, nueva, TAMANOS_FOTO); continue; }
    if (o.borrarViejas) await borrar(almacenes.fotos, f.clave, TAMANOS_FOTO);
    r.fotos++;
    if (!r.productos.includes(f.slug)) r.productos.push(f.slug);
    log(`✓ ${f.clave} → ${nueva}`);
  }

  for (const campo of ["foto", "foto_movil"] as const) {
    const bs = await pool.query<{ id: number; clave: string }>(`SELECT id, ${campo} AS clave FROM tienda.banners WHERE ${campo} ~ '^b/[0-9]+/' ORDER BY id`);
    for (const b of bs.rows) {
      const nueva = claveNueva("b");
      if (!(await copiar(almacenes.banners, b.clave, nueva, TAMANOS_BANNER))) { r.faltantes.push(b.clave); log(`· ${b.clave}: no están los archivos, queda como está`); continue; }
      const u = await pool.query(`UPDATE tienda.banners SET ${campo} = $1, actualizado_en = now() WHERE id = $2 AND ${campo} = $3`, [nueva, b.id, b.clave]);
      if (!u.rowCount) { await borrar(almacenes.banners, nueva, TAMANOS_BANNER); continue; }
      if (o.borrarViejas) await borrar(almacenes.banners, b.clave, TAMANOS_BANNER);
      r.banners++;
      log(`✓ ${b.clave} → ${nueva}`);
    }
  }
  return r;
}
