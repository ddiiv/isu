-- Etapa 15: Correo Argentino con la API de MiCorreo, peso y medidas de cada
-- prenda, y todo el pedido en una sola bolsa.
--
-- 1) Medidas de la prenda doblada, como va en la bolsa (alto = el grosor).
--    Con el peso, son las que se usan para cotizar con TODOS los transportes.
--    Las que no las tengan cargadas cotizan con la prenda por defecto de
--    Ajustes (y el backoffice las marca como «sin peso y medidas»).
ALTER TABLE tienda.productos
  ADD COLUMN alto_cm  smallint CHECK (alto_cm IS NULL OR alto_cm BETWEEN 1 AND 100),
  ADD COLUMN ancho_cm smallint CHECK (ancho_cm IS NULL OR ancho_cm BETWEEN 1 AND 150),
  ADD COLUMN largo_cm smallint CHECK (largo_cm IS NULL OR largo_cm BETWEEN 1 AND 150);

-- 2) Todo el pedido viaja en UNA bolsa. Las cajas por cantidad de prendas
--    pasan a ser bolsas por tamaño: se elige la más chica en la que entran
--    las prendas apiladas. El peso por prenda que había queda como el de la
--    prenda por defecto.
UPDATE tienda.ajustes
   SET valor = jsonb_build_object(
         'prendaPorDefecto', jsonb_build_object(
           'pesoGramos', COALESCE((valor->>'pesoPrendaGramos')::int, 350), 'altoCm', 3, 'anchoCm', 25, 'largoCm', 30),
         'bolsas', '[
           {"nombre": "Chica",   "anchoCm": 30, "largoCm": 40, "pesoGramos": 15},
           {"nombre": "Mediana", "anchoCm": 40, "largoCm": 50, "pesoGramos": 25},
           {"nombre": "Grande",  "anchoCm": 50, "largoCm": 60, "pesoGramos": 40},
           {"nombre": "Extra grande", "anchoCm": 60, "largoCm": 80, "pesoGramos": 60}
         ]'::jsonb),
       actualizado_por = 'migracion', actualizado_en = now()
 WHERE clave = 'paqueteEnvios' AND valor ? 'cajas';

-- 3) MiCorreo no devuelve el número de seguimiento al cargar el envío: lo da
--    el rótulo, que se paga e imprime en MiCorreo. Hasta que se carga en el
--    backoffice, el envío de Correo Argentino queda sin número (y no se sigue).
--    `externo_id` guarda el id con que se cargó en MiCorreo (extOrderId).
ALTER TABLE tienda.envios ALTER COLUMN seguimiento DROP NOT NULL;
ALTER TABLE tienda.envios
  ADD CONSTRAINT envios_sin_numero_solo_correo CHECK (seguimiento IS NOT NULL OR transporte = 'correo_argentino');
