-- ─────────────────────────────────────────────────────────────────────
-- Etapa 8: packs, reseñas y portada del inicio.
--
-- Packs ("llevá más, pagá menos"). Una prenda marcada `pack` se vende de 2
-- a 5 unidades, cada una con su talle y su color, con un % de descuento
-- según cuántas lleva (ajuste `packs`). No es otro producto: el descuento lo
-- calcula la API con lo que hay en el carrito (ver pedidos/cotizar.ts), así
-- que vale igual si arma el pack desde su página o suma unidades sueltas.
--
-- Reseñas. Sólo opina quien compró: el enlace llega por mail unos días
-- después de que el pedido se entregó o se retiró (firmado con el número de
-- pedido, como el de seguimiento). Una por prenda del pedido y una general
-- sobre la compra. Entran pendientes y se publican desde el backoffice (o
-- solas, si el ajuste `resenas.publicarSolas` está prendido).
--
-- Portada. Los banners del carrusel del inicio, con foto para compu y
-- (opcional) para celular.
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE tienda.productos
  ADD COLUMN pack boolean NOT NULL DEFAULT false,
  ADD COLUMN pack_orden integer NOT NULL DEFAULT 0,
  -- "100% algodón jersey". Lo carga la tienda: Stocker no lo tiene.
  ADD COLUMN composicion varchar(200) CHECK (composicion IS NULL OR length(btrim(composicion)) > 0),
  -- Resumen de las reseñas publicadas (lo mantiene el trigger de tienda.resenas).
  ADD COLUMN resenas_cantidad integer NOT NULL DEFAULT 0 CHECK (resenas_cantidad >= 0),
  ADD COLUMN resenas_promedio numeric(3,2) CHECK (resenas_promedio IS NULL OR resenas_promedio BETWEEN 1 AND 5);
CREATE INDEX productos_packs ON tienda.productos (pack_orden, id DESC) WHERE pack AND visible AND en_stocker;

-- ── Cuándo se cerró un pedido (entregado o retirado) y cuándo se le pidió la opinión ──
ALTER TABLE tienda.pedidos
  ADD COLUMN cerrado_en timestamptz,
  ADD COLUMN resena_pedida_en timestamptz;

CREATE FUNCTION tienda.pedidos_cerrado() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Lo marca la base, venga de donde venga el cambio (seguimiento del transporte, Stocker o el backoffice).
  IF NEW.estado IN ('entregado', 'retirado') AND NEW.estado IS DISTINCT FROM OLD.estado THEN
    NEW.cerrado_en := COALESCE(NEW.cerrado_en, now());
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pedidos_cerrado BEFORE UPDATE OF estado ON tienda.pedidos
  FOR EACH ROW EXECUTE FUNCTION tienda.pedidos_cerrado();

-- Los que ya estaban cerrados no reciben el mail de golpe (pueden opinar igual desde su pedido).
UPDATE tienda.pedidos SET cerrado_en = actualizado_en, resena_pedida_en = now() WHERE estado IN ('entregado', 'retirado');
CREATE INDEX pedidos_pedir_resena ON tienda.pedidos (cerrado_en) WHERE cerrado_en IS NOT NULL AND resena_pedida_en IS NULL;

-- ── Reseñas ──
CREATE TABLE tienda.resenas (
  id             serial PRIMARY KEY,
  pedido_id      integer NOT NULL REFERENCES tienda.pedidos(id) ON DELETE CASCADE,
  -- NULL = sobre la compra en general (atención, envío, la tienda).
  producto_id    integer REFERENCES tienda.productos(id) ON DELETE CASCADE,
  estrellas      smallint NOT NULL CHECK (estrellas BETWEEN 1 AND 5),
  texto          varchar(1000) CHECK (texto IS NULL OR length(btrim(texto)) > 0),
  -- Cómo le quedó: lo que más ayuda a elegir talle.
  calce          varchar(8) CHECK (calce IN ('chico', 'justo', 'grande')),
  -- Lo que compró (sale del pedido, no lo escribe el cliente).
  talle          varchar(40),
  color          varchar(60),
  -- Cómo se muestra: nombre e inicial del apellido ("Ana G.").
  nombre         varchar(40) NOT NULL CHECK (length(btrim(nombre)) > 0),
  estado         varchar(10) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'publicada', 'rechazada')),
  respuesta      varchar(1000) CHECK (respuesta IS NULL OR length(btrim(respuesta)) > 0),
  respondida_en  timestamptz,
  moderada_por   varchar(150),
  moderada_en    timestamptz,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  CHECK (producto_id IS NOT NULL OR calce IS NULL)
);
-- Una por prenda del pedido, y una general.
CREATE UNIQUE INDEX resenas_una_por_pedido ON tienda.resenas (pedido_id, COALESCE(producto_id, 0));
CREATE INDEX resenas_de_producto ON tienda.resenas (producto_id, creado_en DESC) WHERE estado = 'publicada';
CREATE INDEX resenas_publicadas ON tienda.resenas (creado_en DESC) WHERE estado = 'publicada';
CREATE INDEX resenas_por_moderar ON tienda.resenas (creado_en) WHERE estado = 'pendiente';

CREATE FUNCTION tienda.resenas_resumen() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ids integer[];
BEGIN
  ids := ARRAY(SELECT DISTINCT x FROM unnest(ARRAY[
    CASE WHEN TG_OP <> 'INSERT' THEN OLD.producto_id END,
    CASE WHEN TG_OP <> 'DELETE' THEN NEW.producto_id END]) AS x WHERE x IS NOT NULL);
  UPDATE tienda.productos p SET
      resenas_cantidad = r.n,
      resenas_promedio = r.promedio
    FROM (SELECT i AS id,
                 (SELECT count(*)::int FROM tienda.resenas WHERE producto_id = i AND estado = 'publicada') AS n,
                 (SELECT round(avg(estrellas), 2) FROM tienda.resenas WHERE producto_id = i AND estado = 'publicada') AS promedio
            FROM unnest(ids) AS i) r
   WHERE p.id = r.id AND (p.resenas_cantidad, p.resenas_promedio) IS DISTINCT FROM (r.n, r.promedio);
  RETURN NULL;
END $$;
CREATE TRIGGER resenas_resumen AFTER INSERT OR DELETE OR UPDATE OF estado, estrellas, producto_id ON tienda.resenas
  FOR EACH ROW EXECUTE FUNCTION tienda.resenas_resumen();

-- ── Portada: banners del inicio ──
CREATE TABLE tienda.banners (
  id             serial PRIMARY KEY,
  -- Qué se ve en la foto (lo lee quien no la ve, y Google).
  alt            varchar(160) NOT NULL CHECK (length(btrim(alt)) > 1),
  -- A dónde lleva: sólo una ruta de esta tienda (nunca otro sitio).
  enlace         varchar(300) CHECK (enlace IS NULL OR (enlace ~ '^/([^/\\]|$)' AND enlace !~ '[\s\\]')),
  -- Archivos en el bucket de fotos: b/<id>/<azar>-<ancho>.webp
  foto           varchar(80) CHECK (foto IS NULL OR foto ~ '^b/\d{1,9}/[a-z0-9]{8,40}$'),
  foto_ancho     integer,
  foto_alto      integer,
  foto_movil     varchar(80) CHECK (foto_movil IS NULL OR foto_movil ~ '^b/\d{1,9}/[a-z0-9]{8,40}$'),
  movil_ancho    integer,
  movil_alto     integer,
  orden          integer NOT NULL DEFAULT 0,
  activo         boolean NOT NULL DEFAULT true,
  desde          timestamptz,
  hasta          timestamptz,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CHECK (hasta IS NULL OR desde IS NULL OR hasta > desde)
);

-- /packs vuelve a existir (la tienda anterior la tenía y la 0012 la mandaba al inicio).
DELETE FROM tienda.redirecciones WHERE desde = '/packs' AND origen = 'jumpseller';

-- ── Ajustes ──
INSERT INTO tienda.ajustes (clave, valor, actualizado_por) VALUES
  -- % de descuento por llevar 2, 3, 4 y 5 unidades de la misma prenda marcada como pack.
  ('packs', '[10, 15, 18, 20]'::jsonb, 'migracion'),
  ('resenas', '{"publicarSolas": false, "pedirDias": 4}'::jsonb, 'migracion'),
  -- Cuidados generales (la ficha los muestra en todas las prendas).
  ('cuidados', '"Lavar con agua fría y del revés, con colores parecidos. No usar lavandina. Planchar a temperatura baja, del revés. Secar a la sombra, sin retorcer."'::jsonb, 'migracion'),
  -- Números de la marca para el inicio ("+10 años · haciendo la ropa que vendemos").
  ('cifras', '[{"valor": "+10 años", "texto": "diseñando y fabricando nuestra ropa"}]'::jsonb, 'migracion')
ON CONFLICT (clave) DO NOTHING;
