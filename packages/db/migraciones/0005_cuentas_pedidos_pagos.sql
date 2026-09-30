-- ─────────────────────────────────────────────────────────────────────
-- Etapa 2: cuentas, pedidos y pagos.
--
-- La plata se guarda en centavos (entero). El precio de cada línea se copia
-- al pedido: si mañana cambia en Stocker, el pedido de hoy sigue diciendo lo
-- que el cliente pagó.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE tienda.clientes (
  id                 serial PRIMARY KEY,
  email              varchar(150) NOT NULL CHECK (email = lower(email) AND email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  hash               varchar(200),                 -- argon2id; null = cuenta creada por una compra sin registrarse
  nombre             varchar(100) NOT NULL,
  apellido           varchar(100),
  telefono           varchar(30),
  dni                varchar(20),
  stocker_cliente_id integer,
  acepta_novedades   boolean NOT NULL DEFAULT false,
  bloqueado_hasta    timestamptz,                  -- demasiados intentos fallidos
  intentos_fallidos  integer NOT NULL DEFAULT 0,
  creado_en          timestamptz NOT NULL DEFAULT now(),
  actualizado_en     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX clientes_email ON tienda.clientes (email);

/*
 * Sesiones: en la cookie viaja un token al azar; acá se guarda su SHA-256.
 * Si alguien lee esta tabla, no puede entrar con lo que encuentra.
 */
CREATE TABLE tienda.sesiones (
  id          char(64) PRIMARY KEY,                -- sha256(token) en hex
  cliente_id  integer NOT NULL REFERENCES tienda.clientes(id) ON DELETE CASCADE,
  creada_en   timestamptz NOT NULL DEFAULT now(),
  expira_en   timestamptz NOT NULL,
  visto_en    timestamptz NOT NULL DEFAULT now(),
  ip          inet,
  agente      varchar(200)
);
CREATE INDEX sesiones_cliente ON tienda.sesiones (cliente_id);
CREATE INDEX sesiones_expira ON tienda.sesiones (expira_en);

-- Olvidé mi contraseña: un uso, 1 hora, guardado como hash.
CREATE TABLE tienda.restablecimientos (
  id          char(64) PRIMARY KEY,
  cliente_id  integer NOT NULL REFERENCES tienda.clientes(id) ON DELETE CASCADE,
  expira_en   timestamptz NOT NULL,
  usado_en    timestamptz,
  creado_en   timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE tienda.pedidos_numero START 1001;

/*
 * Estados de un pedido:
 *   esperando_pago      Mercado Pago / Pago Fácil: el cliente está pagando
 *   esperando_transferencia
 *   transferencia_informada   el cliente subió el comprobante; falta confirmarla
 *   a_pagar_en_local
 *   pagado              cobrado: Stocker ya lo deja despachar
 *   enviado · entregado · listo_para_retirar · retirado   (etapa 4)
 *   vencido             no se pagó a tiempo: se devolvió lo apartado
 *   cancelado           arrepentimiento o cancelación manual
 *   sin_stock           Stocker no pudo apartar (otro canal vendió antes)
 */
CREATE TABLE tienda.pedidos (
  id                 serial PRIMARY KEY,
  numero             varchar(20) NOT NULL UNIQUE DEFAULT ('ISU-' || nextval('tienda.pedidos_numero')),
  -- Para ver el pedido sin cuenta (enlace del mail). Se guarda su hash.
  acceso_hash        char(64) NOT NULL,
  cliente_id         integer REFERENCES tienda.clientes(id) ON DELETE SET NULL,
  email              varchar(150) NOT NULL,
  nombre             varchar(100) NOT NULL,
  apellido           varchar(100) NOT NULL,
  telefono           varchar(30) NOT NULL,
  dni                varchar(20) NOT NULL,
  entrega            varchar(10) NOT NULL CHECK (entrega IN ('envio', 'retiro')),
  direccion          jsonb,                        -- {calle, numero, piso, cp, localidad, provincia, indicaciones}
  local_retiro       varchar(100),
  medio_pago         varchar(20) NOT NULL CHECK (medio_pago IN ('mercadopago', 'pagofacil', 'transferencia', 'local')),
  subtotal           integer NOT NULL CHECK (subtotal >= 0),
  descuento          integer NOT NULL DEFAULT 0 CHECK (descuento >= 0),
  envio              integer NOT NULL DEFAULT 0 CHECK (envio >= 0),
  total              integer NOT NULL CHECK (total >= 0),
  estado             varchar(30) NOT NULL,
  vence_en           timestamptz,
  pagado_en          timestamptz,
  stocker_estado     varchar(20),
  mp_preferencia     varchar(80),
  notas              varchar(500),
  ip                 inet,
  creado_en          timestamptz NOT NULL DEFAULT now(),
  actualizado_en     timestamptz NOT NULL DEFAULT now(),
  CHECK (total = subtotal - descuento + envio),
  CHECK (entrega <> 'envio' OR direccion IS NOT NULL),
  CHECK (entrega <> 'retiro' OR local_retiro IS NOT NULL),
  CHECK (medio_pago <> 'local' OR entrega = 'retiro')
);
CREATE INDEX pedidos_cliente ON tienda.pedidos (cliente_id, creado_en DESC);
CREATE INDEX pedidos_email ON tienda.pedidos (email, creado_en DESC);
CREATE INDEX pedidos_por_vencer ON tienda.pedidos (vence_en)
  WHERE estado IN ('esperando_pago', 'esperando_transferencia', 'transferencia_informada', 'a_pagar_en_local');

CREATE TABLE tienda.pedido_items (
  id           serial PRIMARY KEY,
  pedido_id    integer NOT NULL REFERENCES tienda.pedidos(id) ON DELETE CASCADE,
  sku          varchar(100) NOT NULL,
  producto_id  integer REFERENCES tienda.productos(id) ON DELETE SET NULL,
  nombre       varchar(150) NOT NULL,
  color        varchar(60),
  talle        varchar(40),
  precio       integer NOT NULL CHECK (precio >= 0),   -- unitario, de lista
  cantidad     integer NOT NULL CHECK (cantidad BETWEEN 1 AND 99)
);
CREATE INDEX pedido_items_pedido ON tienda.pedido_items (pedido_id);

/*
 * Pagos: uno por intento o aviso (un pedido puede tener un pago rechazado y
 * después uno aprobado). `externo` es el id en Mercado Pago o la referencia
 * de la transferencia: único por proveedor, así un aviso repetido no cobra
 * dos veces.
 */
CREATE TABLE tienda.pagos (
  id           serial PRIMARY KEY,
  pedido_id    integer NOT NULL REFERENCES tienda.pedidos(id) ON DELETE CASCADE,
  proveedor    varchar(20) NOT NULL CHECK (proveedor IN ('mercadopago', 'transferencia', 'local')),
  externo      varchar(80) NOT NULL,
  estado       varchar(20) NOT NULL,              -- aprobado | pendiente | rechazado | informado | devuelto
  monto        integer NOT NULL CHECK (monto >= 0),
  detalle      jsonb,
  registrado_por varchar(150),
  creado_en    timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE (proveedor, externo)
);
CREATE INDEX pagos_pedido ON tienda.pagos (pedido_id);

-- Comprobantes de transferencia subidos por el cliente (archivo privado: nunca público).
CREATE TABLE tienda.comprobantes (
  id          serial PRIMARY KEY,
  pedido_id   integer NOT NULL REFERENCES tienda.pedidos(id) ON DELETE CASCADE,
  clave       varchar(200) NOT NULL UNIQUE,
  tipo        varchar(40) NOT NULL CHECK (tipo IN ('image/webp', 'application/pdf')),
  bytes       integer NOT NULL CHECK (bytes > 0),
  creado_en   timestamptz NOT NULL DEFAULT now()
);

-- Qué le pasó a cada pedido y quién lo hizo. Sólo se agrega.
CREATE TABLE tienda.pedido_eventos (
  id          bigserial PRIMARY KEY,
  pedido_id   integer NOT NULL REFERENCES tienda.pedidos(id) ON DELETE CASCADE,
  estado      varchar(30) NOT NULL,
  detalle     varchar(500),
  actor       varchar(150) NOT NULL,
  creado_en   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pedido_eventos_pedido ON tienda.pedido_eventos (pedido_id, creado_en);
CREATE TRIGGER pedido_eventos_inmutable
  BEFORE UPDATE OR DELETE ON tienda.pedido_eventos
  -- Borrar el pedido entero (cascada) sí se puede: eso lo hace sólo un administrador.
  FOR EACH ROW WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION tienda.auditoria_inmutable();

/*
 * Botón de arrepentimiento (Res. 424/2020): el pedido de revocación queda
 * registrado con su código de trámite, se haya podido cancelar o no.
 */
CREATE TABLE tienda.arrepentimientos (
  id          serial PRIMARY KEY,
  codigo      varchar(20) NOT NULL UNIQUE,
  pedido_id   integer REFERENCES tienda.pedidos(id) ON DELETE SET NULL,
  numero      varchar(20) NOT NULL,
  email       varchar(150) NOT NULL,
  nombre      varchar(150) NOT NULL,
  motivo      varchar(1000),
  resultado   varchar(40) NOT NULL,     -- cancelado | a_revisar
  creado_en   timestamptz NOT NULL DEFAULT now(),
  ip          inet
);

INSERT INTO tienda.ajustes (clave, valor, actualizado_por) VALUES
  -- Envío a domicilio a precio fijo hasta que estén los correos (etapa 4). Centavos.
  ('costoEnvio', '790000'::jsonb, 'migracion'),
  -- Cuánto tiempo queda apartada la mercadería según cómo se paga (horas).
  ('horasPagoOnline', '2'::jsonb, 'migracion'),
  ('horasPagoFacil', '72'::jsonb, 'migracion'),
  ('horasTransferencia', '48'::jsonb, 'migracion'),
  ('horasPagoLocal', '72'::jsonb, 'migracion'),
  -- Datos para transferir: se completan en el backoffice antes de salir.
  ('datosTransferencia', '{"titular": "", "cuit": "", "banco": "", "cbu": "", "alias": ""}'::jsonb, 'migracion')
ON CONFLICT (clave) DO NOTHING;
