-- Banners de imagen: link a otro sitio y etiquetas de producto sobre la foto.
--
-- 1) El link del banner entero puede llevar a otro sitio (https://…), además
--    de a una página de la tienda. Los botones siguen siendo sólo de la tienda
--    (lo valida la API). Se abre en otra pestaña.
-- 2) Etiquetas: puntos sobre la foto de un banner sin título. Al tocar uno se
--    ve la tarjeta del producto (foto, nombre y precio), que lleva a su ficha.
--    [{ "producto": <id>, "x": 0-100, "y": 0-100, "xMovil": 0-100|null, "yMovil": 0-100|null }]
--    x/y en % de la foto de compu; xMovil/yMovil en % de la foto de celular.
--    La API valida cada una; la base sólo pone el tope.

-- ── 1) Link a otro sitio ──
ALTER TABLE tienda.banners DROP CONSTRAINT banners_enlace_check;
ALTER TABLE tienda.banners ALTER COLUMN enlace TYPE varchar(500);
ALTER TABLE tienda.banners ADD CONSTRAINT banners_enlace_check CHECK (
  enlace IS NULL
  OR (enlace ~ '^/([^/\\]|$)' AND enlace !~ '[\s\\]' AND length(enlace) <= 300)
  -- Otro sitio: sólo https, sin usuario@ en la dirección.
  OR (enlace ~ '^https://[^\s/\\@?#]+([/?#][^\s\\]*)?$')
);

-- ── 2) Etiquetas de producto ──
ALTER TABLE tienda.banners
  ADD COLUMN etiquetas jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(etiquetas) = 'array' AND jsonb_array_length(etiquetas) <= 8);
