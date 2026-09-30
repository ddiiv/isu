-- ─────────────────────────────────────────────────────────────────────
-- Etapa 3: backoffice.
--
-- Usuarios propios del backoffice (no son los clientes de la tienda ni los
-- empleados de Stocker), con doble factor obligatorio y tres roles:
--
--   dueno     todo, incluidos ajustes, usuarios y datos para transferir
--   operador  pedidos, pagos, productos, fotos, categorías, descuentos, clientes
--   lectura   mirar
--
-- Cada cambio queda en tienda.auditoria (que no se puede editar ni borrar).
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE tienda.admins (
  id                serial PRIMARY KEY,
  email             varchar(150) NOT NULL CHECK (email = lower(email)),
  nombre            varchar(100) NOT NULL,
  hash              varchar(200) NOT NULL,
  rol               varchar(10) NOT NULL CHECK (rol IN ('dueno', 'operador', 'lectura')),
  -- Secreto TOTP cifrado (AES-256-GCM con ADMIN_CLAVE_CIFRADO). Sin 2FA activo no se entra a nada.
  totp_cifrado      text,
  totp_activo       boolean NOT NULL DEFAULT false,
  -- Último código TOTP aceptado: el mismo código no sirve dos veces.
  totp_ultimo       bigint,
  activo            boolean NOT NULL DEFAULT true,
  debe_cambiar_clave boolean NOT NULL DEFAULT true,
  intentos_fallidos integer NOT NULL DEFAULT 0,
  bloqueado_hasta   timestamptz,
  creado_en         timestamptz NOT NULL DEFAULT now(),
  ultimo_ingreso    timestamptz
);
CREATE UNIQUE INDEX admins_email ON tienda.admins (email);

/*
 * Sesiones del backoffice: más cortas que las de los clientes (12 h como
 * máximo, 30 min sin uso) y con un paso intermedio: `verificada = false`
 * mientras falta el código del doble factor.
 */
CREATE TABLE tienda.admin_sesiones (
  id          char(64) PRIMARY KEY,
  admin_id    integer NOT NULL REFERENCES tienda.admins(id) ON DELETE CASCADE,
  verificada  boolean NOT NULL DEFAULT false,
  creada_en   timestamptz NOT NULL DEFAULT now(),
  expira_en   timestamptz NOT NULL,
  visto_en    timestamptz NOT NULL DEFAULT now(),
  ip          inet,
  agente      varchar(200)
);
CREATE INDEX admin_sesiones_admin ON tienda.admin_sesiones (admin_id);

/*
 * Descuentos masivos. Se aplican sobre el precio de Stocker, en la tienda:
 * Stocker no se entera (su precio de lista sigue igual para el mostrador).
 * Si a un producto le tocan varios, gana el mayor. El descuento por
 * transferencia se aplica además, sobre el precio ya rebajado.
 */
CREATE TABLE tienda.descuentos (
  id            serial PRIMARY KEY,
  nombre        varchar(80) NOT NULL CHECK (length(btrim(nombre)) > 0),
  porcentaje    integer NOT NULL CHECK (porcentaje BETWEEN 1 AND 90),
  alcance       varchar(12) NOT NULL CHECK (alcance IN ('todo', 'categorias', 'productos')),
  categoria_ids integer[] NOT NULL DEFAULT '{}',
  producto_ids  integer[] NOT NULL DEFAULT '{}',
  desde         timestamptz,
  hasta         timestamptz,
  activo        boolean NOT NULL DEFAULT true,
  creado_por    varchar(150) NOT NULL,
  creado_en     timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CHECK (hasta IS NULL OR desde IS NULL OR hasta > desde),
  CHECK (alcance <> 'categorias' OR cardinality(categoria_ids) > 0),
  CHECK (alcance <> 'productos' OR cardinality(producto_ids) > 0)
);

-- Lo que se cobró de verdad y el precio de lista de ese momento (para mostrar "antes").
ALTER TABLE tienda.pedido_items ADD COLUMN precio_lista integer CHECK (precio_lista IS NULL OR precio_lista >= precio);

-- Estados de entrega que marca el backoffice hasta que estén los correos (etapa 4).
ALTER TABLE tienda.pedidos ADD COLUMN notas_internas varchar(1000);

/*
 * Colecciones que se eligen a mano desde el backoffice (casillas en la
 * edición de producto): "Destacados" y "Nuevos". Cada una tiene su sección en
 * el inicio y su página; "Nuevos" además va en la barra de navegación.
 * `*_orden`: cuanto más chico, más arriba (empate: lo más reciente primero).
 */
ALTER TABLE tienda.productos
  ADD COLUMN destacado boolean NOT NULL DEFAULT false,
  ADD COLUMN destacado_orden integer NOT NULL DEFAULT 0,
  ADD COLUMN nuevo boolean NOT NULL DEFAULT false,
  ADD COLUMN nuevo_desde timestamptz;
CREATE INDEX productos_destacados ON tienda.productos (destacado_orden, id DESC) WHERE destacado AND visible AND en_stocker;
CREATE INDEX productos_nuevos ON tienda.productos (nuevo_desde DESC NULLS LAST) WHERE nuevo AND visible AND en_stocker;
