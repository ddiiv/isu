/*
 * Datos de muestra de la etapa 3 para probar la tienda en local:
 *   · guías de talles (adulto y niños) asociadas a los productos del catálogo
 *     de muestra que coinciden por tipo de prenda y talles,
 *   · algunos Destacados y Nuevos,
 *   · un descuento del 20 % en calzas,
 *   · dos cupones: BIENVENIDA10 (10 %, una vez por cliente) y ENVIOGRATIS
 *     (envío gratis desde $30.000).
 * En producción todo esto se hace desde el backoffice.
 *
 *   node --env-file=.env scripts/demo/backoffice-demo.mjs
 */
import pg from "pg";
import { createRequire } from "node:module";
import { crearInvalidador } from "../../apps/worker/dist/stocker/invalidar.js";

// ioredis es dependencia del worker, no de la raíz.
const { Redis } = createRequire(new URL("../../apps/worker/package.json", import.meta.url))("ioredis");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const r = (a, b = a) => [a, b];
const GUIAS = [
  { nombre: "Remera y top adulto", tipo: "adulto", medidas: ["pecho", "cintura", "largo"], categorias: ["remeras", "tops"], genero: null,
    filas: [["XS", r(80, 84), r(62, 66), r(66)], ["S", r(84, 90), r(66, 72), r(68)], ["M", r(90, 96), r(72, 78), r(70)], ["L", r(96, 102), r(78, 84), r(72)], ["XL", r(102, 108), r(84, 90), r(74)], ["XXL", r(108, 116), r(90, 98), r(76)]] },
  { nombre: "Buzo y campera adulto", tipo: "adulto", medidas: ["pecho", "largo", "manga"], categorias: ["buzos", "camperas"], genero: null,
    filas: [["S", r(88, 94), r(66), r(60)], ["M", r(94, 100), r(68), r(62)], ["L", r(100, 106), r(70), r(64)], ["XL", r(106, 112), r(72), r(65)], ["XXL", r(112, 120), r(74), r(66)]] },
  { nombre: "Pantalón, calza y short adulto", tipo: "adulto", medidas: ["cintura", "cadera", "largo"], categorias: ["pantalones", "calzas", "shorts", "bermudas"], genero: null,
    filas: [["S", r(66, 72), r(90, 96), r(100)], ["M", r(72, 78), r(96, 102), r(102)], ["L", r(78, 86), r(102, 108), r(104)], ["XL", r(86, 94), r(108, 114), r(106)], ["XXL", r(94, 102), r(114, 120), r(108)]] },
  { nombre: "Niños (remeras, buzos y camperas)", tipo: "nino", medidas: ["altura", "edad", "pecho"], categorias: ["remeras", "buzos", "camperas"], genero: "Niños",
    filas: [["4", r(98, 104), r(3, 4), r(54, 56)], ["6", r(110, 116), r(5, 6), r(58, 60)], ["8", r(122, 128), r(7, 8), r(62, 64)], ["10", r(134, 140), r(9, 10), r(66, 68)], ["12", r(146, 152), r(11, 12), r(70, 73)], ["14", r(152, 158), r(13, 14), r(74, 77)], ["16", r(158, 164), r(15, 16), r(78, 81)]] },
  { nombre: "Niños (pantalones)", tipo: "nino", medidas: ["altura", "edad", "cintura"], categorias: ["pantalones"], genero: "Niños",
    filas: [["4", r(98, 104), r(3, 4), r(51, 53)], ["6", r(110, 116), r(5, 6), r(53, 55)], ["8", r(122, 128), r(7, 8), r(56, 58)], ["10", r(134, 140), r(9, 10), r(59, 61)], ["12", r(146, 152), r(11, 12), r(62, 64)], ["14", r(152, 158), r(13, 14), r(65, 67)], ["16", r(158, 164), r(15, 16), r(68, 70)]] },
];

const productos = (await pool.query(`SELECT p.id, p.slug, lower(COALESCE(p.stocker_categoria,'')) AS cat, p.stocker_genero AS genero,
  COALESCE((SELECT array_agg(DISTINCT upper(v.talle)) FROM tienda.variantes v WHERE v.producto_id = p.id AND v.activo), '{}') AS talles
  FROM tienda.productos p WHERE p.en_stocker`)).rows;
const slugs = new Set();
for (const g of GUIAS) {
  const filas = g.filas.map(([talle, ...valores]) => ({ talle, valores }));
  const { rows } = await pool.query(
    `INSERT INTO tienda.guias_talles (nombre, tipo, medidas, filas, nota, actualizado_por) VALUES ($1,$2,$3,$4,$5,'demo')
     ON CONFLICT (lower(nombre)) DO UPDATE SET medidas = EXCLUDED.medidas, filas = EXCLUDED.filas, actualizado_en = now() RETURNING id`,
    [g.nombre, g.tipo, JSON.stringify(g.medidas), JSON.stringify(filas), g.tipo === "nino" ? "Medidas del cuerpo en cm. La edad es orientativa: guiate por la altura." : "Contornos del cuerpo y largo de la prenda, en cm."]);
  const tallesGuia = new Set(filas.map((f) => f.talle));
  const cuales = productos.filter((p) => g.categorias.some((c) => p.cat.startsWith(c.slice(0, -1)))
    && (g.genero ? p.genero === g.genero : p.genero !== "Niños")
    && p.talles.length && p.talles.every((t) => tallesGuia.has(t)));
  if (cuales.length) await pool.query("UPDATE tienda.productos SET guia_talles_id = $1 WHERE id = ANY($2::int[])", [rows[0].id, cuales.map((p) => p.id)]);
  cuales.forEach((p) => slugs.add(p.slug));
  console.warn(`Guía "${g.nombre}": ${cuales.length} productos`);
}

const porNombre = async (col, nombres, extra = "") => {
  const { rows } = await pool.query(`UPDATE tienda.productos SET ${col} = true${extra} WHERE nombre = ANY($1::text[]) RETURNING slug`, [nombres]);
  rows.forEach((x) => slugs.add(x.slug));
  return rows.length;
};
console.warn(`Destacados: ${await porNombre("destacado", ["Buzo Canguro Frisa Premium", "Palazzo Fibrana Estampado", "Remera Oversize Algodón Peinado", "Calza Deportiva Tiro Alto"])}`);
console.warn(`Nuevos: ${await porNombre("nuevo", ["Top Deportivo Ribb", "Buzo Crop Friza", "Short Biker Lycra", "Remera Estampada Niños", "Campera Inflable Niños"], ", nuevo_desde = COALESCE(nuevo_desde, now())")}`);
await pool.query("DELETE FROM tienda.descuentos WHERE creado_por = 'demo'");
await pool.query(`INSERT INTO tienda.descuentos (nombre, porcentaje, alcance, producto_ids, creado_por)
  SELECT 'Calzas 20% (demo)', 20, 'productos', array_agg(id), 'demo' FROM tienda.productos WHERE lower(stocker_categoria) LIKE 'calza%' HAVING count(*) > 0`);
await pool.query(`INSERT INTO tienda.cupones (codigo, nombre, tipo, valor, minimo, usos_por_cliente, creado_por) VALUES
  ('BIENVENIDA10', '10% OFF de bienvenida', 'porcentaje', 10, 0, 1, 'demo'),
  ('ENVIOGRATIS', 'Envío gratis desde $30.000', 'envio_gratis', 0, 3000000, NULL, 'demo')
  ON CONFLICT (codigo) WHERE codigo IS NOT NULL DO NOTHING`);
await pool.end();

const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1 });
redis.on("error", () => {});
try {
  await crearInvalidador({ redis, webUrl: process.env.WEB_INTERNAL_URL, token: process.env.REVALIDAR_TOKEN, log: { warn: () => {} } })([...slugs]);
} finally { redis.disconnect(); }
console.warn(`Listo: ${slugs.size} fichas regeneradas.`);
