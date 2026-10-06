/*
 * Datos de muestra de la etapa 3 para probar la tienda en local:
 *   · guías de talles (adulto y niños) asociadas a los productos del catálogo
 *     de muestra que coinciden por tipo de prenda y talles,
 *   · algunos Destacados y Nuevos,
 *   · un descuento del 20 % en calzas,
 *   · dos cupones: BIENVENIDA10 (10 %, una vez por cliente) y ENVIOGRATIS
 *     (envío gratis desde $30.000).
 *   · etapa 8: tres prendas que se venden en pack, composición, opiniones de
 *     muestra (de pedidos de prueba entregados) y dos banners en la portada.
 * En producción todo esto se hace desde el backoffice.
 *
 *   node --env-file=.env scripts/demo/backoffice-demo.mjs
 */
import pg from "pg";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { crearInvalidador } from "../../apps/worker/dist/stocker/invalidar.js";
import { procesarBanner } from "../../packages/almacen/dist/index.js";

// ioredis es dependencia del worker, no de la raíz; sharp, del almacén.
const { Redis } = createRequire(new URL("../../apps/worker/package.json", import.meta.url))("ioredis");
const sharp = createRequire(new URL("../../packages/almacen/package.json", import.meta.url))("sharp");

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

// ── Etapa 8: packs, composición, opiniones de muestra y portada ──
console.warn(`Packs: ${await porNombre("pack", ["Remera Oversize Algodón Peinado", "Remera Básica Cuello Redondo", "Top Deportivo Ribb", "Musculosa Morley"])}`);
await pool.query("UPDATE tienda.productos SET composicion = '100% algodón jersey' WHERE nombre IN ('Remera Oversize Algodón Peinado', 'Remera Básica Cuello Redondo') AND composicion IS NULL");
await pool.query("DELETE FROM tienda.pedidos WHERE email LIKE 'demo-resena-%@isuwaya.test'");
const OPINIONES = [
  ["Remera Oversize Algodón Peinado", "Lucía", "Fernández", 5, "justo", "Hermosa la tela, gruesa y suave. La pedí en mi talle de siempre y quedó perfecta, oversize como dice.", "¡Llegó al día siguiente y súper bien empaquetado!"],
  ["Remera Oversize Algodón Peinado", "Martina", "Gómez", 4, "grande", "Muy linda, pero es bastante holgada: si la querés menos suelta, pedí un talle menos.", null],
  ["Top Deportivo Ribb", "Sofía", "Pérez", 5, "justo", "Lo uso para entrenar y para salir. Sostiene bien y no se transparenta.", "Excelente atención por WhatsApp, me ayudaron con el talle."],
  ["Remera Básica Cuello Redondo", "Juan", "Romero", 5, "justo", "Compré el pack de 3 y quedé re conforme. El cuello no se deforma con los lavados.", null],
  ["Buzo Canguro Frisa Premium", "Valentina", "López", 3, "chico", "Abriga mucho, pero me quedó un poco justo de mangas. Lo cambié por un talle más sin problema.", null],
];
let numeroResena = 0;
for (const [producto, nombre, apellido, estrellas, calce, texto, general] of OPINIONES) {
  const prod = (await pool.query("SELECT id, nombre FROM tienda.productos WHERE nombre = $1", [producto])).rows[0];
  if (!prod) continue;
  const v = (await pool.query("SELECT v.sku, v.talle, c.nombre AS color, v.precio FROM tienda.variantes v LEFT JOIN tienda.producto_colores c ON c.id = v.color_id WHERE v.producto_id = $1 ORDER BY v.orden LIMIT 1", [prod.id])).rows[0];
  const ped = (await pool.query(
    `INSERT INTO tienda.pedidos (acceso_hash, email, nombre, apellido, telefono, dni, entrega, local_retiro, medio_pago, subtotal, total, estado, resena_pedida_en)
     VALUES (repeat('0', 64), $1, $2, $3, '1100000000', '30000000', 'retiro', 'Vía Flores', 'local', $4, $4, 'retirado', now()) RETURNING id`,
    [`demo-resena-${++numeroResena}@isuwaya.test`, nombre, apellido, v.precio])).rows[0];
  await pool.query("INSERT INTO tienda.pedido_items (pedido_id, sku, producto_id, nombre, color, talle, precio, cantidad) VALUES ($1,$2,$3,$4,$5,$6,$7,1)", [ped.id, v.sku, prod.id, prod.nombre, v.color, v.talle, v.precio]);
  await pool.query(`INSERT INTO tienda.resenas (pedido_id, producto_id, estrellas, texto, calce, talle, color, nombre, estado, moderada_por, moderada_en)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'publicada','demo',now())`, [ped.id, prod.id, estrellas, texto, calce, v.talle, v.color, `${nombre} ${apellido[0]}.`]);
  if (general) await pool.query("INSERT INTO tienda.resenas (pedido_id, producto_id, estrellas, texto, nombre, estado) VALUES ($1, NULL, 5, $2, $3, 'publicada')", [ped.id, general, `${nombre} ${apellido[0]}.`]);
}
console.warn(`Opiniones de muestra: ${numeroResena}`);
if (process.env.FOTOS_DIR) {
  await pool.query("DELETE FROM tienda.banners WHERE alt LIKE '%(demo)'");
  const BANNERS = [
    ["Packs de remeras: llevá más, pagá menos (demo)", "/packs", "#2e6b3f", "Packs · Llevá más, pagá menos", "Hasta 20% OFF armando tu pack"],
    ["Nuevos ingresos de temporada (demo)", "/nuevos", "#2c5f91", "Nuevos ingresos", "Lo último que salió del taller"],
  ];
  for (const [i, [alt, enlace, color, titulo, bajada]] of BANNERS.entries()) {
    const svg = (w, h, t) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${color}"/>
      <circle cx="${w * 0.82}" cy="${h * 0.5}" r="${h * 0.38}" fill="#ffffff" opacity="0.12"/>
      <text x="${w * 0.07}" y="${h * 0.48}" font-family="Arial, sans-serif" font-weight="bold" font-size="${t}" fill="#fff">${titulo}</text>
      <text x="${w * 0.07}" y="${h * 0.48 + t * 1.1}" font-family="Arial, sans-serif" font-size="${t * 0.5}" fill="#fff" opacity="0.9">${bajada}</text></svg>`);
    const b = (await pool.query("INSERT INTO tienda.banners (alt, enlace, orden) VALUES ($1, $2, $3) RETURNING id", [alt, enlace, i])).rows[0];
    for (const [tipo, w, h, t] of [["foto", 2400, 900, 120], ["foto_movil", 1080, 1350, 48]]) {
      const proc = await procesarBanner(await sharp(svg(w, h, t)).png().toBuffer());
      const clave = `b/${b.id}/${randomBytes(8).toString("hex")}`;
      await mkdir(path.join(process.env.FOTOS_DIR, "b", String(b.id)), { recursive: true });
      for (const x of proc.tamanos) await writeFile(path.join(process.env.FOTOS_DIR, `${clave}-${x.ancho}.webp`), x.datos);
      await pool.query(tipo === "foto"
        ? "UPDATE tienda.banners SET foto = $2, foto_ancho = $3, foto_alto = $4 WHERE id = $1"
        : "UPDATE tienda.banners SET foto_movil = $2, movil_ancho = $3, movil_alto = $4 WHERE id = $1", [b.id, clave, proc.ancho, proc.alto]);
    }
  }
  console.warn(`Portada: ${BANNERS.length} banners`);
}
await pool.end();

const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1 });
redis.on("error", () => {});
try {
  await crearInvalidador({ redis, webUrl: process.env.WEB_INTERNAL_URL, token: process.env.REVALIDAR_TOKEN, log: { warn: () => {} } })([...slugs]);
} finally { redis.disconnect(); }
console.warn(`Listo: ${slugs.size} fichas regeneradas.`);
