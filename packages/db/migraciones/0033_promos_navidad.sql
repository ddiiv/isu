-- Promos de Navidad: «2da unidad al X %», cupones que no se suman a la rebaja de la prenda y tope de descuento por evento.
--
-- 1) Tipo de cupón `segunda_unidad`: entre las prendas elegibles del carrito (cualquiera), se arman pares de a dos, de la
--    más cara a la más barata; la más barata de cada par lleva `valor` % de descuento. Sirve para una promo automática y
--    para un premio de la ruleta.
-- 2) `acumula`: true = como siempre (el cupón va encima de la rebaja de la prenda). false = NO se suma: en cada prenda
--    rige el mejor precio para el cliente entre la rebaja y el cupón (el cupón se calcula sobre el precio de lista).
--    Sólo para porcentaje y segunda_unidad (un monto fijo o un envío gratis no se «compara» con una rebaja).
-- 3) `eventos.descuento_max`: el porcentaje más alto que puede tener un descuento atado al evento (Navidad: 25 %).
--    Lo hace cumplir la base (un trigger), así vale venga la carga de donde venga.
-- 4) Las dos promos automáticas de Navidad quedan cargadas y atadas al evento: no se ven hasta prenderlo.

ALTER TABLE tienda.cupones ADD COLUMN acumula boolean NOT NULL DEFAULT true;
-- `segunda_unidad` no entra en varchar(12).
ALTER TABLE tienda.cupones ALTER COLUMN tipo TYPE varchar(20);
ALTER TABLE tienda.cupones DROP CONSTRAINT cupones_tipo_check;
ALTER TABLE tienda.cupones ADD CONSTRAINT cupones_tipo_check CHECK (tipo IN ('porcentaje', 'monto', 'envio_gratis', 'mezcla', 'segunda_unidad'));
ALTER TABLE tienda.cupones
  ADD CONSTRAINT cupones_segunda_valor CHECK (tipo <> 'segunda_unidad' OR valor BETWEEN 1 AND 90),
  ADD CONSTRAINT cupones_acumula_tipo CHECK (acumula OR tipo IN ('porcentaje', 'segunda_unidad'));

ALTER TABLE tienda.eventos ADD COLUMN descuento_max smallint CHECK (descuento_max IS NULL OR descuento_max BETWEEN 1 AND 90);
UPDATE tienda.eventos SET descuento_max = 25 WHERE clave = 'navidad';

CREATE FUNCTION tienda.descuento_tope_evento() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tope smallint;
BEGIN
  IF NEW.evento_id IS NULL THEN RETURN NEW; END IF;
  SELECT descuento_max INTO tope FROM tienda.eventos WHERE id = NEW.evento_id;
  IF tope IS NOT NULL AND NEW.porcentaje > tope THEN
    RAISE EXCEPTION 'El descuento de un evento no puede pasar de % por ciento', tope USING ERRCODE = 'check_violation', CONSTRAINT = 'descuentos_tope_evento';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER descuentos_tope_evento BEFORE INSERT OR UPDATE OF porcentaje, evento_id ON tienda.descuentos
  FOR EACH ROW EXECUTE FUNCTION tienda.descuento_tope_evento();

-- «Más de $120.000» = desde $120.001 (centavos). La compra mínima se mira sobre los productos ya rebajados.
INSERT INTO tienda.cupones (nombre, automatico, tipo, valor, alcance, sobre_rebajas, acumula, minimo, activo, creado_por, evento_id)
SELECT '10% OFF en compras de más de $120.000', true, 'porcentaje', 10, 'todo', true, false, 12000100, true, 'migracion 0033', e.id
  FROM tienda.eventos e WHERE e.clave = 'navidad';
INSERT INTO tienda.cupones (nombre, automatico, tipo, valor, alcance, sobre_rebajas, acumula, minimo, activo, creado_por, evento_id)
SELECT '2da unidad al 50%', true, 'segunda_unidad', 50, 'todo', true, false, 0, true, 'migracion 0033', e.id
  FROM tienda.eventos e WHERE e.clave = 'navidad';
