-- ─────────────────────────────────────────────────────────────────────
-- Etapa 1: el catálogo que viene de Stocker.
--
-- Stocker es la fuente de verdad del producto, el precio y el stock. Acá se
-- guarda una COPIA para poder mostrar la tienda sin preguntarle a Stocker en
-- cada visita: la mantiene al día el worker (aviso por NOTIFY al instante +
-- conciliación completa cada unos minutos). Lo que es SÓLO de la tienda
-- (slug, fotos, categorías, visibilidad, textos propios) no lo pisa nunca.
-- ─────────────────────────────────────────────────────────────────────

-- El producto se identifica por su id en Stocker. El SKU padre puede
-- repetirse o cambiar; el id no.
ALTER TABLE tienda.productos DROP CONSTRAINT productos_stocker_padre_key;
ALTER TABLE tienda.productos
  ADD COLUMN stocker_id           integer UNIQUE,
  ADD COLUMN stocker_descripcion  text,
  ADD COLUMN stocker_categoria    varchar(80),
  ADD COLUMN stocker_genero       varchar(40),
  -- false = se fue del catálogo de Stocker (baja, pasó a feria…): no se muestra.
  ADD COLUMN en_stocker           boolean NOT NULL DEFAULT true,
  -- true = alguien lo editó a mano en el backoffice: la sincronización no lo pisa.
  ADD COLUMN nombre_fijo          boolean NOT NULL DEFAULT false,
  ADD COLUMN categorias_fijas     boolean NOT NULL DEFAULT false,
  ADD COLUMN sincronizado_en      timestamptz,
  /*
   * Texto para buscar: nombre + categoría de Stocker, en minúsculas y sin
   * tildes (translate es inmutable; unaccent exigiría una extensión que el
   * usuario de la tienda no puede crear).
   */
  ADD COLUMN busqueda tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', translate(lower(
      coalesce(nombre, '') || ' ' || coalesce(stocker_categoria, '') || ' ' || coalesce(stocker_genero, '')
    ), 'áéíóúüñ', 'aeiouun'))
  ) STORED;
CREATE INDEX productos_stocker_padre ON tienda.productos (stocker_padre);
CREATE INDEX productos_busqueda ON tienda.productos USING gin (busqueda);
CREATE INDEX productos_publicables ON tienda.productos (creado_en DESC) WHERE visible AND en_stocker;

ALTER TABLE tienda.producto_colores ADD COLUMN activo boolean NOT NULL DEFAULT true;

-- Un producto puede estar en varias categorías (un unisex va en Hombre y en Mujer).
CREATE TABLE tienda.producto_categorias (
  producto_id  integer NOT NULL REFERENCES tienda.productos(id) ON DELETE CASCADE,
  categoria_id integer NOT NULL REFERENCES tienda.categorias(id) ON DELETE CASCADE,
  PRIMARY KEY (producto_id, categoria_id)
);
CREATE INDEX producto_categorias_categoria ON tienda.producto_categorias (categoria_id, producto_id);

/*
 * Una fila por SKU vendible. Precio en centavos (entero: nada de coma
 * flotante con plata) y stock tal como lo publica Stocker para los canales
 * online (disponible en los locales que abastecen online − reservas − margen).
 *
 * `stock_en` es la hora en que Stocker calculó ese número. Un dato más viejo
 * nunca pisa uno más nuevo: el catálogo completo tarda segundos en viajar y
 * en el medio pudo llegar el aviso de una venta.
 */
CREATE TABLE tienda.variantes (
  id              serial PRIMARY KEY,
  producto_id     integer NOT NULL REFERENCES tienda.productos(id) ON DELETE CASCADE,
  color_id        integer REFERENCES tienda.producto_colores(id) ON DELETE SET NULL,
  stocker_id      integer NOT NULL UNIQUE,
  sku             varchar(100) NOT NULL UNIQUE,
  talle           varchar(40),
  precio          integer NOT NULL CHECK (precio >= 0),
  stock           integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  stock_en        timestamptz NOT NULL DEFAULT '-infinity',
  orden           integer NOT NULL DEFAULT 0,
  activo          boolean NOT NULL DEFAULT true,
  actualizado_en  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX variantes_producto ON tienda.variantes (producto_id) WHERE activo;

-- Cada pasada de sincronización deja su renglón: el backoffice muestra cuándo
-- fue la última y si falló, y el chequeo de salud avisa si se atrasó.
CREATE TABLE tienda.sincronizaciones (
  id           bigserial PRIMARY KEY,
  tipo         varchar(20) NOT NULL CHECK (tipo IN ('catalogo', 'stock')),
  inicio       timestamptz NOT NULL DEFAULT now(),
  fin          timestamptz,
  productos    integer,
  variantes    integer,
  cambios      integer,
  error        text
);
CREATE INDEX sincronizaciones_recientes ON tienda.sincronizaciones (tipo, inicio DESC);

-- Ajustes nuevos de esta etapa.
INSERT INTO tienda.ajustes (clave, valor, actualizado_por) VALUES
  -- Lo que llega nuevo de Stocker se publica solo (con foto de relleno hasta
  -- que se carguen las reales). En false, espera a que alguien lo prenda.
  ('publicarNuevos',   'true'::jsonb, 'migracion'),
  -- Los agotados se ven (al final, marcados): sacarlos rompe enlaces y SEO.
  ('mostrarAgotados',  'true'::jsonb, 'migracion'),
  -- Desde cuántas unidades se dice "¡Últimas!".
  ('avisoUltimas',     '3'::jsonb, 'migracion')
ON CONFLICT (clave) DO NOTHING;
