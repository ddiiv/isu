-- Eventos de temporada (Navidad hoy; Cupido, Halloween, etc. después): se prenden y se apagan juntos desde el backoffice.
--
-- Un evento agrupa descuentos, cupones/promociones y banners (`evento_id`). Esas filas valen sólo mientras el evento esté
-- vigente: activo y dentro de sus fechas (opcionales). Apagado el evento, la tienda vuelve a como estaba, sin tocar cada fila.
-- Sin `evento_id` todo funciona como siempre.
--
-- Un solo evento activo a la vez (índice parcial): el tema de la tienda no puede ser Navidad y Halloween juntos.
-- Los eventos nuevos son una fila más (clave en minúsculas); el código de la tienda decide qué tema pone para cada clave.
CREATE TABLE tienda.eventos (
  id             serial PRIMARY KEY,
  clave          varchar(30) NOT NULL UNIQUE CHECK (clave ~ '^[a-z][a-z0-9-]{1,29}$'),
  nombre         varchar(60) NOT NULL CHECK (length(btrim(nombre)) > 1),
  activo         boolean NOT NULL DEFAULT false,
  desde          timestamptz,
  hasta          timestamptz,
  actualizado_por varchar(150),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CHECK (hasta IS NULL OR desde IS NULL OR hasta > desde)
);
CREATE UNIQUE INDEX eventos_uno_activo ON tienda.eventos ((true)) WHERE activo;

-- ¿Está vigente el evento? (activo y dentro de sus fechas). Una sola definición para todas las consultas.
CREATE FUNCTION tienda.evento_vigente(evento integer) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM tienda.eventos e
                  WHERE e.id = evento AND e.activo AND (e.desde IS NULL OR e.desde <= now()) AND (e.hasta IS NULL OR e.hasta > now()))
$$;

ALTER TABLE tienda.descuentos ADD COLUMN evento_id integer REFERENCES tienda.eventos(id) ON DELETE SET NULL;
ALTER TABLE tienda.cupones    ADD COLUMN evento_id integer REFERENCES tienda.eventos(id) ON DELETE SET NULL;
ALTER TABLE tienda.banners    ADD COLUMN evento_id integer REFERENCES tienda.eventos(id) ON DELETE SET NULL;
CREATE INDEX descuentos_evento ON tienda.descuentos (evento_id) WHERE evento_id IS NOT NULL;
CREATE INDEX cupones_evento    ON tienda.cupones (evento_id) WHERE evento_id IS NOT NULL;
CREATE INDEX banners_evento    ON tienda.banners (evento_id) WHERE evento_id IS NOT NULL;

INSERT INTO tienda.eventos (clave, nombre) VALUES ('navidad', 'Navidad');
