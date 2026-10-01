-- ─────────────────────────────────────────────────────────────────────
-- SEO: no perder el posicionamiento de la tienda anterior (Jumpseller) y
-- textos propios por categoría.
--
-- Redirecciones 301. Google tiene indexadas las direcciones viejas
-- (www.isuwaya.com/abel-pantalon-hombre, /minorista/hombre/remeras…). Si
-- al cambiar de tienda dan 404, se pierde lo ganado en años. Cada una manda
-- a su equivalente:
--
--   producto    por SKU, a su ficha actual (/producto/<slug>). Si el producto
--               no está publicado (oculto, de baja), a "hacia": su categoría,
--               nunca a un 404.
--   el resto    a "hacia" (categorías, contacto → /locales, políticas…).
--
-- La API resuelve el mapa y la tienda redirige antes de armar la página
-- (apps/web/src/proxy.ts). Se editan en el backoffice → Redirecciones.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE tienda.redirecciones (
  id         serial PRIMARY KEY,
  -- Dirección vieja: sólo la ruta, en minúsculas, sin "?" ni barra final.
  desde      varchar(300) NOT NULL UNIQUE
             CHECK (desde ~ '^/[a-z0-9._~%!$&''()*+,;=:@/-]*$' AND desde !~ '//' AND desde !~ '/$'
                    AND desde !~ '^/(_next|api)(/|$)'),
  -- Producto de Stocker al que corresponde (si era una ficha).
  sku        varchar(100),
  -- Ruta de ESTA tienda (nunca otro dominio: no se puede usar para mandar a un sitio ajeno).
  hacia      varchar(300) NOT NULL DEFAULT '/'
             CHECK (hacia ~ '^/([^/\\]|$)' AND hacia !~ '[\s\\]'),
  origen     varchar(12) NOT NULL DEFAULT 'manual' CHECK (origen IN ('jumpseller', 'manual')),
  creado_por varchar(150),
  creado_en  timestamptz NOT NULL DEFAULT now(),
  CHECK (desde <> hacia)
);
CREATE INDEX redirecciones_sku ON tienda.redirecciones (upper(sku)) WHERE sku IS NOT NULL;

-- Las 70 direcciones de www.isuwaya.com (sitemap de Jumpseller, 30/09/2026).
-- Gerra e IBIZA tenían otro SKU allá: acá va el de Stocker.
INSERT INTO tienda.redirecciones (desde, sku, hacia, origen) VALUES
  ('/contact', NULL, '/locales', 'jumpseller'),
  ('/abel-pantalon-hombre', 'ISUABEPAN', '/hombre/pantalones', 'jumpseller'),
  ('/abyys-campera-hombre', 'ISUABYCAM', '/hombre/buzos-y-camperas', 'jumpseller'),
  ('/akil-short-hombre', 'ISUAKISHO', '/hombre/shorts-y-bermudas', 'jumpseller'),
  ('/argel-pantalon-hombre', 'ISUARGPAN', '/hombre/pantalones', 'jumpseller'),
  ('/baby-dl-remera-mujer', 'ISUBABREM', '/mujer/remeras-y-tops', 'jumpseller'),
  ('/borda-remera-mujer', 'ISUBRAREM', '/mujer/remeras-y-tops', 'jumpseller'),
  ('/bordi-remera-hombre', 'ISUBRIREM', '/hombre/remeras', 'jumpseller'),
  ('/box-pantalon-nino', 'ISUBOXPAN', '/ninos/pantalones', 'jumpseller'),
  ('/cairo-remera-hombre', 'ISUCAIREM', '/hombre/remeras', 'jumpseller'),
  ('/catalogo', NULL, '/', 'jumpseller'),
  ('/cherry-remera-hombre', 'ISUCHEREM', '/hombre/remeras', 'jumpseller'),
  ('/comfort-buzo-sin-capucha-oversize-isu', 'ISUCOMBUZ', '/hombre/buzos-y-camperas', 'jumpseller'),
  ('/frida-pantalon-mujer', 'ISUFRIPAN', '/mujer/pantalones-y-calzas', 'jumpseller'),
  ('/gerra-bermuda-gerrillera-rustico-isu', 'ISUGUEBER', '/mujer/shorts-y-bermudas', 'jumpseller'),
  ('/henry-remera-hombre', 'ISUHENREM', '/hombre/remeras', 'jumpseller'),
  ('/ibiza-bermuda-lino-corte-chino-hombre-isu', 'ISUIBISHO', '/hombre/shorts-y-bermudas', 'jumpseller'),
  ('/junior-remera-nino', 'ISUJUNREM', '/ninos/remeras', 'jumpseller'),
  ('/kyro-campera-rompeviento-dama-isu', 'ISUKYRCAM', '/mujer/buzos-y-camperas', 'jumpseller'),
  ('/loan-pantalon-hombre', 'ISULOAPAN', '/hombre/pantalones', 'jumpseller'),
  ('/loix-campera-mujer', 'ISULOICAM', '/mujer/buzos-y-camperas', 'jumpseller'),
  ('/luxi-buzo-tricolor-con-capucha-isu', 'ISULUXBUZ', '/hombre/buzos-y-camperas', 'jumpseller'),
  ('/malta-pantalon-nino', 'ISUMALPAN', '/ninos/pantalones', 'jumpseller'),
  ('/mateu-pantalon-nino', 'ISUMATPAN', '/ninos/pantalones', 'jumpseller'),
  ('/microfibra-pantalon-hombre', 'ISUMICPAN', '/hombre/pantalones', 'jumpseller'),
  ('/minorista-2/isu-mujer/isu-buzos', NULL, '/mujer/buzos-y-camperas', 'jumpseller'),
  ('/minorista-2/isu-mujer/isu-camperas', NULL, '/mujer/buzos-y-camperas', 'jumpseller'),
  ('/minorista-2/isu-mujer/isu-pantalones', NULL, '/mujer/pantalones-y-calzas', 'jumpseller'),
  ('/minorista-2/isu-mujer/isu-remeras', NULL, '/mujer/remeras-y-tops', 'jumpseller'),
  ('/minorista-2/isu-mujer/isu-shorts', NULL, '/mujer/shorts-y-bermudas', 'jumpseller'),
  ('/minorista/hombre', NULL, '/hombre', 'jumpseller'),
  ('/minorista/hombre/buzos', NULL, '/hombre/buzos-y-camperas', 'jumpseller'),
  ('/minorista/hombre/camperas', NULL, '/hombre/buzos-y-camperas', 'jumpseller'),
  ('/minorista/hombre/chalecos', NULL, '/hombre/buzos-y-camperas', 'jumpseller'),
  ('/minorista/hombre/isu-pantalones', NULL, '/hombre/pantalones', 'jumpseller'),
  ('/minorista/hombre/remeras', NULL, '/hombre/remeras', 'jumpseller'),
  ('/minorista/hombre/shorts', NULL, '/hombre/shorts-y-bermudas', 'jumpseller'),
  ('/minorista/mujer', NULL, '/mujer', 'jumpseller'),
  ('/minorista/nino', NULL, '/ninos', 'jumpseller'),
  ('/minorista/nino/buzos', NULL, '/ninos/camperas', 'jumpseller'),
  ('/minorista/nino/camperas', NULL, '/ninos/camperas', 'jumpseller'),
  ('/minorista/nino/pantalones', NULL, '/ninos/pantalones', 'jumpseller'),
  ('/minorista/nino/remeras', NULL, '/ninos/remeras', 'jumpseller'),
  ('/minorista/nino/shorts', NULL, '/ninos/shorts', 'jumpseller'),
  ('/mirra-remera-mujer', 'ISUMIRREM', '/mujer/remeras-y-tops', 'jumpseller'),
  ('/mirra-remera-unisex', 'ISUMIRREM', '/mujer/remeras-y-tops', 'jumpseller'),
  ('/mistica-campera-nino', 'ISUMISCAM', '/ninos/camperas', 'jumpseller'),
  ('/monaco-buzo-unisex', 'ISUMONBUZ', '/hombre/buzos-y-camperas', 'jumpseller'),
  ('/montero-campera-unisex', 'ISUMONCAM', '/hombre/buzos-y-camperas', 'jumpseller'),
  ('/morgan-calza-termica-isu', 'ISUMORPAN', '/hombre/pantalones', 'jumpseller'),
  ('/moron-short-de-futbol-isu', 'ISUMORSHO', '/hombre/shorts-y-bermudas', 'jumpseller'),
  ('/morri-remera-hombre', 'ISUMORREM', '/hombre/remeras', 'jumpseller'),
  ('/nino', NULL, '/ninos', 'jumpseller'),
  ('/niza-pantalon-mujer', 'ISUNIZPAN', '/mujer/pantalones-y-calzas', 'jumpseller'),
  ('/oxford-pantalon-mujer', 'ISUOXFPAN', '/mujer/pantalones-y-calzas', 'jumpseller'),
  ('/pack-x3-santino-remera-hombre-en-cuello-v', 'PACK3ISUSANREM', '/hombre/remeras', 'jumpseller'),
  ('/packs', NULL, '/', 'jumpseller'),
  ('/politica-de-privacidad', NULL, '/privacidad', 'jumpseller'),
  ('/politica-de-reembolso', NULL, '/devoluciones', 'jumpseller'),
  ('/polo-buzo-hombre', 'ISUPOLBUZ', '/hombre/buzos-y-camperas', 'jumpseller'),
  ('/raya-remera-raydad-de-hombre-isu', 'ISURAYREM', '/hombre/remeras', 'jumpseller'),
  ('/relojero-pantalon-hombre', 'ISURELPAN', '/hombre/pantalones', 'jumpseller'),
  ('/rum-short-hombre', 'ISURUMSHO', '/hombre/shorts-y-bermudas', 'jumpseller'),
  ('/santino-remera-hombre', 'ISUSANREM', '/hombre/remeras', 'jumpseller'),
  ('/sasha-remera-mujer', 'ISUSASREM', '/mujer/remeras-y-tops', 'jumpseller'),
  ('/soft-remera-tipo-tejida-dama-isu', 'ISUSOFREM', '/mujer/remeras-y-tops', 'jumpseller'),
  ('/streck-short-hombre', 'ISUSTRSHO', '/hombre/shorts-y-bermudas', 'jumpseller'),
  ('/terminos-y-condiciones', NULL, '/terminos', 'jumpseller'),
  ('/visa-remera-rayada-dama-isu', 'ISUVISREM', '/mujer/remeras-y-tops', 'jumpseller'),
  ('/wolf-chaleco-hombre', 'ISUWOLCAM', '/hombre/buzos-y-camperas', 'jumpseller')
ON CONFLICT (desde) DO NOTHING;

-- Texto de cada categoría (lo lee Google y el cliente, abajo de la grilla).
-- seo_titulo y seo_descripcion ya existían (0001); ahora la tienda los usa.
ALTER TABLE tienda.categorias
  ADD COLUMN texto text CHECK (length(texto) <= 3000);
