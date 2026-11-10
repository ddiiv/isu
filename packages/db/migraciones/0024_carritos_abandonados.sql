-- Recordatorio de carritos abandonados, sólo por mail y sólo con el tilde del checkout marcado.
-- Se guarda lo mínimo: el mail, qué prendas (SKU y cantidad) y cuándo. Sin datos de pago ni dirección.
-- Retención: 7 días (los de baja, 90 para que reenviar el mismo carrito no la vuelva a anotar): la purga la hace el worker.
CREATE TABLE tienda.carritos_abandonados (
  id            serial PRIMARY KEY,
  email         varchar(254) NOT NULL CHECK (email = lower(email)),
  items         jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) <= 30),
  -- 32 bytes al azar en base64url (256 bits): va en el link «No quiero más recordatorios» del mail.
  baja_token    varchar(64) NOT NULL CHECK (length(baja_token) >= 43),
  creado_en     timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  recordado_en  timestamptz,
  convertido_en timestamptz,
  baja_en       timestamptz,
  UNIQUE (email),
  UNIQUE (baja_token)
);
-- Los pendientes de recordar (los busca el worker cada 10 minutos).
CREATE INDEX carritos_abandonados_pendientes ON tienda.carritos_abandonados (actualizado_en)
  WHERE recordado_en IS NULL AND convertido_en IS NULL AND baja_en IS NULL;
-- La purga.
CREATE INDEX carritos_abandonados_purga ON tienda.carritos_abandonados (actualizado_en);
