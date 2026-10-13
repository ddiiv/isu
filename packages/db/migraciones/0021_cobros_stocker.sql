-- Stocker v3.39 (contrato v1, tanda 2): cada pago aprobado viaja a Stocker
-- como un cobro (POST /cobros). Sin cobro el depósito no despacha, así que se
-- anota cuándo lo confirmó Stocker: lo que no tiene confirmación lo vuelve a
-- mandar el worker solo, aunque se haya perdido el trabajo de la cola.
ALTER TABLE tienda.pagos
  ADD COLUMN stocker_en       timestamptz,
  -- false: Stocker lo anotó pero no lo aplicó (pedido cancelado u operación repetida).
  ADD COLUMN stocker_aplicado boolean,
  ADD COLUMN stocker_motivo   varchar(500);

CREATE INDEX pagos_cobro_pendiente ON tienda.pagos (creado_en) WHERE estado = 'aprobado' AND stocker_en IS NULL;
