-- ─────────────────────────────────────────────────────────────────────
-- Etapa 9: packs de 2 a 10 (configurable) y Liquidación.
--
-- Packs. El ajuste `packs` pasa de "% para 2, 3, 4 y 5" a un rango:
-- { minimo, maximo, porcentajes } con un % por cada cantidad desde el mínimo.
-- Lo que ya estaba configurado se respeta: de 6 a 10 vale el % de 5 (si era
-- el de fábrica, va la escala nueva de fábrica).
--
-- Liquidación. Un descuento marcado como liquidación pone sus productos en
-- la sección Liquidación (fin de temporada o lo que se elija liquidar). El
-- precio sale del mismo descuento, como cualquier rebaja.
-- ─────────────────────────────────────────────────────────────────────

UPDATE tienda.ajustes SET
  valor = CASE
    WHEN valor = '[10, 15, 18, 20]'::jsonb THEN '{"minimo": 2, "maximo": 10, "porcentajes": [10, 15, 18, 20, 21, 22, 23, 24, 25]}'::jsonb
    ELSE jsonb_build_object('minimo', 2, 'maximo', 10, 'porcentajes',
           valor || jsonb_build_array(valor -> -1, valor -> -1, valor -> -1, valor -> -1, valor -> -1))
  END,
  actualizado_por = 'migracion 0015', actualizado_en = now()
WHERE clave = 'packs' AND jsonb_typeof(valor) = 'array' AND jsonb_array_length(valor) = 4;

INSERT INTO tienda.ajustes (clave, valor, actualizado_por) VALUES
  ('packs', '{"minimo": 2, "maximo": 10, "porcentajes": [10, 15, 18, 20, 21, 22, 23, 24, 25]}'::jsonb, 'migracion')
ON CONFLICT (clave) DO NOTHING;

ALTER TABLE tienda.descuentos ADD COLUMN liquidacion boolean NOT NULL DEFAULT false;
CREATE INDEX descuentos_liquidacion ON tienda.descuentos (id) WHERE liquidacion AND activo;
