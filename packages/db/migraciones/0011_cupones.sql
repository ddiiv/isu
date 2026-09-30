-- ─────────────────────────────────────────────────────────────────────
-- Etapa 6: cupones de descuento y promociones por monto.
--
-- Dos clases, en la misma tabla:
--
--   cupón       tiene código ("VERANO10"): el cliente lo escribe en el
--               carrito o en el checkout
--   promoción   sin código (automatico = true): se aplica sola cuando la
--               compra cumple (ej. "10% superando $80.000")
--
-- Qué descuentan: un porcentaje, un monto fijo o el envío. Sobre toda la
-- tienda, ciertas categorías (con sus subcategorías) o ciertas prendas, con
-- compra mínima, fechas y topes de uso opcionales.
--
-- Cómo se combinan (lo calcula la API, ver lib/cupones.ts):
--   · primero la rebaja de la prenda (descuentos masivos), después el cupón,
--     después el descuento por transferencia
--   · UNO por compra: entre el cupón escrito y las promociones que apliquen
--     gana el que más descuenta
--   · nunca deja un precio por debajo de $0; el envío sólo lo descuenta el
--     de tipo envío gratis
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE tienda.cupones (
  id               serial PRIMARY KEY,
  -- En mayúsculas, sin espacios. NULL = promoción automática.
  codigo           varchar(30) CHECK (codigo ~ '^[A-Z0-9][A-Z0-9_-]{2,29}$'),
  -- Lo que ve el cliente cuando se aplica ("10% OFF en remeras").
  nombre           varchar(80) NOT NULL CHECK (length(btrim(nombre)) > 1),
  automatico       boolean NOT NULL DEFAULT false,
  tipo             varchar(12) NOT NULL CHECK (tipo IN ('porcentaje', 'monto', 'envio_gratis')),
  -- porcentaje: 1 a 90 · monto: centavos · envío gratis: 0
  valor            integer NOT NULL DEFAULT 0 CHECK (valor >= 0),
  alcance          varchar(12) NOT NULL DEFAULT 'todo' CHECK (alcance IN ('todo', 'categorias', 'productos')),
  categoria_ids    integer[] NOT NULL DEFAULT '{}',
  producto_ids     integer[] NOT NULL DEFAULT '{}',
  -- También a las prendas que ya tienen una rebaja (descuento masivo).
  sobre_rebajas    boolean NOT NULL DEFAULT true,
  -- Compra mínima (centavos, sobre el total de productos ya rebajados). 0 = sin mínimo.
  minimo           integer NOT NULL DEFAULT 0 CHECK (minimo >= 0),
  desde            timestamptz,
  hasta            timestamptz,
  -- Topes: NULL = sin tope.
  usos_max         integer CHECK (usos_max IS NULL OR usos_max > 0),
  usos_por_cliente integer CHECK (usos_por_cliente IS NULL OR usos_por_cliente > 0),
  -- Usos vigentes: suma con cada pedido y resta si el pedido se cae (vence, se cancela…).
  usos             integer NOT NULL DEFAULT 0 CHECK (usos >= 0),
  activo           boolean NOT NULL DEFAULT true,
  creado_por       varchar(150) NOT NULL,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  actualizado_en   timestamptz NOT NULL DEFAULT now(),
  CHECK (automatico = (codigo IS NULL)),
  CHECK (tipo <> 'porcentaje' OR valor BETWEEN 1 AND 90),
  CHECK (tipo <> 'monto' OR valor BETWEEN 100 AND 1000000000),
  CHECK (tipo <> 'envio_gratis' OR valor = 0),
  CHECK (hasta IS NULL OR desde IS NULL OR hasta > desde),
  CHECK (alcance <> 'categorias' OR cardinality(categoria_ids) > 0),
  CHECK (alcance <> 'productos' OR cardinality(producto_ids) > 0)
);
CREATE UNIQUE INDEX cupones_codigo ON tienda.cupones (codigo) WHERE codigo IS NOT NULL;
CREATE INDEX cupones_automaticos ON tienda.cupones (id) WHERE automatico AND activo;

-- Qué cupón usó cada pedido y cuánto descontó.
ALTER TABLE tienda.pedidos
  ADD COLUMN cupon_id        integer REFERENCES tienda.cupones(id) ON DELETE SET NULL,
  ADD COLUMN cupon_codigo    varchar(30),
  ADD COLUMN cupon_nombre    varchar(80),
  ADD COLUMN descuento_cupon integer NOT NULL DEFAULT 0 CHECK (descuento_cupon >= 0),
  -- Envío gratis por cupón: lo que el envío habría costado (para el informe).
  ADD COLUMN envio_bonificado integer NOT NULL DEFAULT 0 CHECK (envio_bonificado >= 0);
ALTER TABLE tienda.pedidos DROP CONSTRAINT pedidos_check;
ALTER TABLE tienda.pedidos ADD CONSTRAINT pedidos_total_cuadra CHECK (total = subtotal - descuento_cupon - descuento + envio);
CREATE INDEX pedidos_cupon ON tienda.pedidos (cupon_id) WHERE cupon_id IS NOT NULL;

/*
 * El precio por unidad que se cobró de verdad, con el cupón ya repartido
 * (lo que va a Mercado Pago y a Stocker). `precio` sigue siendo el de la
 * prenda (con rebaja si había) para mostrar el pedido con el cupón aparte.
 */
ALTER TABLE tienda.pedido_items ADD COLUMN precio_cobrado integer CHECK (precio_cobrado IS NULL OR (precio_cobrado >= 0 AND precio_cobrado <= precio));

/*
 * Usos de cada cupón: una fila por pedido. `vigente` = cuenta para los
 * topes. Si el pedido se cae (vence sin pagar, se cancela, no había stock)
 * el uso se libera solo — lo hace el trigger de abajo, así no depende de
 * que cada camino del código se acuerde.
 */
CREATE TABLE tienda.cupon_usos (
  id         bigserial PRIMARY KEY,
  cupon_id   integer NOT NULL REFERENCES tienda.cupones(id) ON DELETE CASCADE,
  pedido_id  integer NOT NULL UNIQUE REFERENCES tienda.pedidos(id) ON DELETE CASCADE,
  email      varchar(150) NOT NULL,
  descuento  integer NOT NULL CHECK (descuento >= 0),
  vigente    boolean NOT NULL DEFAULT true,
  creado_en  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cupon_usos_cliente ON tienda.cupon_usos (cupon_id, lower(email)) WHERE vigente;

CREATE FUNCTION tienda.cupon_uso_segun_pedido() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  caidos constant text[] := ARRAY['vencido', 'cancelado', 'sin_stock', 'error_reserva', 'sin_confirmar'];
  antes_caido boolean := OLD.estado = ANY(caidos);
  ahora_caido boolean := NEW.estado = ANY(caidos);
  u record;
BEGIN
  IF NEW.cupon_id IS NULL OR antes_caido = ahora_caido THEN RETURN NEW; END IF;
  -- Se cayó: el uso deja de contar. Volvió (se pagó tarde): vuelve a contar.
  UPDATE tienda.cupon_usos SET vigente = NOT ahora_caido
   WHERE pedido_id = NEW.id AND vigente = ahora_caido
   RETURNING cupon_id INTO u;
  IF FOUND THEN
    UPDATE tienda.cupones SET usos = GREATEST(usos + CASE WHEN ahora_caido THEN -1 ELSE 1 END, 0) WHERE id = u.cupon_id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER cupon_uso_segun_pedido
  AFTER UPDATE OF estado ON tienda.pedidos
  FOR EACH ROW EXECUTE FUNCTION tienda.cupon_uso_segun_pedido();
