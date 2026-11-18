# Plan de Google: SEO, medición y promoción

Auditoría del 18/11/2026 sobre https://www.isuwaya.com (código del repo y páginas públicas bajadas con `curl`, sólo lectura; no se entró a producción con sesión ni se cambió nada allá). Complementa `docs/seo.md`, `docs/seo-categorias.md` y `docs/medicion.md`: lo que ya estaba resuelto ahí no se repite.

## 1. Cómo está hoy (lo que anda)

Se revisaron las 112 direcciones del sitemap (77 fichas, 15 categorías, páginas de packs, liquidación, institucionales) más `/relampago`, `/ofertas` y la búsqueda.

| Tema | Estado |
|---|---|
| Título y descripción | Todas las páginas tienen los dos. Descripciones de 137 a 158 caracteres (corte limpio). Las fichas **no tienen** `seoTitulo`/`seoDescripcion` cargados, así que usan el automático: «Visa Remera baby tee rayada de Isuwaya en Melang, Amarillo… talles S al 2XL. $ 9.360: 5% OFF con transferencia.» |
| H1 | Uno por página. Categorías: «Remeras · Hombre». Inicio: H1 oculto «Isuwaya: …». |
| Canónica, Open Graph, Twitter | En todas. `og:image` con ancho, alto y alt. `noindex` sólo en búsqueda (y carrito, checkout, cuenta, pedido por `robots`). |
| robots.txt / sitemap | Correctos. El sitemap trae 376 fotos y las fichas tienen `lastmod` real. |
| JSON-LD | Inicio: WebSite + OnlineStore. Categorías: BreadcrumbList + CollectionPage/ItemList. Fichas: BreadcrumbList + ProductGroup con una variante por talle y color, precio, rebaja, stock, envío y devolución. AggregateRating y Review salen cuando hay opiniones (hoy ninguna ficha auditada las tiene). Nosotros, contacto y locales con su tipo. |
| Imágenes | WebP en tres tamaños (`srcset`), `sizes`, `width`/`height` (sin saltos de diseño), `loading="lazy"` salvo la primera, `fetchPriority="high"` en la principal, alt con el nombre. Las únicas sin alt son el logo decorativo (`alt=""` es lo correcto). |
| Velocidad | Fuentes precargadas, ISR en fichas, componente `WebVitals`. Pero el HTML pesa **220 a 360 KB** por página (inicio 325 KB, `/hombre` 357 KB): ver hallazgo 8. |
| Medición | GA4 directo con `gtag` (ID `G-14NMWTZH4P`), consentimiento v2 y eventos `view_item_list`, `select_item`, `view_item`, `add_to_cart`, `remove_from_cart`, `view_cart`, `begin_checkout`, `add_shipping_info`, `add_payment_info`, `purchase`, `search`, `apply_coupon`, `view_promotion`, `select_promotion`, `share`, `generate_lead`. Meta Pixel + API de conversiones. No hay GTM (no hace falta). |
| Search Console | El dominio tiene el registro TXT `google-site-verification` en el DNS (verificación por dominio), por eso la página no trae la etiqueta `<meta>`. Es correcto. |
| Redirecciones | 301 desde la tienda anterior. `/nada-xyz` da 404 de verdad (no «soft 404»). |

## 2. Hallazgos priorizados

Impacto / esfuerzo: A = alto, M = medio, B = bajo.

| # | Hallazgo | Impacto | Esfuerzo | Estado |
|---|---|---|---|---|
| 1 | **`/hombre/chombas` está en el sitemap pero redirige (301) a `/hombres/chombas`, que da 404.** Es una fila de la tabla de redirecciones (dato de producción, no código). Google ve una dirección del sitemap que no indexa y un 404 al final. | A | B | **Del dueño** (ver 4.1) |
| 2 | Los títulos de ficha eran sólo el nombre. Nombres como «Mary» o «Moron Short» no decían ni «mujer» ni «hombre», que es lo que se busca. | A | B | Hecho |
| 3 | El título de los productos en el feed de Merchant Center era «nombre - color - talle», sin género. Merchant pesa el título para decidir con qué búsquedas mostrar el producto. | A | B | Hecho |
| 4 | `/nuevos`, `/destacados` y `/relampago` sin CollectionPage/ItemList (las categorías sí lo tienen). `/destacados` con descripción de 52 caracteres. | B | B | Hecho |
| 5 | Sólo 2 de 77 productos tienen descripción y ninguno composición. La ficha cae al automático (bien), pero el contenido propio de cada prenda es lo que más separa a una tienda de otra. | A | M | **Del dueño** (ver 4.6) |
| 6 | `/ofertas` da 404. Es una búsqueda frecuente en Argentina y la tienda tiene `/liquidacion` y `/relampago`. | M | B | **Del dueño**: cargar la redirección `/ofertas` → `/liquidacion` en Backoffice → Redirecciones (la tabla ya lo permite, sin tocar código). |
| 7 | `item_id` de los eventos de GA4 es el slug del producto y el feed de Merchant usa el SKU de la variante. Sin el mismo código, Google Ads no puede armar remarketing dinámico ni cruzar GA4 con Merchant. | M | M | **No se tocó**: cambiaría el historial de GA4 y de Meta. Decidirlo antes de empezar anuncios (ver 4.4). |
| 8 | HTML pesado (220-360 KB): las grillas traen 80-100 imágenes con `srcset` en el HTML y cada tarjeta repite clases. Con 3G/4G de Argentina pesa en LCP/INP. | M | A | **No se tocó** (tocaría diseño y componentes). Medirlo primero con PageSpeed/CrUX en Search Console antes de invertir. |
| 9 | `lastmod` de categorías y páginas fijas es «ahora» en cada generación: Google aprende a ignorarlo. Las fichas sí lo tienen real. | B | B | Pendiente (sin impacto grande). |
| 10 | `purchase` se dispara al abrir la página del pedido ya pagado. Una transferencia que se acredita cuando la persona ya cerró la página no se cuenta en GA4 (la API de conversiones de Meta sí la cubre). | M | M | Pendiente: se arregla mandando `purchase` por Measurement Protocol desde el worker, como ya se hace con Meta. Requiere una clave de API de GA4 (del dueño). |
| 11 | Sin `FAQPage`, `Organization` suelto en fichas ni `hreflang`. | — | — | No hacen falta: Google limita las FAQ a sitios de gobierno y salud; la marca ya sale en el inicio (OnlineStore); el sitio es sólo para Argentina. |

## 3. Lo que se implementó (Isu v1.63)

1. **Título de la ficha sin `seoTitulo`** (`tituloProducto` y `calificadorProducto`, `packages/shared/src/seo-datos.ts`). Se arma con el nombre y lo que le falta, sacado de las migas, sin inventar nada:
   - «Visa Remera baby tee rayada» → «Visa Remera baby tee rayada de mujer»
   - «Mary» (categoría Mujer › Pantalones y calzas) → «Mary: pantalones y calzas de mujer»
   - Si el nombre ya dice hombre, mujer, niño, unisex, etc., no se agrega nada. Si no entra en ~50 caracteres (60 con « · Isuwaya»), queda el nombre. Un `seoTitulo` cargado en el backoffice manda siempre. Se usa en `<title>`, Open Graph y Twitter (`apps/web/src/app/producto/[slug]/page.tsx`).
2. **Descripción de la ficha**: la composición, **si está cargada**, entra en la versión más completa («…, 100% algodón, de Isuwaya en Negro y Azul, talles S al M. Desde $ 32.000…»). Sin composición queda igual que antes. Nada se inventa.
3. **Feed de Merchant Center**: el título de cada fila lleva el género (y el tipo si el nombre no lo dice): «Moron Short de hombre - Negro - Talle S». Los `id` no cambian.
4. **CollectionPage + ItemList** en `/nuevos`, `/destacados` y `/relampago` (`PaginaColeccion.tsx`, reutilizando `TextoCategoria`, sin texto visible). Descripción de `/destacados` más completa.
5. Tests nuevos en `packages/shared/src/seo.test.ts` (título, género, tipo, sin categoría, no entra, composición, título del feed).

No cambia nada visual. Para que se vean en Google hay que desplegar y esperar el recrawl (días a semanas); se acelera con «Solicitar indexación» de las fichas principales.

## 4. Lo que SÓLO puede hacer el dueño

### 4.1 Arreglar `/hombre/chombas` (hoy)
1. Backoffice → **Redirecciones**, buscá `/hombre/chombas`.
2. Borrala (o cambiá el destino a `/hombre/remeras`; las chombas están en Hombre › Remeras desde Isu v1.53). Si la categoría «Chombas» ya no existe, además sacala del menú de categorías para que deje de ir al sitemap.
3. Verificá: `curl -sI https://www.isuwaya.com/hombre/chombas` tiene que dar 200 (o 301 a una página que dé 200).
4. Aprovechá y agregá `/ofertas` → `/liquidacion`.

### 4.2 Search Console (el dominio ya está verificado por DNS)
1. search.google.com/search-console → propiedad **isuwaya.com** (dominio). Si sólo existe la de prefijo URL, agregá la de dominio: la verificación DNS ya está.
2. *Sitemaps* → enviá `https://www.isuwaya.com/sitemap.xml` (tiene que figurar «Correcto» con unas 112 páginas descubiertas).
3. *Inspección de URLs* → inicio, `/hombre`, `/mujer`, `/ninos`, 2 o 3 fichas → *Solicitar indexación*.
4. *Páginas*: mirá «No indexadas» y los motivos (404, redirección, duplicada). Anotá las cifras de la primera semana.
5. *Experiencia → Core Web Vitals* y *Experiencia de página*: si no hay datos todavía (poco tráfico), usá PageSpeed Insights sobre inicio, una categoría y una ficha, en móvil.
6. *Ajustes → Usuarios*: sumá a quien administre los anuncios.

### 4.3 Merchant Center
1. merchants.google.com → *Productos → Fuentes de datos*: archivo programado `https://www.isuwaya.com/feed/google.xml`, una vez al día, Argentina, español, ARS (el feed trae ~2.330 filas).
2. *Configuración → Envío y devoluciones*: costo de envío y devoluciones a 30 días (los mismos de Ajustes). Sin esto los productos pueden quedar «limitados».
3. *Configuración → Sitio web*: verificar y reclamar `isuwaya.com` (aparece verificado si Search Console ya lo está).
4. *Diagnóstico*: revisá advertencias. Esperable: «Abyys Campera Hombre» sin color no sale hasta que se le cargue el color; el feed no manda GTIN (por eso `identifier_exists = no`).
5. *Crecimiento → Administrar programas*: activar **Fichas gratuitas** (y «Productos destacados en resultados» si aparece). Es gratis y no requiere Ads.
6. Después de un deploy: *Fuente de datos → Buscar ahora* para que tome los títulos nuevos.

### 4.4 GA4 y Google Ads
1. GA4 → *Administrar → Eventos*: marcar como **evento clave** `purchase`, `begin_checkout`, `add_to_cart`, `generate_lead`.
2. *Administrar → Vinculación de productos*: **Search Console**, **Merchant Center**, **Google Ads**.
3. *Informes → Monetización → Compras de e-commerce* debe mostrar productos y no «(not set)». Si el nombre del producto sale pero no la categoría, es el hallazgo 7 (no se manda `item_category`).
4. Probar en *DebugView* con una compra de prueba aceptando las cookies: se esperan `view_item` → `add_to_cart` → `begin_checkout` → `add_shipping_info` → `add_payment_info` → `purchase`.
5. **Antes de gastar en Google Ads**, decidí con quien te desarrolla: (a) usar el SKU de variante como `item_id` (cuesta perder la continuidad del histórico) y (b) mandar `purchase` desde el servidor (hallazgo 10). Con eso ya se puede usar **Performance Max con el feed** (la forma más simple de anunciar ropa) y remarketing dinámico.
6. Google Ads → *Herramientas → Conversiones*: importar `purchase` desde GA4 (no crear una etiqueta aparte, para no contar dos veces). Empezar con un presupuesto chico y campaña de Shopping/PMax sólo con los modelos con más stock.

### 4.5 Perfil de Empresa de Google (Maps)
1. business.google.com → un perfil por local (Flores, Ingeniero Budge) si atienden al público con dirección y horario.
2. Categoría principal: «Tienda de ropa». Sitio web: `https://www.isuwaya.com/locales`. Mismo nombre, dirección y teléfono que en el sitio (están en `/locales`).
3. Horarios reales, teléfono de WhatsApp, fotos del local y de las prendas. Fecha de apertura.
4. Pedir reseñas a quien compra en el local (link corto de reseña del perfil). Responderlas todas.
5. Verificación del perfil (video o código postal): sólo la puede hacer quien tiene el local.

### 4.6 Otras
- Cargar **descripción** (3 a 4 frases) y **composición** de las prendas, empezando por las más vendidas: Backoffice → Productos. Sólo con lo que se sabe (tela, calce, uso). Cada prenda con descripción propia pasa a usarla Google.
- Cargar **seoTitulo** sólo donde quieras forzar una frase distinta; el automático ya es razonable.
- Pedir enlaces: Instagram, y cualquier medio, proveedor o local que mencione la marca (no se compran enlaces).
- Anotar en `docs/` los datos de Search Console de las primeras semanas para decidir el contenido de la sección 5.

## 5. Plan de contenido y keywords para Argentina

**Importante:** no hay volúmenes de búsqueda en este documento. Las consultas de abajo son **hipótesis** armadas con el vocabulario de las categorías, los nombres de producto y el modo en que se habla de ropa en Argentina. Se validan con **Search Console → Rendimiento → Consultas** (impresiones y posición reales) y con el planificador de palabras clave de Google Ads (gratis con una cuenta). Quedarse con las que muestren impresiones; el resto se descarta.

Intención: **C** = compra (producto o categoría), **I** = informativa (guía), **L** = local, **M** = marca.

### Clusters por categoría y consultas objetivo (18)

| Cluster | Consulta hipótesis | Intención | Página que responde |
|---|---|---|---|
| Pantalones de hombre | pantalón baggy hombre | C | `/hombre/pantalones` (y fichas Terry, Legacy) |
| | pantalón de lino hombre | C | `/hombre/pantalones` |
| | pantalón sastrero hombre | C | ficha Quality / categoría |
| | pantalón cargo / corte chino hombre | C | ficha Bengalina / categoría |
| Remeras y musculosas | remeras oversize mujer | C | `/mujer/remeras-y-tops` |
| | remera térmica hombre | C | ficha Charly / categoría |
| | musculosa hombre | C | `/hombre/remeras` (ver nota) |
| | remeras rayadas | C | fichas Raya, Visa |
| | baby tee / crop top mujer | C | `/mujer/remeras-y-tops` |
| Buzos y camperas | buzo con capucha hombre | C | `/hombre/buzos-y-camperas` |
| | buzo oversize | C | ficha Comfort |
| | campera unisex | C | ficha Montero |
| Shorts y bermudas | bermuda de lino hombre | C | `/hombre/shorts-y-bermudas` |
| | short de lino mujer | C | ficha Soho, Ibiza |
| Calzas | calzas térmicas mujer / hombre | C | `/mujer/pantalones-y-calzas` |
| Niños | ropa de niños online / pantalón niño | C | `/ninos` |
| Packs y precios | ropa por mayor / pack de remeras | C | `/packs`, `/venta-por-mayor` |
| Marca y local | isuwaya / isuwaya flores | M / L | inicio, `/locales` |

Notas:
- «Musculosa» no tiene categoría propia (está dentro de Remeras). Si Search Console muestra impresiones, crear la subcategoría o una página `/hombre/musculosas` vale más que el texto.
- «Ropa por mayor» compite con mayoristas de Flores y La Salada: la ventaja es el catálogo con precios en WhatsApp (`/venta-por-mayor`).
- No competir por «ropa de mujer» o «ropa de hombre» genéricas en el corto plazo: las fichas y subcategorías (de cola más larga) rinden antes.

### Contenido a producir (en orden)
1. **Textos de categoría** de `docs/seo-categorias.md`: pegarlos si todavía no están en Backoffice → Categorías (es lo de mayor impacto, ya escrito).
2. **Descripciones de las 15 fichas más vendidas** (ver 4.6).
3. **Guías (I)**, 4 páginas cortas enlazadas desde categorías y fichas; hoy el sitio no tiene blog:
   - Cómo elegir tu talle (se apoya en las guías de talles que ya existen).
   - Cómo cuidar prendas de lino y rústico.
   - Qué pantalón va con qué remera (se apoya en `/outfits`).
   - Cómo comprar por mayor en Isuwaya.
   Escribirlas con lo que la marca realmente sabe; Google premia lo que no se encuentra en otro lado (medidas reales, fotos propias).
4. **Fotos reales con alt útil**: alt del tipo «Pantalón baggy de lino beige, hombre», no el nombre interno.
5. **Opiniones**: son las que activan las estrellas en Google. Hoy las fichas no las muestran en el JSON-LD; el pedido de opinión después de la entrega ya está armado (`/opinar`): insistir en que se use.

### Cómo medir (cada 2 semanas)
- Search Console: impresiones, clics y posición por consulta y por página; páginas con muchas impresiones y CTR bajo = título a mejorar.
- Merchant Center: productos aprobados y clics gratuitos.
- GA4: ingresos por canal («Búsqueda orgánica», «Shopping gratuito») y embudo `view_item` → `purchase`.
- Perfil de Empresa: llamadas, rutas y visitas al sitio.

## 6. Qué NO se pudo verificar
- Search Console, Merchant Center, GA4 y Ads: no hay acceso desde acá. Todo lo de la sección 4 es para hacer en cada pantalla.
- Que los eventos de GA4 lleguen: se revisó el código, no DebugView.
- Core Web Vitals reales (CrUX) y PageSpeed: no se midieron.
- El efecto en Google de los títulos nuevos: depende del recrawl.
- El contenido de la fila de redirección de `/hombre/chombas`: se dedujo por la respuesta HTTP (301 a `/hombres/chombas` → 404), no se leyó la base de producción.
