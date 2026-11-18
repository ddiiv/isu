-- Precio mayorista por variante (viene de Stocker) y cupón de tipo «mezcla».
--
-- El mayorista es el PISO: ningún cupón ni descuento deja una prenda por debajo. Es un dato interno: la API
-- sólo lo lee al cotizar y nunca sale en una respuesta pública. NULL = todavía no vino de Stocker (sin mayorista
-- cargado no se puede verificar el piso y la prenda no recibe descuento de cupón).
ALTER TABLE tienda.variantes ADD COLUMN precio_mayorista integer CHECK (precio_mayorista IS NULL OR precio_mayorista >= 0);

-- «Mezcla»: algunas prendas a precio mayorista según cuántas lleve. escala = [{"desde":3,"mayorista":1}, ...]:
-- con 3 o más prendas elegibles, la más barata va a mayorista; con 5, las 2 más baratas; etc. max_mayorista
-- es el máximo de prendas a mayorista por compra. El tope (0029) también vale acá.
ALTER TABLE tienda.cupones
  ADD COLUMN escala jsonb,
  ADD COLUMN max_mayorista integer NOT NULL DEFAULT 5 CHECK (max_mayorista BETWEEN 1 AND 50);
ALTER TABLE tienda.cupones DROP CONSTRAINT cupones_tipo_check;
ALTER TABLE tienda.cupones ADD CONSTRAINT cupones_tipo_check CHECK (tipo IN ('porcentaje', 'monto', 'envio_gratis', 'mezcla'));
ALTER TABLE tienda.cupones
  ADD CONSTRAINT cupones_mezcla_valor CHECK (tipo <> 'mezcla' OR valor = 0),
  ADD CONSTRAINT cupones_mezcla_escala CHECK ((tipo = 'mezcla') = (escala IS NOT NULL AND jsonb_typeof(escala) = 'array' AND jsonb_array_length(escala) > 0)),
  ADD CONSTRAINT cupones_tope_tipo CHECK (tope IS NULL OR tipo IN ('porcentaje', 'mezcla'));
