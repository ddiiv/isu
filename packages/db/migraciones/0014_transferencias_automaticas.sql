-- ─────────────────────────────────────────────────────────────────────
-- Transferencias que se confirman solas.
--
-- Dos caminos (se prenden en Ajustes → Transferencias):
--   · Talo: cada pedido tiene su propio CVU y alias por el monto exacto. Talo
--     avisa cuando llega y la tienda lo confirma preguntándole con su
--     credencial (el aviso nunca se cree solo).
--   · Mercado Pago: el cliente transfiere al alias de la cuenta de Mercado
--     Pago de la tienda (recibir transferencias no tiene costo). Cada pedido
--     pide un monto con centavos únicos ($45.000,37) y la tienda lo reconoce
--     entre lo que entra a la cuenta.
-- Si ninguno está prendido (o Talo no responde), quedan los datos de Ajustes
-- y se confirma a mano, como hasta ahora.
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE tienda.pedidos
  -- A dónde se le pidió transferir: 'talo' (CVU del pedido), 'mercadopago' (alias de MP con centavos únicos) o 'cuenta' (a mano).
  ADD COLUMN transferencia_via varchar(12) CHECK (transferencia_via IN ('talo', 'mercadopago', 'cuenta')),
  -- Lo que tiene que transferir, en centavos (con Mercado Pago, el total más los centavos que lo identifican).
  ADD COLUMN transferencia_monto integer CHECK (transferencia_monto IS NULL OR transferencia_monto > 0),
  ADD COLUMN talo_pago varchar(120) CHECK (talo_pago IS NULL OR talo_pago ~ '^[A-Za-z0-9_-]{3,120}$'),
  ADD COLUMN talo_cvu varchar(22) CHECK (talo_cvu IS NULL OR talo_cvu ~ '^\d{22}$'),
  ADD COLUMN talo_alias varchar(40),
  ADD CHECK (transferencia_via IS DISTINCT FROM 'talo' OR talo_pago IS NOT NULL),
  ADD CHECK (transferencia_via IS DISTINCT FROM 'mercadopago' OR transferencia_monto IS NOT NULL);
CREATE UNIQUE INDEX pedidos_talo_pago ON tienda.pedidos (talo_pago) WHERE talo_pago IS NOT NULL;
-- Dos pedidos esperando una transferencia a Mercado Pago nunca piden el mismo monto: así se sabe de quién es cada una.
CREATE UNIQUE INDEX pedidos_monto_mp ON tienda.pedidos (transferencia_monto)
  WHERE transferencia_via = 'mercadopago' AND estado IN ('esperando_transferencia', 'transferencia_informada');
CREATE INDEX pedidos_transferencia_auto ON tienda.pedidos (creado_en)
  WHERE transferencia_via IN ('talo', 'mercadopago') AND estado IN ('esperando_transferencia', 'transferencia_informada');

-- Lo que entró (Talo o la cuenta de Mercado Pago), con su pedido o sin él: lo que no se pudo
-- asignar solo (monto distinto, sin pedido) se resuelve desde backoffice → Transferencias.
CREATE TABLE tienda.transferencias_recibidas (
  id            serial PRIMARY KEY,
  via           varchar(12) NOT NULL CHECK (via IN ('talo', 'mercadopago')),
  externo       varchar(120) NOT NULL,
  monto         integer NOT NULL CHECK (monto > 0),
  pagador       varchar(150),
  pagador_cuit  varchar(13),
  recibida_en   timestamptz NOT NULL,
  pedido_id     integer REFERENCES tienda.pedidos(id) ON DELETE SET NULL,
  estado        varchar(16) NOT NULL CHECK (estado IN ('aplicada', 'sin_pedido', 'monto_distinto', 'descartada')),
  nota          varchar(300),
  resuelta_por  varchar(150),
  resuelta_en   timestamptz,
  creado_en     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (via, externo)
);
CREATE INDEX transferencias_por_resolver ON tienda.transferencias_recibidas (recibida_en DESC) WHERE estado IN ('sin_pedido', 'monto_distinto');
CREATE INDEX transferencias_recientes ON tienda.transferencias_recibidas (recibida_en DESC);

INSERT INTO tienda.ajustes (clave, valor, actualizado_por) VALUES
  -- Apagadas hasta que el dueño las prenda (Talo además necesita sus credenciales en el servidor).
  ('transferenciasAuto', '{"talo": false, "mercadoPago": false}'::jsonb, 'migracion')
ON CONFLICT (clave) DO NOTHING;
