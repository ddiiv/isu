-- Ruleta de descuentos (Parte 5). El resultado se sortea siempre en la API (nunca en el navegador).
--
-- Cuándo aparece:
--   · sola, una vez por semana por cuenta, mientras haya un evento de temporada vigente (`con_eventos`), y
--   · cuando se quiera, prendida a mano desde el backoffice (`manual`), con la misma frecuencia.
-- Cada cuenta (registrada, con sesión) puede girar una vez cada `cada_dias` días. El primer giro es apenas se registra.
-- El premio es un cupón PERSONAL de un solo uso: sólo lo puede usar la cuenta que lo ganó (cupones.cliente_id).
-- Si la ruleta está abierta por un evento, el cupón queda atado a ese evento: vale mientras el evento esté vigente y
-- nunca más allá de `vence_dias`.
CREATE TABLE tienda.ruleta (
  id               smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  manual           boolean NOT NULL DEFAULT false,
  con_eventos      boolean NOT NULL DEFAULT true,
  cada_dias        smallint NOT NULL DEFAULT 7 CHECK (cada_dias BETWEEN 1 AND 365),
  vence_dias       smallint NOT NULL DEFAULT 30 CHECK (vence_dias BETWEEN 1 AND 365),
  actualizado_por  varchar(150),
  actualizado_en   timestamptz NOT NULL DEFAULT now()
);
INSERT INTO tienda.ruleta DEFAULT VALUES;

-- Los premios y su peso: la probabilidad de cada uno es su peso sobre la suma de los pesos de los premios activos.
-- `nada` = «Seguís participando» / «Casi ganás» (sin premio, igual gasta el giro).
CREATE TABLE tienda.ruleta_premios (
  id        serial PRIMARY KEY,
  etiqueta  varchar(40) NOT NULL CHECK (length(btrim(etiqueta)) > 1),
  tipo      varchar(14) NOT NULL CHECK (tipo IN ('porcentaje', 'monto', 'envio_gratis', 'segunda_unidad', 'nada')),
  -- porcentaje y segunda_unidad: 1 a 90 · monto: centavos · envío gratis y nada: 0
  valor     integer NOT NULL DEFAULT 0 CHECK (valor >= 0),
  -- Compra mínima del cupón que se gana (centavos; 0 = sin mínimo).
  minimo    integer NOT NULL DEFAULT 0 CHECK (minimo >= 0),
  peso      integer NOT NULL CHECK (peso BETWEEN 0 AND 1000),
  activo    boolean NOT NULL DEFAULT true,
  orden     smallint NOT NULL DEFAULT 0,
  CHECK (tipo NOT IN ('porcentaje', 'segunda_unidad') OR valor BETWEEN 1 AND 90),
  CHECK (tipo <> 'monto' OR valor BETWEEN 100 AND 1000000000),
  CHECK (tipo NOT IN ('envio_gratis', 'nada') OR valor = 0)
);

-- Cupones personales: sólo los puede usar esa cuenta. Siempre con código y de un solo uso.
ALTER TABLE tienda.cupones ADD COLUMN cliente_id integer REFERENCES tienda.clientes(id) ON DELETE CASCADE;
ALTER TABLE tienda.cupones ADD CONSTRAINT cupones_personal CHECK (cliente_id IS NULL OR (codigo IS NOT NULL AND usos_max = 1));
CREATE INDEX cupones_cliente ON tienda.cupones (cliente_id) WHERE cliente_id IS NOT NULL;

-- Cada giro (para la frecuencia y para ver qué salió). No lleva datos personales más allá del id de la cuenta.
CREATE TABLE tienda.ruleta_giros (
  id         bigserial PRIMARY KEY,
  cliente_id integer NOT NULL REFERENCES tienda.clientes(id) ON DELETE CASCADE,
  premio_id  integer REFERENCES tienda.ruleta_premios(id) ON DELETE SET NULL,
  etiqueta   varchar(40) NOT NULL,
  tipo       varchar(14) NOT NULL,
  cupon_id   integer REFERENCES tienda.cupones(id) ON DELETE SET NULL,
  evento_id  integer REFERENCES tienda.eventos(id) ON DELETE SET NULL,
  creado_en  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ruleta_giros_cliente ON tienda.ruleta_giros (cliente_id, creado_en DESC);

-- Premios de arranque (pesos sobre 100). Se cambian desde el backoffice.
INSERT INTO tienda.ruleta_premios (etiqueta, tipo, valor, minimo, peso, orden) VALUES
  ('5% OFF',               'porcentaje',     5,       0, 30, 1),
  ('10% OFF',              'porcentaje',     10,      0, 18, 2),
  ('Seguís participando',  'nada',           0,       0, 8,  3),
  ('15% OFF',              'porcentaje',     15,      0, 8,  4),
  ('$3.000 OFF',           'monto',          300000,  2500000, 12, 5),
  ('Envío gratis',         'envio_gratis',   0,       0, 10, 6),
  ('Casi ganás',           'nada',           0,       0, 5,  7),
  ('2da unidad al 50%',    'segunda_unidad', 50,      0, 6,  8),
  ('20% OFF',              'porcentaje',     20,      0, 3,  9);
