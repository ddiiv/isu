-- Etapa 11: ayudas para la dirección del checkout.
--
-- Google Places (sugerencias mientras se escribe la calle; necesita
-- GOOGLE_MAPS_API_KEY) y Georef (revisión gratis del Gobierno). Los topes por
-- día cuidan el uso gratis de Google (10.000 por mes de cada cosa): 300 por
-- día × 31 días = 9.300, así que no se paga aunque se llegue al tope todos los días.
INSERT INTO tienda.ajustes (clave, valor, actualizado_por)
VALUES ('direcciones', '{"google": true, "georef": true, "topeSugerencias": 300, "topeLugares": 300}'::jsonb, 'migracion')
ON CONFLICT (clave) DO NOTHING;
