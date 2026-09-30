-- ─────────────────────────────────────────────────────────────────────
-- Etapa 6: importación del catálogo del sitio mayorista.
--
-- El producto, el precio y el stock siguen viniendo de Stocker. Del
-- mayorista se traen las fotos (por color y la principal), el color exacto
-- de cada muestra y la categoría. Tres cosas nuevas que son SÓLO de la
-- tienda y que la sincronización con Stocker no pisa:
-- ─────────────────────────────────────────────────────────────────────

/*
 * De dónde salió la foto ("mayorista:<id>"). Sirve para que volver a correr
 * la importación no duplique fotos: la que ya está, se saltea.
 */
ALTER TABLE tienda.fotos ADD COLUMN origen varchar(120);
CREATE UNIQUE INDEX fotos_origen ON tienda.fotos (producto_id, origen) WHERE origen IS NOT NULL;

/*
 * Nombre del color puesto a mano ("Único" en Stocker → "Negro" en la
 * tienda). Con esto en true la sincronización deja el nombre como está.
 */
ALTER TABLE tienda.producto_colores ADD COLUMN nombre_fijo boolean NOT NULL DEFAULT false;

/*
 * Talle que existe en Stocker pero la tienda no vende (ej. una musculosa
 * que se vende sólo en talle Único). La sincronización la mantiene
 * inactiva mientras esté oculta: todas las consultas de la tienda ya
 * filtran por `activo`.
 */
ALTER TABLE tienda.variantes ADD COLUMN oculta boolean NOT NULL DEFAULT false;
