-- ─────────────────────────────────────────────────────────────────────
-- Catálogo de la tienda y sus fotos.
--
-- `productos` y `producto_colores` los llena la sincronización con Stocker
-- (etapa 1): acá sólo vive lo que la tienda agrega (slug, categoría, SEO,
-- visibilidad, fotos). El stock y el precio NO se guardan acá.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE tienda.productos (
  id                 serial PRIMARY KEY,
  stocker_padre      varchar(60) NOT NULL UNIQUE,  -- SKU padre en Stocker
  nombre             varchar(150) NOT NULL,
  slug               varchar(80) NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  categoria_id       integer REFERENCES tienda.categorias(id) ON DELETE SET NULL,
  visible            boolean NOT NULL DEFAULT false,
  descripcion        text,
  seo_titulo         varchar(70),
  seo_descripcion    varchar(160),
  creado_en          timestamptz NOT NULL DEFAULT now(),
  actualizado_en     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tienda.producto_colores (
  id          serial PRIMARY KEY,
  producto_id integer NOT NULL REFERENCES tienda.productos(id) ON DELETE CASCADE,
  clave       varchar(40) NOT NULL CHECK (clave ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  nombre      varchar(60) NOT NULL,
  hex         char(7) CHECK (hex ~ '^#[0-9a-fA-F]{6}$'),
  orden       integer NOT NULL DEFAULT 0,
  UNIQUE (producto_id, clave)
);

/*
 * Dos clases de foto:
 *   color       la prenda sola (estirada/percha) de UN color → color_id obligatorio
 *   exhibicion  con modelo, para la galería → color_id opcional (el que lleva puesto)
 */
CREATE TABLE tienda.fotos (
  id          serial PRIMARY KEY,
  producto_id integer NOT NULL REFERENCES tienda.productos(id) ON DELETE CASCADE,
  tipo        varchar(12) NOT NULL CHECK (tipo IN ('color', 'exhibicion')),
  color_id    integer REFERENCES tienda.producto_colores(id) ON DELETE CASCADE,
  orden       integer NOT NULL DEFAULT 0 CHECK (orden >= 0),
  clave       varchar(200) NOT NULL UNIQUE,   -- ruta en el bucket (R2)
  ancho       integer CHECK (ancho > 0),
  alto        integer CHECK (alto > 0),
  alt         varchar(160),
  creado_en   timestamptz NOT NULL DEFAULT now(),
  CHECK (tipo <> 'color' OR color_id IS NOT NULL)
);
CREATE INDEX fotos_producto ON tienda.fotos (producto_id, tipo, orden);

/*
 * Topes, aplicados en la base y no sólo en la pantalla:
 *   · 5 fotos de tipo color por color
 *   · el producto entero (color + exhibición) ≤ 5 × cantidad de colores
 *   · el color tiene que ser del mismo producto
 *
 * El FOR UPDATE sobre el producto serializa las altas de un mismo producto:
 * sin él, dos subidas simultáneas leerían "hay 4" y entrarían las dos.
 */
CREATE FUNCTION tienda.fotos_topes() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  colores    integer;
  de_color   integer;
  del_padre  integer;
BEGIN
  PERFORM 1 FROM tienda.productos WHERE id = NEW.producto_id FOR UPDATE;

  IF NEW.color_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM tienda.producto_colores WHERE id = NEW.color_id AND producto_id = NEW.producto_id
  ) THEN
    RAISE EXCEPTION 'El color % no es de este producto', NEW.color_id USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT count(*) INTO colores FROM tienda.producto_colores WHERE producto_id = NEW.producto_id;

  IF NEW.tipo = 'color' THEN
    SELECT count(*) INTO de_color FROM tienda.fotos
     WHERE producto_id = NEW.producto_id AND tipo = 'color' AND color_id = NEW.color_id
       AND id IS DISTINCT FROM NEW.id;
    IF de_color >= 5 THEN
      RAISE EXCEPTION 'Este color ya tiene 5 fotos' USING ERRCODE = 'check_violation', HINT = 'color_lleno';
    END IF;
  END IF;

  SELECT count(*) INTO del_padre FROM tienda.fotos
   WHERE producto_id = NEW.producto_id AND id IS DISTINCT FROM NEW.id;
  IF del_padre >= colores * 5 THEN
    RAISE EXCEPTION 'El producto ya tiene % fotos (5 por cada uno de sus % colores)', colores * 5, colores
      USING ERRCODE = 'check_violation', HINT = 'producto_lleno';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER fotos_topes
  BEFORE INSERT OR UPDATE OF producto_id, tipo, color_id ON tienda.fotos
  FOR EACH ROW EXECUTE FUNCTION tienda.fotos_topes();
