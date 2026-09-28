-- ─────────────────────────────────────────────────────────────────────
-- Esquema de la tienda minorista, DENTRO de la base de Stocker.
--
-- Comparte el servidor y la base con Stocker, pero nunca sus tablas: todo lo
-- de la tienda vive en el esquema `tienda`. Stocker sigue siendo dueño del
-- esquema `public` y la tienda no escribe ahí. El stock y los precios se
-- piden a Stocker por su API, que es la que sabe calcularlos (locales que
-- abastecen online, reservas, packs, margen de seguridad).
-- ─────────────────────────────────────────────────────────────────────

-- El esquema lo crea el migrador (src/migrar.ts) si falta: CREATE SCHEMA exige
-- permiso sobre la base, que el usuario propio de la tienda no tiene.

-- Parámetros editables desde el backoffice (monto mínimo, envío gratis,
-- descuento por transferencia, WhatsApp, locales...). Clave → JSON.
CREATE TABLE tienda.ajustes (
  clave           varchar(60) PRIMARY KEY CHECK (clave ~ '^[a-z][a-zA-Z0-9]*$'),
  valor           jsonb NOT NULL,
  actualizado_por varchar(150),
  actualizado_en  timestamptz NOT NULL DEFAULT now()
);

-- Categorías y subcategorías, editables. Dos niveles como máximo
-- (Hombre › Remeras): más niveles complican el menú sin ayudar a vender.
CREATE TABLE tienda.categorias (
  id               serial PRIMARY KEY,
  padre_id         integer REFERENCES tienda.categorias(id) ON DELETE RESTRICT,
  nombre           varchar(60) NOT NULL CHECK (length(btrim(nombre)) > 0),
  slug             varchar(80) NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  orden            integer NOT NULL DEFAULT 0,
  visible          boolean NOT NULL DEFAULT true,
  seo_titulo       varchar(70),
  seo_descripcion  varchar(160),
  creado_en        timestamptz NOT NULL DEFAULT now(),
  actualizado_en   timestamptz NOT NULL DEFAULT now(),
  CHECK (padre_id IS NULL OR padre_id <> id)
);
-- El slug es único entre hermanas: /hombre/remeras y /mujer/remeras conviven.
CREATE UNIQUE INDEX categorias_slug_raiz ON tienda.categorias (slug) WHERE padre_id IS NULL;
CREATE UNIQUE INDEX categorias_slug_hija ON tienda.categorias (padre_id, slug) WHERE padre_id IS NOT NULL;

CREATE FUNCTION tienda.categorias_profundidad() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.padre_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM tienda.categorias WHERE id = NEW.padre_id AND padre_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Las categorías tienen dos niveles: una subcategoría no puede tener hijas'
        USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM tienda.categorias WHERE padre_id = NEW.id) THEN
      RAISE EXCEPTION 'Una categoría con subcategorías no puede pasar a ser subcategoría'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.actualizado_en := now();
  RETURN NEW;
END $$;

CREATE TRIGGER categorias_profundidad
  BEFORE INSERT OR UPDATE ON tienda.categorias
  FOR EACH ROW EXECUTE FUNCTION tienda.categorias_profundidad();

-- Quién cambió qué desde el backoffice. Sólo se agrega, nunca se edita.
CREATE TABLE tienda.auditoria (
  id         bigserial PRIMARY KEY,
  actor      varchar(150) NOT NULL,
  accion     varchar(60)  NOT NULL,
  entidad    varchar(60)  NOT NULL,
  entidad_id varchar(60),
  detalle    jsonb,
  ip         inet,
  creado_en  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auditoria_entidad ON tienda.auditoria (entidad, entidad_id, creado_en DESC);

CREATE FUNCTION tienda.auditoria_inmutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La auditoría no se modifica ni se borra' USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER auditoria_inmutable
  BEFORE UPDATE OR DELETE ON tienda.auditoria
  FOR EACH ROW EXECUTE FUNCTION tienda.auditoria_inmutable();
