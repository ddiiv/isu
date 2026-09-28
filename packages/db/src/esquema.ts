import { pgSchema, serial, integer, varchar, boolean, text, timestamp, jsonb, bigserial, char } from "drizzle-orm/pg-core";

/* Espejo tipado de las migraciones SQL. Las migraciones mandan; esto sólo tipa las consultas. */
export const tienda = pgSchema("tienda");

export const ajustes = tienda.table("ajustes", {
  clave: varchar("clave", { length: 60 }).primaryKey(),
  valor: jsonb("valor").notNull(),
  actualizadoPor: varchar("actualizado_por", { length: 150 }),
  actualizadoEn: timestamp("actualizado_en", { withTimezone: true }).notNull().defaultNow(),
});

export const categorias = tienda.table("categorias", {
  id: serial("id").primaryKey(),
  padreId: integer("padre_id"),
  nombre: varchar("nombre", { length: 60 }).notNull(),
  slug: varchar("slug", { length: 80 }).notNull(),
  orden: integer("orden").notNull().default(0),
  visible: boolean("visible").notNull().default(true),
  seoTitulo: varchar("seo_titulo", { length: 70 }),
  seoDescripcion: varchar("seo_descripcion", { length: 160 }),
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
  actualizadoEn: timestamp("actualizado_en", { withTimezone: true }).notNull().defaultNow(),
});

export const productos = tienda.table("productos", {
  id: serial("id").primaryKey(),
  stockerPadre: varchar("stocker_padre", { length: 60 }).notNull(),
  nombre: varchar("nombre", { length: 150 }).notNull(),
  slug: varchar("slug", { length: 80 }).notNull(),
  categoriaId: integer("categoria_id"),
  visible: boolean("visible").notNull().default(false),
  descripcion: text("descripcion"),
  seoTitulo: varchar("seo_titulo", { length: 70 }),
  seoDescripcion: varchar("seo_descripcion", { length: 160 }),
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
  actualizadoEn: timestamp("actualizado_en", { withTimezone: true }).notNull().defaultNow(),
});

export const productoColores = tienda.table("producto_colores", {
  id: serial("id").primaryKey(),
  productoId: integer("producto_id").notNull(),
  clave: varchar("clave", { length: 40 }).notNull(),
  nombre: varchar("nombre", { length: 60 }).notNull(),
  hex: char("hex", { length: 7 }),
  orden: integer("orden").notNull().default(0),
});

export const fotos = tienda.table("fotos", {
  id: serial("id").primaryKey(),
  productoId: integer("producto_id").notNull(),
  tipo: varchar("tipo", { length: 12 }).notNull().$type<"color" | "exhibicion">(),
  colorId: integer("color_id"),
  orden: integer("orden").notNull().default(0),
  clave: varchar("clave", { length: 200 }).notNull(),
  ancho: integer("ancho"),
  alto: integer("alto"),
  alt: varchar("alt", { length: 160 }),
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
});

export const auditoria = tienda.table("auditoria", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  actor: varchar("actor", { length: 150 }).notNull(),
  accion: varchar("accion", { length: 60 }).notNull(),
  entidad: varchar("entidad", { length: 60 }).notNull(),
  entidadId: varchar("entidad_id", { length: 60 }),
  detalle: jsonb("detalle"),
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
});
