-- ─────────────────────────────────────────────────────────────────────
-- Guías de talles (como Mercado Libre) y datos para "Armá tu outfit".
-- ─────────────────────────────────────────────────────────────────────

/*
 * Una guía por "molde": "Remera regular adulto", "Jogger niños"… Cada
 * producto apunta a la suya. `medidas` es la lista de columnas (claves de
 * @isu/shared MEDIDAS) y `filas` un talle por fila con un rango en cm por
 * columna: [{"talle":"M","valores":[[92,97],[72,72]]}]. La API valida la
 * forma completa (talles de niño 4–16 o de adulto XS–5XL, sin repetir).
 */
CREATE TABLE tienda.guias_talles (
  id              serial PRIMARY KEY,
  nombre          varchar(80) NOT NULL CHECK (length(btrim(nombre)) > 1),
  tipo            varchar(10) NOT NULL CHECK (tipo IN ('nino', 'adulto')),
  medidas         jsonb NOT NULL CHECK (jsonb_typeof(medidas) = 'array' AND jsonb_array_length(medidas) BETWEEN 1 AND 8),
  filas           jsonb NOT NULL CHECK (jsonb_typeof(filas) = 'array' AND jsonb_array_length(filas) BETWEEN 1 AND 20),
  nota            varchar(500),
  actualizado_por varchar(150),
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX guias_talles_nombre ON tienda.guias_talles (lower(nombre));

ALTER TABLE tienda.productos
  ADD COLUMN guia_talles_id integer REFERENCES tienda.guias_talles(id) ON DELETE SET NULL,
  -- Parte del outfit: null = se deduce de la categoría; 'ninguna' = no se sugiere en outfits.
  ADD COLUMN parte_outfit varchar(10) CHECK (parte_outfit IN ('arriba', 'abajo', 'abrigo', 'ninguna'));
CREATE INDEX productos_guia ON tienda.productos (guia_talles_id) WHERE guia_talles_id IS NOT NULL;
