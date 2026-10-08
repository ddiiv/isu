-- Etapa 12: banners interactivos y direcciones sin ids.
--
-- 1) Guías de talles con nombre en la dirección del backoffice
--    (/guias-talles/remera-regular-adulto en vez de /guias-talles/12). El slug
--    sale solo del nombre (un trigger), también para las guías que ya existen.
--
-- 2) Fotos y banners sin el id en su dirección pública: las claves nuevas van
--    en una carpeta al azar (b/3f9a0c1b2d4e/…). Las viejas (b/12/…) siguen
--    valiendo hasta pasarlas con `pnpm fotos:sin-ids`.
--
-- 3) Banners interactivos: título, texto, etiqueta, hasta 2 botones con link,
--    un fondo de color (para banners sin foto) y un producto destacado (uno
--    elegido o uno automático: el más nuevo, un pack, uno en liquidación, uno
--    destacado). Los textos admiten {descuento}, {cuotas}, {envioGratis},
--    {packsHasta}, {packsMinimo} y {packsMaximo}: salen de Ajustes, así que
--    nunca quedan desactualizados.
--
-- 4) Banners sugeridos, armados con lo que dice la tienda. Quedan activos sólo
--    si todavía no hay ningún banner activo; si no, quedan apagados para
--    prenderlos desde Portada.

-- ── 1) Guías: slug ──
ALTER TABLE tienda.guias_talles ADD COLUMN slug varchar(80);

CREATE FUNCTION tienda.guia_slug() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  base text;
  s text;
  n int := 1;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.nombre = OLD.nombre AND NEW.slug IS NOT NULL THEN RETURN NEW; END IF;
  base := trim(BOTH '-' FROM regexp_replace(
    translate(lower(NEW.nombre), 'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc'), '[^a-z0-9]+', '-', 'g'));
  base := trim(BOTH '-' FROM left(base, 70));
  IF base = '' THEN base := 'guia'; END IF;
  -- "nueva" es la dirección de crear una guía.
  IF base = 'nueva' THEN base := 'nueva-guia'; END IF;
  s := base;
  WHILE EXISTS (SELECT 1 FROM tienda.guias_talles WHERE slug = s AND id IS DISTINCT FROM NEW.id) LOOP
    n := n + 1;
    s := base || '-' || n;
  END LOOP;
  NEW.slug := s;
  RETURN NEW;
END $$;

CREATE TRIGGER guias_talles_slug BEFORE INSERT OR UPDATE OF nombre, slug ON tienda.guias_talles
  FOR EACH ROW EXECUTE FUNCTION tienda.guia_slug();

-- Las que ya existen (en orden, así la primera de dos con el mismo nombre se queda el corto).
DO $$
DECLARE g record;
BEGIN
  FOR g IN SELECT id FROM tienda.guias_talles ORDER BY id LOOP
    UPDATE tienda.guias_talles SET slug = NULL WHERE id = g.id;
  END LOOP;
END $$;

ALTER TABLE tienda.guias_talles ALTER COLUMN slug SET NOT NULL;
ALTER TABLE tienda.guias_talles ADD CONSTRAINT guias_talles_slug_unico UNIQUE (slug);
ALTER TABLE tienda.guias_talles ADD CONSTRAINT guias_talles_slug_forma CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

-- ── 2) Banners: claves de foto sin ids ──
ALTER TABLE tienda.banners DROP CONSTRAINT banners_foto_check;
ALTER TABLE tienda.banners DROP CONSTRAINT banners_foto_movil_check;
ALTER TABLE tienda.banners ADD CONSTRAINT banners_foto_check
  CHECK (foto IS NULL OR foto ~ '^b/([0-9]{1,9}|[a-f0-9]{12})/[a-z0-9]{8,40}$');
ALTER TABLE tienda.banners ADD CONSTRAINT banners_foto_movil_check
  CHECK (foto_movil IS NULL OR foto_movil ~ '^b/([0-9]{1,9}|[a-f0-9]{12})/[a-z0-9]{8,40}$');

-- ── 3) Banners interactivos ──
ALTER TABLE tienda.banners
  ADD COLUMN titulo varchar(90) CHECK (titulo IS NULL OR length(btrim(titulo)) > 1),
  ADD COLUMN texto varchar(220),
  ADD COLUMN etiqueta varchar(40),
  -- [{ "texto": "Ver packs", "enlace": "/packs", "estilo": "lleno" | "borde" }] (hasta 2; la API valida cada uno)
  ADD COLUMN botones jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(botones) = 'array' AND jsonb_array_length(botones) <= 2),
  ADD COLUMN fondo varchar(12) NOT NULL DEFAULT 'marca'
    CHECK (fondo IN ('marca', 'tinta', 'ahorro', 'oferta', 'crema', 'rosa', 'arena')),
  ADD COLUMN alineacion varchar(10) NOT NULL DEFAULT 'izquierda' CHECK (alineacion IN ('izquierda', 'centro')),
  ADD COLUMN producto_id integer REFERENCES tienda.productos (id) ON DELETE SET NULL,
  ADD COLUMN producto_auto varchar(12) CHECK (producto_auto IN ('nuevo', 'pack', 'liquidacion', 'destacado')),
  -- Si el producto automático no encuentra ninguno (no hay nada en liquidación), el banner no sale.
  ADD COLUMN ocultar_sin_producto boolean NOT NULL DEFAULT false,
  -- Los sugeridos (para no volver a crearlos y poder restaurarlos).
  ADD COLUMN sugerido varchar(30) UNIQUE,
  ADD CONSTRAINT banners_un_producto CHECK (producto_id IS NULL OR producto_auto IS NULL);

-- ── 4) Banners sugeridos ──
DO $$
DECLARE
  activos boolean := NOT EXISTS (SELECT 1 FROM tienda.banners WHERE activo);
BEGIN
  INSERT INTO tienda.banners (sugerido, orden, activo, alt, titulo, texto, etiqueta, botones, fondo, alineacion, producto_auto, ocultar_sin_producto) VALUES
    ('nuevos', 100, activos, 'Lo nuevo de Isuwaya',
     'Lo último que salió del taller',
     'Diseñamos y fabricamos nuestra ropa, con talles reales. Prenditas para todos tus días.',
     'Nuevos ingresos',
     '[{"texto": "Ver lo nuevo", "enlace": "/nuevos", "estilo": "lleno"}, {"texto": "Comprar Mujer", "enlace": "/mujer", "estilo": "borde"}]',
     'crema', 'izquierda', 'nuevo', false),
    ('packs', 101, activos, 'Packs: llevá más, pagá menos',
     'Llevá más, pagá menos',
     'Armá tu pack de {packsMinimo} a {packsMaximo} prendas, cada una con su talle y su color.',
     'Hasta {packsHasta}% OFF',
     '[{"texto": "Armar mi pack", "enlace": "/packs", "estilo": "lleno"}]',
     'ahorro', 'izquierda', 'pack', true),
    ('transferencia', 102, activos, '{descuento}% OFF pagando con transferencia',
     '{descuento}% OFF pagando con transferencia',
     'O hasta {cuotas} cuotas sin interés con tarjeta. Envíos a todo el país.',
     'Pagá menos',
     '[{"texto": "Comprar Mujer", "enlace": "/mujer", "estilo": "lleno"}, {"texto": "Comprar Hombre", "enlace": "/hombre", "estilo": "borde"}]',
     'marca', 'izquierda', 'destacado', false),
    ('liquidacion', 103, activos, 'Liquidación de fin de temporada',
     'Liquidación',
     'Prendas de la temporada pasada a precio más bajo. Hasta agotar stock.',
     'Fin de temporada',
     '[{"texto": "Ver liquidación", "enlace": "/liquidacion", "estilo": "lleno"}]',
     'oferta', 'izquierda', 'liquidacion', true),
    ('envio', 104, activos, 'Envío gratis desde {envioGratis}',
     'Envío gratis desde {envioGratis}',
     'A todo el país. En CABA y GBA te llega hoy o mañana.',
     NULL,
     '[{"texto": "Ver novedades", "enlace": "/nuevos", "estilo": "lleno"}]',
     'tinta', 'centro', NULL, false),
    ('outfit', 105, activos, 'Armá tu outfit en un minuto',
     'Armá tu outfit en un minuto',
     'Cuatro preguntas y te mostramos combinaciones con lo que hay en tu talle y entra en tu presupuesto.',
     'Nuevo',
     '[{"texto": "Armar mi outfit", "enlace": "/outfits", "estilo": "lleno"}]',
     'arena', 'izquierda', NULL, false),
    ('locales', 106, activos, 'Vení a probártela a nuestros locales',
     'Vení a probártela',
     'Retirá gratis tus compras online en nuestros locales.',
     NULL,
     '[{"texto": "Ver locales", "enlace": "/locales", "estilo": "lleno"}]',
     'rosa', 'centro', NULL, false)
  ON CONFLICT (sugerido) DO NOTHING;
END $$;
