-- Título y texto para Google de cada categoría (los de docs/seo-categorias.md), sólo donde todavía están vacíos:
-- lo que ya se cargó a mano desde el backoffice no se pisa. `seo_descripcion` queda vacía A PROPÓSITO: así sigue saliendo la
-- automática, que trae el precio «desde», los talles y las condiciones de hoy (y, con un evento vigente, sus palabras clave:
-- «ofertas y regalos de Navidad») y nunca queda desactualizada. Se editan desde Backoffice → Categorías.
-- Por slug, sin ids fijos: una categoría que no existe en la base no hace nada.

UPDATE tienda.categorias c SET
  seo_titulo = COALESCE(NULLIF(c.seo_titulo, ''), $t$Ropa de hombre: remeras, pantalones y buzos$t$),
  texto = COALESCE(NULLIF(c.texto, ''), $t$Ropa de hombre Isuwaya: remeras y musculosas, pantalones, buzos y camperas, shorts y bermudas, y chombas. Diseñamos y fabricamos nuestra ropa con talles reales, del XS al 5XL.

Comprás online con envíos a todo el país, o retirás gratis en nuestros locales de Flores y de Ingeniero Budge.$t$)
 WHERE c.slug = 'hombre' AND c.padre_id IS NULL;

UPDATE tienda.categorias c SET
  seo_titulo = COALESCE(NULLIF(c.seo_titulo, ''), $t$Ropa de mujer: remeras, tops y pantalones$t$),
  texto = COALESCE(NULLIF(c.texto, ''), $t$Ropa de mujer Isuwaya: remeras, tops y musculosas, pantalones y calzas, buzos y camperas, shorts y bermudas. Fabricamos nuestra ropa con talles reales para que te quede bien.

Comprás online con envíos a todo el país, o retirás gratis en nuestros locales de Flores y de Ingeniero Budge.$t$)
 WHERE c.slug = 'mujer' AND c.padre_id IS NULL;

UPDATE tienda.categorias c SET
  seo_titulo = COALESCE(NULLIF(c.seo_titulo, ''), $t$Ropa de niños: remeras, pantalones y camperas$t$),
  texto = COALESCE(NULLIF(c.texto, ''), $t$Ropa de niños y niñas Isuwaya: remeras, pantalones, camperas y shorts. Cómoda para el día a día y con talles reales.

Comprás online con envíos a todo el país, o retirás gratis en nuestros locales de Flores y de Ingeniero Budge.$t$)
 WHERE c.slug = 'ninos' AND c.padre_id IS NULL;

UPDATE tienda.categorias c SET
  seo_titulo = COALESCE(NULLIF(c.seo_titulo, ''), $t$Remeras y musculosas de hombre$t$),
  texto = COALESCE(NULLIF(c.texto, ''), $t$Remeras de hombre Isuwaya: cuello redondo, cuello V, rayadas, bordadas, térmicas y rústicas. También musculosas clásicas, con bordado y sin ruedo, y chombas.

Todas con talles reales, del XS al 5XL. Elegí tu talle y tu color, comprá online y te lo enviamos a todo el país, o retiralo gratis en nuestros locales de Flores y de Ingeniero Budge.$t$)
 WHERE c.slug = 'remeras' AND c.padre_id = (SELECT id FROM tienda.categorias WHERE slug = 'hombre' AND padre_id IS NULL);

UPDATE tienda.categorias c SET
  seo_titulo = COALESCE(NULLIF(c.seo_titulo, ''), $t$Pantalones de hombre: baggy, lino, sastreros$t$),
  texto = COALESCE(NULLIF(c.texto, ''), $t$Pantalones de hombre Isuwaya: baggy, de lino, sastreros, rectos, chupines, relojeros, deportivos y corte chino. También calzas térmicas.

Fabricamos con talles reales. Comprá online con envíos a todo el país, o retirá gratis en nuestros locales de Flores y de Ingeniero Budge.$t$)
 WHERE c.slug = 'pantalones' AND c.padre_id = (SELECT id FROM tienda.categorias WHERE slug = 'hombre' AND padre_id IS NULL);

UPDATE tienda.categorias c SET
  seo_titulo = COALESCE(NULLIF(c.seo_titulo, ''), $t$Buzos, camperas y chalecos de hombre$t$),
  texto = COALESCE(NULLIF(c.texto, ''), $t$Buzos con y sin capucha, oversize, camperas y chalecos de hombre Isuwaya, varios unisex. Abrigo para todos los días con talles reales.

Comprá online con envíos a todo el país, o retirá gratis en nuestros locales de Flores y de Ingeniero Budge.$t$)
 WHERE c.slug = 'buzos-y-camperas' AND c.padre_id = (SELECT id FROM tienda.categorias WHERE slug = 'hombre' AND padre_id IS NULL);

UPDATE tienda.categorias c SET
  seo_titulo = COALESCE(NULLIF(c.seo_titulo, ''), $t$Shorts y bermudas de hombre$t$),
  texto = COALESCE(NULLIF(c.texto, ''), $t$Shorts y bermudas de hombre Isuwaya: de lino, rústicos, baggy, clásicos con dos bolsillos y con cierre. Para el verano y para todos los días.

Fabricamos con talles reales. Comprá online con envíos a todo el país, o retirá gratis en nuestros locales de Flores y de Ingeniero Budge.$t$)
 WHERE c.slug = 'shorts-y-bermudas' AND c.padre_id = (SELECT id FROM tienda.categorias WHERE slug = 'hombre' AND padre_id IS NULL);

UPDATE tienda.categorias c SET
  seo_titulo = COALESCE(NULLIF(c.seo_titulo, ''), $t$Remeras, tops y musculosas de mujer$t$),
  texto = COALESCE(NULLIF(c.texto, ''), $t$Remeras, tops y musculosas de mujer Isuwaya: oversize, baby tee, crop top, modal con cuello V, bordadas, rayadas y térmicas.

Todas con talles reales, del S al 2XL. Comprá online con envíos a todo el país, o retirá gratis en nuestros locales de Flores y de Ingeniero Budge.$t$)
 WHERE c.slug = 'remeras-y-tops' AND c.padre_id = (SELECT id FROM tienda.categorias WHERE slug = 'mujer' AND padre_id IS NULL);

UPDATE tienda.categorias c SET
  seo_titulo = COALESCE(NULLIF(c.seo_titulo, ''), $t$Pantalones y calzas de mujer$t$),
  texto = COALESCE(NULLIF(c.texto, ''), $t$Pantalones y calzas de mujer Isuwaya: babuchas, de lino, rectos, chupines y baggy con pinzas, además de calzas.

Fabricamos con talles reales. Comprá online con envíos a todo el país, o retirá gratis en nuestros locales de Flores y de Ingeniero Budge.$t$)
 WHERE c.slug = 'pantalones-y-calzas' AND c.padre_id = (SELECT id FROM tienda.categorias WHERE slug = 'mujer' AND padre_id IS NULL);

UPDATE tienda.categorias c SET
  seo_titulo = COALESCE(NULLIF(c.seo_titulo, ''), $t$Buzos y camperas de mujer$t$),
  texto = COALESCE(NULLIF(c.texto, ''), $t$Buzos y camperas de mujer Isuwaya, con talles reales. Comprá online con envíos a todo el país, o retirá gratis en nuestros locales de Flores y de Ingeniero Budge.$t$)
 WHERE c.slug = 'buzos-y-camperas' AND c.padre_id = (SELECT id FROM tienda.categorias WHERE slug = 'mujer' AND padre_id IS NULL);

UPDATE tienda.categorias c SET
  seo_titulo = COALESCE(NULLIF(c.seo_titulo, ''), $t$Shorts y bermudas de mujer$t$),
  texto = COALESCE(NULLIF(c.texto, ''), $t$Shorts y bermudas de mujer Isuwaya, con talles reales. Comprá online con envíos a todo el país, o retirá gratis en nuestros locales de Flores y de Ingeniero Budge.$t$)
 WHERE c.slug = 'shorts-y-bermudas' AND c.padre_id = (SELECT id FROM tienda.categorias WHERE slug = 'mujer' AND padre_id IS NULL);
