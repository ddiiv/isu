-- ─────────────────────────────────────────────────────────────────────
-- Etapa 4: envíos con Correo Argentino, Andreani, OCA, Mercado Envíos y
-- Cabify (en el día); seguimiento y avisos por email y WhatsApp.
-- ─────────────────────────────────────────────────────────────────────

-- Peso de la prenda para cotizar (null = el peso por defecto de Ajustes).
ALTER TABLE tienda.productos ADD COLUMN peso_gramos integer CHECK (peso_gramos IS NULL OR peso_gramos BETWEEN 10 AND 30000);

/*
 * Con qué y cómo viaja el pedido. `estandar` es el envío de costo fijo de la
 * etapa 2 (sin transporte integrado). A sucursal hace falta la sucursal.
 * `envio_mercado_pago`: con Mercado Envíos el envío lo cobra Mercado Pago
 * (queda acá lo que cobró, para mostrarlo; no suma al total de la tienda).
 */
ALTER TABLE tienda.pedidos
  ADD COLUMN transporte varchar(20) CHECK (transporte IN ('correo_argentino', 'andreani', 'oca', 'mercado_envios', 'cabify', 'estandar')),
  ADD COLUMN servicio_envio varchar(12) CHECK (servicio_envio IN ('domicilio', 'sucursal', 'en_el_dia')),
  ADD COLUMN sucursal_envio jsonb,
  ADD COLUMN avisos_whatsapp boolean NOT NULL DEFAULT false,
  -- Peso y caja con que se cotizó: la etiqueta sale con los mismos datos que se cobraron.
  ADD COLUMN paquete_envio jsonb,
  ADD COLUMN envio_mercado_pago integer CHECK (envio_mercado_pago IS NULL OR envio_mercado_pago >= 0);
UPDATE tienda.pedidos SET transporte = 'estandar', servicio_envio = 'domicilio' WHERE entrega = 'envio' AND transporte IS NULL;
ALTER TABLE tienda.pedidos
  ADD CONSTRAINT pedidos_transporte_si_envio CHECK ((entrega = 'envio') = (transporte IS NOT NULL)),
  ADD CONSTRAINT pedidos_sucursal_si_sucursal CHECK (servicio_envio IS DISTINCT FROM 'sucursal' OR sucursal_envio IS NOT NULL);

/*
 * El envío de un pedido: la etiqueta del transporte y su seguimiento. Un
 * pedido tiene como mucho UN envío vigente (`activo`); si se descarta una
 * etiqueta (dirección mal cargada), queda como historia y se genera otra.
 */
CREATE TABLE tienda.envios (
  id              serial PRIMARY KEY,
  pedido_id       integer NOT NULL REFERENCES tienda.pedidos(id) ON DELETE CASCADE,
  transporte      varchar(20) NOT NULL CHECK (transporte IN ('correo_argentino', 'andreani', 'oca', 'mercado_envios', 'cabify')),
  servicio        varchar(12) NOT NULL CHECK (servicio IN ('domicilio', 'sucursal', 'en_el_dia')),
  seguimiento     varchar(60) NOT NULL CHECK (seguimiento ~ '^[A-Za-z0-9_-]{3,60}$'),
  externo_id      varchar(60),
  etiqueta_clave  varchar(200),
  costo           integer CHECK (costo IS NULL OR costo >= 0),
  estado          varchar(15) NOT NULL DEFAULT 'creado'
                  CHECK (estado IN ('creado', 'en_camino', 'en_sucursal', 'en_reparto', 'entregado', 'no_entregado', 'devuelto', 'cancelado')),
  activo          boolean NOT NULL DEFAULT true,
  despachado_en   timestamptz,
  entregado_en    timestamptz,
  -- Cuándo preguntarle de nuevo al transporte (el worker recorre por acá).
  proximo_chequeo timestamptz NOT NULL DEFAULT now(),
  errores_seguidos integer NOT NULL DEFAULT 0,
  ultimo_error    varchar(300),
  creado_por      varchar(150),
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX envios_pedido_vigente ON tienda.envios (pedido_id) WHERE activo;
CREATE UNIQUE INDEX envios_seguimiento ON tienda.envios (transporte, seguimiento);
CREATE INDEX envios_a_seguir ON tienda.envios (proximo_chequeo) WHERE activo AND estado NOT IN ('entregado', 'devuelto', 'cancelado');

/* Lo que va contando el transporte. El mismo evento no se guarda dos veces. */
CREATE TABLE tienda.envio_eventos (
  id          bigserial PRIMARY KEY,
  envio_id    integer NOT NULL REFERENCES tienda.envios(id) ON DELETE CASCADE,
  fecha       timestamptz NOT NULL,
  estado      varchar(15) NOT NULL,
  descripcion varchar(300) NOT NULL,
  ubicacion   varchar(120),
  creado_en   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (envio_id, fecha, descripcion)
);

/*
 * Avisos al cliente ya mandados: uno por pedido, tipo y canal. Con esto un
 * reintento (o dos réplicas del worker) nunca manda el mismo WhatsApp dos veces.
 */
CREATE TABLE tienda.avisos (
  id         bigserial PRIMARY KEY,
  pedido_id  integer NOT NULL REFERENCES tienda.pedidos(id) ON DELETE CASCADE,
  tipo       varchar(30) NOT NULL,
  canal      varchar(10) NOT NULL CHECK (canal IN ('email', 'whatsapp')),
  creado_en  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pedido_id, tipo, canal)
);

INSERT INTO tienda.ajustes (clave, valor, actualizado_por) VALUES
  -- Qué transporte y servicio se ofrece, y con qué recargo (%). Además tiene que tener credenciales.
  ('transportes', '{
     "correo_argentino": {"activo": true, "domicilio": true, "sucursal": true, "recargo": 0},
     "andreani":         {"activo": true, "domicilio": true, "sucursal": true, "recargo": 0},
     "oca":              {"activo": true, "domicilio": true, "sucursal": true, "recargo": 0},
     "mercado_envios":   {"activo": true, "domicilio": true, "sucursal": false, "recargo": 0},
     "cabify":           {"activo": true, "domicilio": false, "sucursal": false, "recargo": 0}
   }'::jsonb, 'migracion'),
  -- De dónde salen los paquetes (remitente en las etiquetas).
  ('origenEnvios', '{"nombre": "Isuwaya", "calle": "Bacacay", "numero": "3231", "piso": "", "cp": "1406", "localidad": "Flores", "provincia": "CABA", "email": "isu.isuwaya@gmail.com", "telefono": "1168515444", "cuit": ""}'::jsonb, 'migracion'),
  -- Peso y caja para cotizar: la caja sale de la cantidad de prendas.
  ('paqueteEnvios', '{"pesoPrendaGramos": 350, "pesoCajaGramos": 150, "cajas": [
     {"hastaPrendas": 2, "altoCm": 8, "anchoCm": 25, "largoCm": 30},
     {"hastaPrendas": 5, "altoCm": 15, "anchoCm": 30, "largoCm": 40},
     {"hastaPrendas": 99, "altoCm": 30, "anchoCm": 40, "largoCm": 50}
   ]}'::jsonb, 'migracion'),
  -- Envíos en el día (Cabify): códigos postales, días (1 = lunes) y hora de corte.
  ('enviosEnElDia', '{"cps": "1000-1499,1600-1899", "dias": [1, 2, 3, 4, 5], "horaCorte": "14:00"}'::jsonb, 'migracion'),
  ('avisosWhatsapp', 'true'::jsonb, 'migracion')
ON CONFLICT (clave) DO NOTHING;
