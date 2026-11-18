-- Relámpagos: descuentos por tiempo limitado, aparte de los descuentos normales (propia pantalla en el backoffice).
-- Antes «relámpago» era cualquier descuento que terminaba en 48 h o menos; ahora es una marca explícita.
-- La duración máxima (48 h) se valida en la API: un CHECK sobre la duración rompería filas viejas sin `desde`.
ALTER TABLE tienda.descuentos ADD COLUMN relampago boolean NOT NULL DEFAULT false;
ALTER TABLE tienda.descuentos ADD CONSTRAINT descuentos_relampago_hasta CHECK (NOT relampago OR hasta IS NOT NULL);

-- Los ya cargados: los creados como relámpago y los que hoy se mostrarían como tales (vigentes, con fin a ≤ 48 h).
UPDATE tienda.descuentos SET relampago = true
 WHERE hasta IS NOT NULL AND NOT liquidacion
   AND (creado_por = 'relampago' OR (hasta > now() AND hasta <= COALESCE(desde, now()) + interval '48 hours'));
