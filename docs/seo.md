# SEO y posicionamiento en Google

Qué hace la tienda sola, qué se edita desde el backoffice y qué hay que
hacer una vez (cuentas de Google, día del cambio de dominio).

## Lo que la tienda hace sola

| Qué | Dónde | Para qué |
|---|---|---|
| **Redirecciones 301 de la tienda anterior** | `apps/web/src/proxy.ts`, tabla `tienda.redirecciones` (migración 0012) | Las 70 direcciones de www.isuwaya.com (Jumpseller) mandan a su página nueva. Google pasa el posicionamiento a la tienda nueva en vez de ver errores 404. |
| Ficha de producto → **ProductGroup** | `packages/shared/src/seo-datos.ts` | Una variante por talle y color, cada una con su precio, precio tachado si hay rebaja, stock, foto del color y dirección (`?color=`). Google puede mostrar «en 4 colores» y el precio del talle buscado. |
| Envío y devoluciones en cada oferta | ídem | Google muestra «Envío $X · Devolución gratis 30 días» junto al precio. El costo sale de Ajustes; si la prenda llega al «envío gratis desde», figura gratis. |
| Migas de pan | `components/Migas.tsx` | Google muestra «Isuwaya › Hombre › Pantalones» en vez de la dirección. |
| Inicio: **WebSite** + **OnlineStore** | `app/page.tsx` | El nombre «Isuwaya» en los resultados, el logo, Instagram, el contacto y la política de devoluciones. |
| Locales: **ClothingStore** por local | `app/locales/page.tsx` | Dirección y horario. El horario se interpreta del texto de Ajustes («Lunes a viernes de 8 a 14 h»); si no lo entiende, no lo publica. |
| Categorías: **CollectionPage** con la lista de productos | `components/TextoCategoria.tsx` | |
| **Títulos y descripciones automáticos** | `descripcionProducto` / `descripcionCategoria` | Ficha: «Abel Pantalón Hombre de Isuwaya en Negro, Topo y Azul, talles S al 3XL. $ 40.000: 20% OFF con transferencia, 3 cuotas sin interés.» Categoría: «35 modelos de ropa de hombre de Isuwaya desde $ 18.000, talles XS al 5XL…». Nunca se cortan a mitad de frase. |
| **Sitemap con fotos** | `/sitemap.xml` | Hasta 5 fotos por producto: Google Imágenes las encuentra antes. |
| **Feed de Google Shopping** | `/feed/google.xml` | Una fila por talle y color, con todo lo que pide Merchant Center para ropa: color, talle, género, edad, oferta, envío. |
| Canónica en cada página, `noindex` en carrito, checkout, cuenta, pedido y búsqueda | | Evita duplicados. |
| Verificación de Search Console y Bing | `GOOGLE_SITE_VERIFICATION`, `BING_SITE_VERIFICATION` (web) | Sólo si no se verifica por DNS. |

## Lo que se edita en el backoffice

- **Categorías → Editar:**
  - **Título para Google**, hasta unos 60 caracteres. Sin completar sale «Ropa de hombre · Isuwaya».
  - **Descripción para Google**, hasta unos 155. Sin completar se arma sola.
  - **Texto de la categoría**: 2 o 3 párrafos abajo de las prendas. Es lo que más ayuda a una categoría a posicionarse. Contá qué hay, de qué tela, los talles, los envíos y los locales. Escribilo para la gente, no repitas palabras.
  - Hay una vista previa de cómo se ve en Google.
- **Productos:** título y descripción para Google de cada ficha. Si la descripción de la prenda tiene más de 80 caracteres, Google usa esa.
- **Redirecciones:**
  - Las direcciones viejas, con su estado:
    - **A la ficha**: el producto está publicado.
    - **Producto oculto: va al plan B**: el producto existe pero está oculto.
    - **SKU sin producto**: el SKU todavía no está en la tienda.
  - Cuando publicás un producto que estaba oculto, su dirección vieja pasa sola a la ficha.
  - Se pueden agregar direcciones, por ejemplo un link viejo que circula en Instagram. Se usan en la tienda al instante.
  - El destino es siempre una página de esta tienda. Si pegás una dirección completa de otro sitio, se guarda sólo la ruta.

## Una vez: cuentas de Google

1. **Google Search Console** (search.google.com/search-console):
   - Agregá la propiedad de **dominio** (`isuwaya.com`) y verificala por **DNS**: un registro TXT en Cloudflare.
   - Si ya tenés la propiedad de la tienda vieja, es la misma: se conserva el historial.
   - En *Sitemaps*, enviá `https://<dominio>/sitemap.xml`.
2. **Google Merchant Center** (merchants.google.com), para aparecer gratis en la pestaña *Shopping*:
   - *Productos → Fuentes de datos → Agregar → Archivo programado*: `https://<dominio>/feed/google.xml`, una vez por día.
   - País Argentina, idioma español, moneda ARS.
   - Configurá el envío (o usá el del feed) y la política de devoluciones (30 días).
   - Vinculá Search Console para que reclame el sitio.
3. **Perfil de Empresa de Google** (business.google.com), uno por local:
   - Nombre, dirección, horario, fotos, teléfono de WhatsApp y el sitio `https://<dominio>/locales`.
   - Es lo que aparece en Maps y en «isuwaya flores».
4. **Bing Webmaster Tools** (bing.com/webmasters): *Importar desde Google Search Console*. Un clic.

## El día del cambio de dominio (Jumpseller → tienda nueva)

> **Clave:** que la tienda nueva quede en **el mismo dominio** (`www.isuwaya.com`). Así las redirecciones hacen su trabajo y Google no pierde nada. Si va a otro dominio, también hay que redirigir el dominio viejo entero al nuevo (Cloudflare → *Redirect Rules*) y avisar en Search Console (*Cambio de dirección*).

**Antes** (con la tienda vieja todavía en el aire):

1. En la consola del worker: `node apps/worker/dist/seo/cli.js https://www.isuwaya.com`. Muestra si hay direcciones nuevas desde el 30/09. Con `--aplicar` las agrega.
2. Si el botón **Mayorista** apunta a `www.isuwaya.com` (`MAYORISTA_URL`), cambialo a la dirección del sitio mayorista. Si no, después del cambio el botón lleva a la misma tienda.

**Al cambiar:**

1. En Railway, servicio web:
   - `NEXT_PUBLIC_SITE_URL=https://www.isuwaya.com`
   - Redeploy (la variable se graba al compilar).
2. En Cloudflare, el DNS de `www` va al servicio web. Si `isuwaya.com` sin www no apunta a la tienda, agregá una regla que lo redirija a `www`.

**Después:**

1. Desde tu compu: `pnpm seo https://www.isuwaya.com --viejas <archivo con las direcciones viejas>`. Tiene que terminar en «Todo bien para Google». El archivo es `docs/direcciones-jumpseller.txt` o tu propia lista.
2. En Search Console:
   - Enviá el sitemap.
   - *Inspección de URLs* de la home y de 2 o 3 fichas → *Solicitar indexación*.
3. Durante las semanas siguientes, mirá en Search Console:
   - *Páginas → No encontrada (404)*: las direcciones viejas que falten se agregan en Backoffice → Redirecciones.
   - *Shopping → Fragmentos de producto*: errores en los datos de producto.

Mantené las redirecciones **al menos un año**. Google las necesita mientras siga habiendo enlaces a la tienda vieja.

## Cómo se ve Isuwaya al buscarla en Google (etapa 13)

Al buscar «Isuwaya», el primer resultado es el inicio, como el de Deliver: la marca, el título, la frase de debajo y, más abajo, accesos a las páginas principales.

```
Isuwaya · https://www.isuwaya.com.ar
Isuwaya · Ropa urbana y casual para todos tus días
Isuwaya — Tienda online de ropa que fabricamos con talles reales, para mujer, hombre y niños — Envíos a todo el país y 20% OFF con transferencia.

  Mujer             Explorá toda la ropa de mujer Isuwaya: remeras y tops, pantalones y calzas…
  Hombre            Explorá toda la ropa de hombre Isuwaya: remeras, buzos…
  Contacto          ¿Necesitás ayuda? WhatsApp +54 9 11 … · Email … · Locales en Flores y La Salada…
  Quiénes somos     Somos Isuwaya: diseñamos y fabricamos ropa urbana y casual… desde hace más de 10 años…
  Venta por mayor   ¿Tenés un local o revendés ropa? Hacé tu pedido en la tienda mayorista…
  Nuestros locales  Locales de Isuwaya en …: probate las prendas y retirá gratis…
```

**Lo que hace la tienda:**
- **Inicio:**
  - el título es «Isuwaya · Ropa urbana y casual para todos tus días»;
  - la frase de debajo se arma sola con las categorías y las condiciones de Ajustes (envíos, % por transferencia, cuotas), en lo que entra en Google;
  - con los datos de la marca: logo, Instagram, contacto, el lema, la política de cambios y la tienda mayorista.
- **Categorías de arriba:** «Explorá toda la ropa de mujer Isuwaya: …», con sus subcategorías de verdad. Si en Categorías se carga una «Descripción para Google», se usa esa.
- **Páginas nuevas:**
  - **Quiénes somos** (`/nosotros`): lo que la marca ya cuenta en el inicio;
  - **Contacto** (`/contacto`): WhatsApp, email y locales, sacados de Ajustes;
  - **Venta por mayor** (`/venta-por-mayor`): el botón «Hacer mi pedido mayorista» lleva a la tienda mayorista (pasa por `/mayorista`, que redirige a `MAYORISTA_URL`).
- **Enlaces y sitemap:**
  - las tres páginas están enlazadas en el pie de todas las páginas y en el menú del celular;
  - están en el sitemap, con su título, su descripción y su canónica.
  - El botón «Pedido mayorista» de arriba sigue yendo directo a la tienda mayorista.

**Lo que no depende de la tienda:**
- **Los accesos de debajo** («sitelinks») los elige Google solo, cuando el sitio tiene buen tráfico y una estructura clara. No se pueden forzar ni elegir.
  - Lo que se puede hacer es que las páginas estén bien armadas y enlazadas en todo el sitio. Eso ya está hecho.
  - Suelen aparecer a las pocas semanas de que Google indexa el dominio nuevo.
- **El panel de la derecha** («En línea desde…», descripción, redes) sale del **Perfil de Empresa de Google** (business.google.com). Para tenerlo:
  - crear el perfil con el nombre, la categoría «Tienda de ropa», el sitio web, la descripción y la **fecha de apertura**;
  - con los locales, un perfil por local (Vía Flores, La Salada), que además aparecen en Google Maps.
- **Para que Google vea todo antes:** en **Search Console**, mandar el sitemap y pedir «Solicitar indexación» del inicio, `/nosotros`, `/contacto` y `/venta-por-mayor`.
- **Para revisarlo:** `pnpm seo https://<dominio>` muestra, en «La marca en Google», el título y la frase del inicio, y cada acceso con su título y descripción.

## Chequeo

```bash
pnpm seo https://www.isuwaya.com                          # robots, sitemap, 25 páginas, datos estructurados, feed
pnpm seo https://www.isuwaya.com --viejas https://www.isuwaya.com.ar   # además: cada dirección del sitemap de la tienda anterior
```

No cambia nada. Para cada problema dice qué tocar. Para revisar una página puntual en Google: https://search.google.com/test/rich-results.
