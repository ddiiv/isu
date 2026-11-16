-- Liquidación de invierno y de verano: la temporada es del descuento (sólo si es de liquidación).
-- Los que ya existen quedan sin temporada: salen en «Toda la liquidación» hasta que se les elija una.
ALTER TABLE tienda.descuentos ADD COLUMN temporada varchar(10) CHECK (temporada IN ('invierno', 'verano'));
ALTER TABLE tienda.descuentos ADD CONSTRAINT descuentos_temporada_liquidacion CHECK (temporada IS NULL OR liquidacion);

-- Menos categorías, para no marear: Hombre › Chombas se une a Hombre › Remeras (era 1 producto) y Niños pierde sus
-- subcategorías (eran 6 prendas en total). Los productos pasan a la categoría que queda, los descuentos y cupones
-- que apuntaban a la vieja ahora apuntan a la nueva, y las direcciones viejas redirigen (Redirecciones).
-- Por slug, sin ids fijos: si la categoría no existe (otra base), no hace nada. Stocker no la vuelve a crear: sin la
-- subcategoría, la sincronización deja el producto en la de arriba.
CREATE TEMP TABLE _fusion (viejo integer, nuevo integer, desde text, hacia text);
INSERT INTO _fusion
  SELECT h.id, d.id, '/hombre/chombas', '/hombre/remeras'
    FROM tienda.categorias h
    JOIN tienda.categorias ph ON ph.id = h.padre_id AND ph.slug = 'hombre' AND ph.padre_id IS NULL
    JOIN tienda.categorias d ON d.padre_id = ph.id AND d.slug = 'remeras'
   WHERE h.slug = 'chombas';
INSERT INTO _fusion
  SELECT h.id, ph.id, '/ninos/' || h.slug, '/ninos'
    FROM tienda.categorias h
    JOIN tienda.categorias ph ON ph.id = h.padre_id AND ph.slug = 'ninos' AND ph.padre_id IS NULL;

INSERT INTO tienda.producto_categorias (producto_id, categoria_id)
  SELECT pc.producto_id, f.nuevo FROM tienda.producto_categorias pc JOIN _fusion f ON f.viejo = pc.categoria_id
  ON CONFLICT DO NOTHING;
UPDATE tienda.productos p SET categoria_id = f.nuevo FROM _fusion f WHERE p.categoria_id = f.viejo;

UPDATE tienda.descuentos d SET categoria_ids = (
  SELECT array_agg(DISTINCT COALESCE(f.nuevo, x)) FROM unnest(d.categoria_ids) x LEFT JOIN _fusion f ON f.viejo = x)
 WHERE d.categoria_ids && (SELECT array_agg(viejo) FROM _fusion);
UPDATE tienda.cupones c SET categoria_ids = (
  SELECT array_agg(DISTINCT COALESCE(f.nuevo, x)) FROM unnest(c.categoria_ids) x LEFT JOIN _fusion f ON f.viejo = x)
 WHERE c.categoria_ids && (SELECT array_agg(viejo) FROM _fusion);

UPDATE tienda.redirecciones r SET hacia = f.hacia FROM _fusion f WHERE r.hacia = f.desde AND r.desde <> f.hacia;
INSERT INTO tienda.redirecciones (desde, hacia, origen, creado_por)
  SELECT desde, hacia, 'manual', 'migracion 0028' FROM _fusion
  ON CONFLICT (desde) DO NOTHING;

DELETE FROM tienda.categorias WHERE id IN (SELECT viejo FROM _fusion);
DROP TABLE _fusion;
