import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, writeFile, cp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crearPool } from "./conexion.js";
import { migrar } from "./migrar.js";

/*
 * Contra una base REAL que ya tiene las tablas de Stocker (stocker_test), que
 * es como va a estar en producción: la tienda vive al lado, en su esquema.
 */
const URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:5433/stocker_test";
const pool = crearPool({ url: URL, max: 6 });
const MIGRACIONES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migraciones");

async function tablasDe(esquema: string) {
  const { rows } = await pool.query<{ t: string; h: string }>(
    `SELECT c.relname AS t, md5(string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' ORDER BY a.attnum)) AS h
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      WHERE n.nspname = $1 AND c.relkind = 'r' GROUP BY c.relname ORDER BY c.relname`,
    [esquema],
  );
  return rows;
}

let publicAntes: Awaited<ReturnType<typeof tablasDe>>;

beforeAll(async () => {
  publicAntes = await tablasDe("public");
  await pool.query("DROP SCHEMA IF EXISTS tienda CASCADE");
});
afterAll(async () => {
  // La base de pruebas es la misma del desarrollo local: no dejar nada que se vea en la tienda.
  await pool.query("DELETE FROM tienda.descuentos WHERE creado_por = 'qa'").catch(() => {});
  await pool.query("DELETE FROM tienda.admins WHERE email LIKE 'qa-db%'").catch(() => {});
  await pool.query("DELETE FROM tienda.productos WHERE stocker_padre LIKE 'QA-%'").catch(() => {});
  await pool.query("DELETE FROM tienda.pedidos WHERE email IN ('a@b.c', 'qa-db@test.com', 'qa-db-envio@test.com')").catch(() => {});
  await pool.end();
});

describe("migraciones", () => {
  it("aplica todo la primera vez y nada la segunda", async () => {
    const r1 = await migrar(pool);
    expect(r1.aplicadas.length).toBeGreaterThanOrEqual(3);
    const r2 = await migrar(pool);
    expect(r2.aplicadas).toEqual([]);
    expect(r2.yaEstaban.length).toBe(r1.aplicadas.length);
  });

  it("no toca ni una tabla de Stocker (esquema public)", async () => {
    expect(publicAntes.length).toBeGreaterThan(0); // la base de prueba sí tiene Stocker
    expect(await tablasDe("public")).toEqual(publicAntes);
  });

  it("dos réplicas migrando a la vez no chocan", async () => {
    await pool.query("DROP SCHEMA tienda CASCADE");
    const [a, b] = await Promise.all([migrar(pool), migrar(pool)]);
    expect(a.aplicadas.length + b.aplicadas.length).toBe(a.aplicadas.length || b.aplicadas.length);
  });

  it("frena si alguien edita una migración ya aplicada", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "mig-"));
    await cp(MIGRACIONES, dir, { recursive: true });
    await writeFile(path.join(dir, "0001_base.sql"), "-- editada\n");
    await expect(migrar(pool, dir)).rejects.toThrow(/cambió después de aplicada/);
  });

  it("carga los ajustes y las categorías iniciales", async () => {
    const { rows } = await pool.query("SELECT clave FROM tienda.ajustes ORDER BY clave");
    expect(rows.map((r) => r.clave)).toContain("whatsapp");
    const { rows: cats } = await pool.query("SELECT count(*)::int AS n FROM tienda.categorias WHERE padre_id IS NULL");
    expect(cats[0].n).toBe(3);
  });
});

describe("categorías", () => {
  it("dos niveles como máximo", async () => {
    const { rows } = await pool.query("SELECT id FROM tienda.categorias WHERE padre_id IS NOT NULL LIMIT 1");
    await expect(
      pool.query("INSERT INTO tienda.categorias (padre_id, nombre, slug) VALUES ($1, 'Nieta', 'nieta')", [rows[0].id]),
    ).rejects.toThrow(/dos niveles/);
  });
  it("una categoría con hijas no puede volverse subcategoría", async () => {
    const { rows } = await pool.query("SELECT id FROM tienda.categorias WHERE slug IN ('hombre','mujer') ORDER BY slug");
    await expect(
      pool.query("UPDATE tienda.categorias SET padre_id = $1 WHERE id = $2", [rows[1].id, rows[0].id]),
    ).rejects.toThrow(/no puede pasar a ser subcategoría/);
  });
  it("slug inválido rechazado", async () => {
    await expect(pool.query("INSERT INTO tienda.categorias (nombre, slug) VALUES ('X', 'Con Espacios')")).rejects.toThrow();
  });
});

describe("fotos: 5 por color, 5 × colores por producto", () => {
  let producto: number;
  let negro: number;
  let blanco: number;

  beforeAll(async () => {
    const p = await pool.query("INSERT INTO tienda.productos (stocker_padre, nombre, slug) VALUES ('ISUTEST', 'Test', 'test') RETURNING id");
    producto = p.rows[0].id;
    const c = await pool.query(
      "INSERT INTO tienda.producto_colores (producto_id, clave, nombre) VALUES ($1,'negro','Negro'),($1,'blanco','Blanco') RETURNING id",
      [producto],
    );
    [negro, blanco] = c.rows.map((r) => r.id);
  });

  let n = 0;
  const foto = (tipo: string, color: number | null) =>
    pool.query("INSERT INTO tienda.fotos (producto_id, tipo, color_id, clave) VALUES ($1,$2,$3,$4)", [producto, tipo, color, `t/${++n}.jpg`]);

  it("una de color necesita color", async () => {
    await expect(foto("color", null)).rejects.toThrow();
  });

  it("la sexta foto de un color no entra", async () => {
    for (let i = 0; i < 5; i++) await foto("color", negro);
    await expect(foto("color", negro)).rejects.toThrow(/ya tiene 5 fotos/);
  });

  it("las de exhibición cuentan para el tope del padre (2 colores → 10)", async () => {
    await foto("color", blanco);
    await foto("color", blanco);
    await foto("exhibicion", null);
    await foto("exhibicion", negro); // la modelo lleva el negro
    await foto("exhibicion", null); // 5 + 2 + 3 = 10: la décima entra
    await expect(foto("exhibicion", null)).rejects.toThrow(/ya tiene 10 fotos/);
    await expect(foto("color", blanco)).rejects.toThrow(/ya tiene 10 fotos/);
  });

  it("no se puede usar el color de otro producto", async () => {
    const otro = await pool.query("INSERT INTO tienda.productos (stocker_padre, nombre, slug) VALUES ('ISUOTRO','Otro','otro') RETURNING id");
    await expect(
      pool.query("INSERT INTO tienda.fotos (producto_id, tipo, color_id, clave) VALUES ($1,'color',$2,'x/1.jpg')", [otro.rows[0].id, negro]),
    ).rejects.toThrow(/no es de este producto/);
  });

  it("subidas simultáneas no se saltean el tope", async () => {
    const p = await pool.query("INSERT INTO tienda.productos (stocker_padre, nombre, slug) VALUES ('ISUCARRERA','C','carrera') RETURNING id");
    const c = await pool.query("INSERT INTO tienda.producto_colores (producto_id, clave, nombre) VALUES ($1,'rojo','Rojo') RETURNING id", [p.rows[0].id]);
    const intentos = Array.from({ length: 12 }, (_, i) =>
      pool.query("INSERT INTO tienda.fotos (producto_id, tipo, color_id, clave) VALUES ($1,'color',$2,$3)", [p.rows[0].id, c.rows[0].id, `carrera/${i}.jpg`])
        .then(() => "ok", () => "no"),
    );
    const r = await Promise.all(intentos);
    expect(r.filter((x) => x === "ok").length).toBe(5);
  });
});

describe("auditoría", () => {
  it("se agrega pero no se edita ni se borra", async () => {
    await pool.query("INSERT INTO tienda.auditoria (actor, accion, entidad) VALUES ('qa','prueba','test')");
    await expect(pool.query("UPDATE tienda.auditoria SET actor = 'otro'")).rejects.toThrow(/no se modifica/);
    await expect(pool.query("DELETE FROM tienda.auditoria")).rejects.toThrow(/no se modifica/);
  });
});

describe("catálogo de Stocker (0004)", () => {
  let producto: number;
  beforeAll(async () => {
    const p = await pool.query(
      "INSERT INTO tienda.productos (stocker_padre, stocker_id, nombre, slug, stocker_categoria, stocker_genero) VALUES ('ISU-C1', 9001, 'Remera Básica Algodón', 'remera-basica-algodon', 'Remeras', 'Mujer') RETURNING id",
    );
    producto = p.rows[0].id;
  });

  it("el SKU padre se puede repetir; el id de Stocker no", async () => {
    await pool.query("INSERT INTO tienda.productos (stocker_padre, stocker_id, nombre, slug) VALUES ('ISU-C1', 9002, 'Otra', 'otra-c1')");
    await expect(
      pool.query("INSERT INTO tienda.productos (stocker_padre, stocker_id, nombre, slug) VALUES ('X', 9001, 'Dup', 'dup-c1')"),
    ).rejects.toThrow(/duplicate key/);
  });

  it("la búsqueda ignora tildes y mayúsculas", async () => {
    const { rows } = await pool.query(
      "SELECT id FROM tienda.productos WHERE busqueda @@ plainto_tsquery('simple', translate(lower('BASICA algodon'), 'áéíóúüñ', 'aeiouun'))",
    );
    expect(rows.map((r) => r.id)).toContain(producto);
  });

  it("una variante: precio y stock nunca negativos, SKU único", async () => {
    const ins = (sku: string, sid: number, precio: number, stock: number) =>
      pool.query("INSERT INTO tienda.variantes (producto_id, stocker_id, sku, precio, stock) VALUES ($1,$2,$3,$4,$5)", [producto, sid, sku, precio, stock]);
    await ins("ISU-C1-M", 1, 1200000, 3);
    await expect(ins("ISU-C1-L", 2, -1, 0)).rejects.toThrow(/check/);
    await expect(ins("ISU-C1-L", 3, 100, -2)).rejects.toThrow(/check/);
    await expect(ins("ISU-C1-M", 4, 100, 1)).rejects.toThrow(/duplicate key/);
  });

  it("borrar un color deja la variante sin color (no la borra)", async () => {
    const c = await pool.query("INSERT INTO tienda.producto_colores (producto_id, clave, nombre) VALUES ($1,'negro','Negro') RETURNING id", [producto]);
    await pool.query("UPDATE tienda.variantes SET color_id = $1 WHERE sku = 'ISU-C1-M'", [c.rows[0].id]);
    await pool.query("DELETE FROM tienda.producto_colores WHERE id = $1", [c.rows[0].id]);
    const { rows } = await pool.query("SELECT color_id FROM tienda.variantes WHERE sku = 'ISU-C1-M'");
    expect(rows[0].color_id).toBeNull();
  });

  it("siembra los ajustes nuevos", async () => {
    const { rows } = await pool.query("SELECT clave, valor FROM tienda.ajustes WHERE clave IN ('publicarNuevos','mostrarAgotados','avisoUltimas') ORDER BY clave");
    expect(rows).toEqual([
      { clave: "avisoUltimas", valor: 3 }, { clave: "mostrarAgotados", valor: true }, { clave: "publicarNuevos", valor: true },
    ]);
  });
});

describe("pedidos y pagos (0005)", () => {
  const base = (extra: Record<string, unknown> = {}) => ({
    acceso_hash: "a".repeat(64), email: "qa-db@test.com", nombre: "A", apellido: "B", telefono: "1", dni: "2",
    entrega: "retiro", local_retiro: "Flores", medio_pago: "transferencia", subtotal: 1000, descuento: 200, envio: 0, total: 800, estado: "x", ...extra,
  });
  const insertar = (o: Record<string, unknown>) => {
    const k = Object.keys(o);
    return pool.query(`INSERT INTO tienda.pedidos (${k.join(",")}) VALUES (${k.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id, numero`, Object.values(o));
  };
  it("el número sale solo y es único; el total tiene que cerrar", async () => {
    const a = await insertar(base());
    expect(a.rows[0].numero).toMatch(/^ISU-\d+$/);
    await expect(insertar(base({ total: 1 }))).rejects.toThrow(/check/);
  });
  it("pagar en el local exige retiro; envío exige dirección", async () => {
    await expect(insertar(base({ medio_pago: "local", entrega: "envio", local_retiro: null, direccion: JSON.stringify({ calle: "x" }) }))).rejects.toThrow(/check/);
    await expect(insertar(base({ entrega: "envio", local_retiro: null }))).rejects.toThrow(/check/);
  });
  it("un pago no se registra dos veces (mismo proveedor y referencia)", async () => {
    const p = await insertar(base());
    const pago = () => pool.query("INSERT INTO tienda.pagos (pedido_id, proveedor, externo, estado, monto) VALUES ($1,'transferencia','OP-1','aprobado',800)", [p.rows[0].id]);
    await pago();
    await expect(pago()).rejects.toThrow(/duplicate key/);
  });
  it("el historial del pedido no se edita ni se borra (salvo borrando el pedido entero)", async () => {
    const p = await insertar(base());
    await pool.query("INSERT INTO tienda.pedido_eventos (pedido_id, estado, actor) VALUES ($1,'x','qa')", [p.rows[0].id]);
    await expect(pool.query("UPDATE tienda.pedido_eventos SET actor = 'otro' WHERE pedido_id = $1", [p.rows[0].id])).rejects.toThrow(/no se modifica/);
    await expect(pool.query("DELETE FROM tienda.pedido_eventos WHERE pedido_id = $1", [p.rows[0].id])).rejects.toThrow(/no se modifica/);
    await pool.query("DELETE FROM tienda.pedidos WHERE id = $1", [p.rows[0].id]);
  });
  it("el email del cliente se guarda en minúsculas", async () => {
    await expect(pool.query("INSERT INTO tienda.clientes (email, nombre) VALUES ('Mayus@Test.com','A')")).rejects.toThrow(/check/);
  });
});

describe("backoffice (0006)", () => {
  it("admins: email en minúsculas, rol válido, único", async () => {
    await expect(pool.query("INSERT INTO tienda.admins (email, nombre, hash, rol) VALUES ('A@b.com','A','h','dueno')")).rejects.toThrow(/check/);
    await expect(pool.query("INSERT INTO tienda.admins (email, nombre, hash, rol) VALUES ('a@b.com','A','h','root')")).rejects.toThrow(/check/);
    await pool.query("INSERT INTO tienda.admins (email, nombre, hash, rol) VALUES ('qa-db@b.com','A','h','dueno')");
    await expect(pool.query("INSERT INTO tienda.admins (email, nombre, hash, rol) VALUES ('qa-db@b.com','B','h','lectura')")).rejects.toThrow(/duplicate key/);
    const r = await pool.query("SELECT debe_cambiar_clave, totp_activo FROM tienda.admins WHERE email = 'qa-db@b.com'");
    expect(r.rows[0]).toEqual({ debe_cambiar_clave: true, totp_activo: false });
  });
  it("descuentos: entre 1 y 90 %, fechas en orden, alcance con algo elegido", async () => {
    const ins = (pct: number, alcance = "todo", cats = "{}", desde: string | null = null, hasta: string | null = null) =>
      pool.query("INSERT INTO tienda.descuentos (nombre, porcentaje, alcance, categoria_ids, desde, hasta, creado_por) VALUES ('x',$1,$2,$3,$4,$5,'qa')", [pct, alcance, cats, desde, hasta]);
    await expect(ins(0)).rejects.toThrow(/check/);
    await expect(ins(91)).rejects.toThrow(/check/);
    await expect(ins(10, "categorias")).rejects.toThrow(/check/);
    await expect(ins(10, "todo", "{}", "2026-02-01", "2026-01-01")).rejects.toThrow(/check/);
    await ins(10, "categorias", "{1}");
  });
  it("precio de lista del ítem nunca menor al cobrado", async () => {
    const p = await pool.query("INSERT INTO tienda.pedidos (acceso_hash,email,nombre,apellido,telefono,dni,entrega,local_retiro,medio_pago,subtotal,total,estado) VALUES ($1,'a@b.c','A','B','1','2','retiro','F','local',100,100,'x') RETURNING id", ["b".repeat(64)]);
    await expect(pool.query("INSERT INTO tienda.pedido_items (pedido_id, sku, nombre, precio, precio_lista, cantidad) VALUES ($1,'S','N',100,90,1)", [p.rows[0].id])).rejects.toThrow(/check/);
    await pool.query("INSERT INTO tienda.pedido_items (pedido_id, sku, nombre, precio, precio_lista, cantidad) VALUES ($1,'S','N',90,100,1)", [p.rows[0].id]);
  });
});

describe("guías de talles y outfits (0007)", () => {
  it("una guía necesita medidas y filas; el nombre no se repite (sin importar mayúsculas)", async () => {
    const ins = (nombre: string, medidas: string, filas: string) => pool.query("INSERT INTO tienda.guias_talles (nombre, tipo, medidas, filas) VALUES ($1,'adulto',$2,$3) RETURNING id", [nombre, medidas, filas]);
    await expect(ins("Remera", "[]", '[{"talle":"M"}]')).rejects.toThrow(/check/);
    await expect(ins("Remera", '["pecho"]', "{}")).rejects.toThrow(/check/);
    const g = await ins("Remera", '["pecho"]', '[{"talle":"M","valores":[[90,95]]}]');
    await expect(ins("REMERA", '["pecho"]', '[{"talle":"M","valores":[[90,95]]}]')).rejects.toThrow(/duplicate key/);
    // Borrar la guía deja al producto sin guía (no lo borra).
    const p = await pool.query("INSERT INTO tienda.productos (stocker_padre, nombre, slug, guia_talles_id, parte_outfit) VALUES ('QA-G','x','qa-guia',$1,'arriba') RETURNING id", [g.rows[0].id]);
    await pool.query("DELETE FROM tienda.guias_talles WHERE id = $1", [g.rows[0].id]);
    const r = await pool.query("SELECT guia_talles_id FROM tienda.productos WHERE id = $1", [p.rows[0].id]);
    expect(r.rows[0].guia_talles_id).toBeNull();
    await expect(pool.query("UPDATE tienda.productos SET parte_outfit = 'zapatos' WHERE id = $1", [p.rows[0].id])).rejects.toThrow(/check/);
  });
});

describe("envíos (0008)", () => {
  const pedido = async (extra: Record<string, unknown> = {}) => {
    const b = { acceso_hash: "d".repeat(64), email: "qa-db-envio@test.com", nombre: "A", apellido: "B", telefono: "1", dni: "2", entrega: "envio",
      direccion: JSON.stringify({ calle: "x", numero: "1", cp: "1406", localidad: "CABA", provincia: "CABA" }), medio_pago: "transferencia",
      subtotal: 1000, total: 1000, estado: "pagado", transporte: "andreani", servicio_envio: "domicilio", ...extra };
    const k = Object.keys(b);
    return (await pool.query(`INSERT INTO tienda.pedidos (${k.join(",")}) VALUES (${k.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id`, Object.values(b))).rows[0].id as number;
  };
  it("un envío a domicilio necesita transporte; a sucursal, la sucursal", async () => {
    await expect(pedido({ transporte: null })).rejects.toThrow(/check/);
    await expect(pedido({ servicio_envio: "sucursal" })).rejects.toThrow(/check/);
    await expect(pedido({ entrega: "retiro", local_retiro: "Flores", direccion: null })).rejects.toThrow(/check/);
    await expect(pedido({ transporte: "dron" })).rejects.toThrow(/check/);
    await pedido({ servicio_envio: "sucursal", sucursal_envio: JSON.stringify({ id: "X1", nombre: "Suc" }) });
  });
  it("un solo envío vigente por pedido; el número de seguimiento sin caracteres raros y único por transporte", async () => {
    const id = await pedido();
    const envio = (seg: string, activo = true) => pool.query("INSERT INTO tienda.envios (pedido_id, transporte, servicio, seguimiento, activo) VALUES ($1,'andreani','domicilio',$2,$3)", [id, seg, activo]);
    await envio("360000000001");
    await expect(envio("360000000002")).rejects.toThrow(/duplicate key/);
    await envio("360000000003", false);
    await expect(envio("36000'; DROP")).rejects.toThrow(/check/);
    const otro = await pedido();
    await expect(pool.query("INSERT INTO tienda.envios (pedido_id, transporte, servicio, seguimiento) VALUES ($1,'andreani','domicilio','360000000001')", [otro])).rejects.toThrow(/duplicate key/);
  });
  it("eventos y avisos no se repiten", async () => {
    const id = await pedido();
    const e = (await pool.query("INSERT INTO tienda.envios (pedido_id, transporte, servicio, seguimiento) VALUES ($1,'oca','domicilio','OCA123456') RETURNING id", [id])).rows[0].id;
    const ev = () => pool.query("INSERT INTO tienda.envio_eventos (envio_id, fecha, estado, descripcion) VALUES ($1,'2026-09-28T10:00:00Z','en_camino','En tránsito')", [e]);
    await ev();
    await expect(ev()).rejects.toThrow(/duplicate key/);
    const av = () => pool.query("INSERT INTO tienda.avisos (pedido_id, tipo, canal) VALUES ($1,'en_camino','whatsapp')", [id]);
    await av();
    await expect(av()).rejects.toThrow(/duplicate key/);
    await expect(pool.query("INSERT INTO tienda.avisos (pedido_id, tipo, canal) VALUES ($1,'en_camino','sms')", [id])).rejects.toThrow(/check/);
  });
  it("siembra los ajustes de envíos", async () => {
    const r = await pool.query("SELECT clave FROM tienda.ajustes WHERE clave = ANY($1::text[]) ORDER BY clave", [["transportes", "origenEnvios", "paqueteEnvios", "enviosEnElDia", "avisosWhatsapp"]]);
    expect(r.rows.map((x) => x.clave)).toEqual(["avisosWhatsapp", "enviosEnElDia", "origenEnvios", "paqueteEnvios", "transportes"]);
  });
});

describe("asistente (0009)", () => {
  const faq = (extra: Record<string, unknown> = {}) => {
    const b = { pregunta: "QA db ¿pregunta?", respuesta: "Una respuesta.", tema: "general", ...extra };
    const k = Object.keys(b);
    return pool.query(`INSERT INTO tienda.faq (${k.join(",")}) VALUES (${k.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id`, Object.values(b));
  };
  afterAll(async () => { await pool.query("DELETE FROM tienda.faq WHERE pregunta LIKE 'QA db%'"); });
  it("siembra preguntas frecuentes y los ajustes del asistente", async () => {
    expect((await pool.query("SELECT count(*)::int AS n FROM tienda.faq WHERE activo")).rows[0].n).toBeGreaterThanOrEqual(15);
    expect((await pool.query("SELECT count(*)::int AS n FROM tienda.ajustes WHERE clave IN ('chatbot', 'chatbotIa')")).rows[0].n).toBe(2);
  });
  it("los enlaces son sólo de la tienda (ni otro sitio ni //otro.sitio)", async () => {
    await faq({ enlace_texto: "Cambios", enlace_url: "/devoluciones" });
    for (const url of ["https://evil.test", "//evil.test", "/\\evil.test", "javascript:alert(1)"]) {
      await expect(faq({ enlace_texto: "x", enlace_url: url })).rejects.toThrow(/check/);
    }
    await expect(faq({ enlace_texto: "x" })).rejects.toThrow(/check/); // texto sin dirección
  });
  it("tema de la lista y textos no vacíos", async () => {
    await expect(faq({ tema: "hackeo" })).rejects.toThrow(/check/);
    await expect(faq({ respuesta: "   " })).rejects.toThrow(/check/);
  });
});

describe("importación del mayorista (0010)", () => {
  it("una foto no se importa dos veces del mismo origen en el mismo producto", async () => {
    const p = (await pool.query("INSERT INTO tienda.productos (stocker_padre, nombre, slug) VALUES ('QA-DB-MAY','QA db mayorista','qa-db-mayorista') RETURNING id")).rows[0].id;
    try {
      await pool.query("INSERT INTO tienda.producto_colores (producto_id, clave, nombre) VALUES ($1,'negro','Negro')", [p]);
      await pool.query("INSERT INTO tienda.fotos (producto_id, tipo, clave, origen) VALUES ($1,'exhibicion','p/1/qadbmay00001','mayorista:abc')", [p]);
      await expect(pool.query("INSERT INTO tienda.fotos (producto_id, tipo, clave, origen) VALUES ($1,'exhibicion','p/1/qadbmay00002','mayorista:abc')", [p])).rejects.toThrow(/fotos_origen/);
      // Sin origen (subidas a mano), las que sean.
      await pool.query("INSERT INTO tienda.fotos (producto_id, tipo, clave) VALUES ($1,'exhibicion','p/1/qadbmay00003'), ($1,'exhibicion','p/1/qadbmay00004')", [p]);
    } finally {
      await pool.query("DELETE FROM tienda.productos WHERE id = $1", [p]);
    }
  });
});

describe("cupones (0011)", () => {
  const cupon = (extra: Record<string, unknown> = {}) => {
    const b = { codigo: "QADB10", nombre: "QA db cupón", tipo: "porcentaje", valor: 10, creado_por: "qa", ...extra };
    const k = Object.keys(b);
    return pool.query(`INSERT INTO tienda.cupones (${k.join(",")}) VALUES (${k.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id`, Object.values(b));
  };
  afterAll(async () => {
    await pool.query("DELETE FROM tienda.pedidos WHERE email = 'qa-db-cupon@test.com'");
    await pool.query("DELETE FROM tienda.cupones WHERE nombre LIKE 'QA db%'");
  });
  it("código en mayúsculas y único; promo sin código; valores en rango", async () => {
    await cupon();
    await expect(cupon()).rejects.toThrow(/cupones_codigo/);
    for (const mal of [{ codigo: "qadb" }, { codigo: "QA DB" }, { codigo: "Q" }, { codigo: null }, { automatico: true },
      { codigo: "QADB2", valor: 95 }, { codigo: "QADB3", tipo: "monto", valor: 50 }, { codigo: "QADB4", tipo: "envio_gratis", valor: 5 },
      { codigo: "QADB5", alcance: "productos" }, { codigo: "QADB6", usos_max: 0 }]) {
      await expect(cupon(mal), JSON.stringify(mal)).rejects.toThrow(/check|violates/);
    }
    await cupon({ codigo: null, automatico: true, minimo: 1000 });
  });
  it("el total del pedido cierra con el cupón; si el pedido se cae, el uso se libera solo (y vuelve si se paga tarde)", async () => {
    const c = (await pool.query("SELECT id FROM tienda.cupones WHERE codigo = 'QADB10'")).rows[0].id;
    const ins = (total: number) => pool.query(
      `INSERT INTO tienda.pedidos (acceso_hash, email, nombre, apellido, telefono, dni, entrega, local_retiro, medio_pago, subtotal, descuento_cupon, descuento, envio, total, estado, cupon_id)
       VALUES ('x','qa-db-cupon@test.com','A','B','1','1','retiro','L','local',1000000,100000,0,0,$1,'a_pagar_en_local',$2) RETURNING id`, [total, c]);
    await expect(ins(1_000_000)).rejects.toThrow(/pedidos_total_cuadra/);
    const p = (await ins(900_000)).rows[0].id;
    await pool.query("UPDATE tienda.cupones SET usos = 1 WHERE id = $1", [c]);
    await pool.query("INSERT INTO tienda.cupon_usos (cupon_id, pedido_id, email, descuento) VALUES ($1,$2,'qa-db-cupon@test.com',100000)", [c, p]);
    const usos = async () => (await pool.query("SELECT usos FROM tienda.cupones WHERE id = $1", [c])).rows[0].usos;
    await pool.query("UPDATE tienda.pedidos SET estado = 'vencido' WHERE id = $1", [p]);
    expect(await usos()).toBe(0);
    await pool.query("UPDATE tienda.pedidos SET estado = 'cancelado' WHERE id = $1", [p]); // de caído a caído: nada
    expect(await usos()).toBe(0);
    await pool.query("UPDATE tienda.pedidos SET estado = 'pagado_tarde' WHERE id = $1", [p]);
    expect(await usos()).toBe(1);
  });
  it("el precio cobrado no puede ser mayor al de la prenda", async () => {
    const p = (await pool.query(
      `INSERT INTO tienda.pedidos (acceso_hash, email, nombre, apellido, telefono, dni, entrega, local_retiro, medio_pago, subtotal, descuento, envio, total, estado)
       VALUES ('x','qa-db-cupon@test.com','A','B','1','1','retiro','L','local',1000,0,0,1000,'pagado') RETURNING id`)).rows[0].id;
    await expect(pool.query("INSERT INTO tienda.pedido_items (pedido_id, sku, nombre, precio, cantidad, precio_cobrado) VALUES ($1,'X','X',1000,1,1500)", [p])).rejects.toThrow(/check/);
  });
});
