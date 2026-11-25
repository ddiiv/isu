# Eventos de temporada (migración 0032)

Navidad hoy; Cupido, Halloween, etc. después. Un **evento** agrupa descuentos, cupones/promociones y banners:
esas filas valen sólo mientras el evento esté **vigente** (prendido y dentro de sus fechas opcionales). Al apagarlo,
la tienda vuelve a la normalidad sin tocar cada fila. Lo que no está atado a ningún evento funciona como siempre.

## Modelo
- `tienda.eventos` (`clave`, `nombre`, `activo`, `desde`, `hasta`). Un solo evento activo a la vez (índice parcial);
  prender uno apaga el otro desde la API. La migración deja `navidad` apagada.
- `evento_id` (nullable) en `tienda.descuentos`, `tienda.cupones` y `tienda.banners`.
- `tienda.evento_vigente(id)`: la única definición de «vigente». Las consultas hacen
  `(x.evento_id IS NULL OR tienda.evento_vigente(x.evento_id))`: `lib/descuentos.ts`, `NO_TERMINADO_DE_P`
  (`productos/consultas.ts`), `lib/cupones.ts` (promociones y cupón con código), la revalidación del cupón al
  crear el pedido (`pedidos/servicio.ts`), `portada/banners.ts` y el mail de carritos abandonados (worker).
- Los relámpagos no se atan a eventos (ya duran 48 h y tienen su pantalla).

## Backoffice (todas las rutas piden sesión con doble factor; prender/atar, rol operador)
- `GET /v1/admin/eventos` — eventos con cuántas filas tienen atadas, y todo lo que se puede atar.
- `PUT /v1/admin/eventos/:clave` `{ activo, desde, hasta }` — prende, apaga o fecha; audita.
- `PUT /v1/admin/eventos/:clave/vinculos` `{ descuentos, cupones, banners }` — la lista completa de lo atado.
- Pantalla **Promociones → Eventos**.

## Tienda
- `GET /v1/config` trae `evento: { clave, nombre, hasta } | null` (el vigente). La web usará la clave para el tema
  (Parte 3); un evento nuevo es una fila en `tienda.eventos` y un tema en la web.

## Límites conocidos
- Cuando un evento llega a su fecha de inicio o fin sin que nadie lo toque, los precios de la API cambian al instante,
  pero las páginas ya generadas y la caché de Cloudflare (hasta 5 min en `/v1/config`) se actualizan recién al vencer.
  Prender o apagar desde el backoffice invalida todo en el momento.

# Promos de Navidad (migración 0033)

- **Tope por evento:** `eventos.descuento_max` (Navidad = 25). Un trigger de la base rechaza un descuento atado al evento
  que lo pase (al atarlo o al subirle el %). La API lo devuelve como `400 tope_evento`.
- **Cupón tipo `segunda_unidad`** (`valor` = % de la 2da unidad): entre cualquier prenda elegible del carrito se arman pares de
  a dos, de la más cara a la más barata, y la más barata de cada par lleva el %. Sirve para promos automáticas y para la ruleta.
- **`cupones.acumula`:** `true` = como siempre (va encima de la rebaja de la prenda). `false` = NO se suma: en cada prenda rige
  el mejor precio para el cliente (el cupón se calcula sobre el precio de lista y sólo cuenta lo que mejora la rebaja). Vale para
  `porcentaje` y `segunda_unidad`. Las dos promos de Navidad usan `acumula = false`.
- **Cargadas y atadas a Navidad (inactivas hasta prenderla):** «10% OFF en compras de más de $120.000» (mínimo $120.001, mirado
  sobre el total ya rebajado) y «2da unidad al 50%». Entre las promos y el cupón escrito sigue rigiendo «uno por compra, el que más descuenta».
- El piso mayorista sigue valiendo para todo: ninguna prenda baja de su mayorista, y sin mayorista cargado no recibe descuento.
- `PUT /v1/admin/eventos/:clave/vinculos`: cada lista (`descuentos`, `cupones`, `banners`) es la completa de ese tipo; la que no se manda queda como está.
- Lógica en `apps/api/src/lib/cupones.ts` (`aplicarCupon`); casos combinados en `apps/api/test/navidad-cupones.test.ts`.

# Look navideño y SEO (migraciones 0034 y 0035)

- **Tema:** el layout de la web pone `data-evento="<clave>"` en `<html>` y le pasa la clave al encabezado. Con `navidad` vigente se ve:
  el gorrito sobre el logo (`GorroNavidad`: SVG + CSS, sin imagen nueva ni JavaScript), una guirnalda de luces bajo el encabezado y una
  franja de bastón en la barra de arriba. Sólo se renderiza con el evento vigente (apagado, no hay ni una línea de HTML extra) y usa
  los colores de la marca (rojo oferta, verde ahorro, dorado de las estrellas). Con «menos movimiento» (`prefers-reduced-motion`)
  queda quieto. Prender o apagar desde el backoffice regenera las páginas (etiqueta «catalogo»).
- **Banners (0034):** cuatro, atados a Navidad, con orden -40 a -37 (primeros del carrusel): «Navidad en Isuwaya», «2da unidad al 50% OFF»,
  «10% OFF en compras de más de $120.000» y «{cuotas} cuotas sin interés» (usa {cuotas} y {descuento} de Ajustes; si falta uno, no sale).
  Se editan desde Portada. Los botones llevan a Mujer, Hombre y Nuevos: la Parte 4 puede apuntarlos a la sección nueva.
- **Google (0035 + `seo-datos.ts`):**
  - 0035 carga el título y el texto de las 11 categorías (los de `docs/seo-categorias.md`), sólo donde estaban vacíos. `seo_descripcion`
    queda vacía a propósito: la descripción automática trae el precio «desde», los talles y las condiciones de hoy.
  - Con un evento vigente, `ContextoSeo.evento` suma «ofertas y regalos de Navidad» a las descripciones de inicio y categorías,
    «· Navidad» al título (sólo si entra en ~60 caracteres con « · Isuwaya») y una frase al final de Nuevos, Destacados y Packs.
    Las fichas de producto no lo dicen (no se sabe si esa prenda está en oferta).
  - Las páginas legales (cambios y devoluciones, términos, privacidad, arrepentimiento) ahora tienen descripción.

# Sección «Amigo invisible» (Parte 4, migración 0036)

- **Página:** `/amigo-invisible` (`apps/web/src/app/amigo-invisible/page.tsx`): las prendas con un descuento atado al evento vigente
  (colección `evento` de `GET /v1/productos`, ver `EN_EVENTO` en `productos/consultas.ts`), las promos del evento y las cuotas.
  Sin datos de clientes: es pública como cualquier colección.
- **Sólo con Navidad vigente:** apagada, la dirección da 404 y nada la enlaza. El menú (escritorio y celular), el pie, el sitemap y los
  botones de los banners de Navidad la ofrecen según `config.evento`. `GET /v1/config` ahora trae `evento.promos` (nombres de las
  promociones automáticas vigentes del evento).
- **Qué prendas entran:** las que tienen un descuento vigente atado al evento (Eventos → «Descuentos»). Atá ahí los descuentos de hasta 25 %
  por producto o categoría; la sección se arma sola. Sin ningún descuento atado, la página muestra el aviso de sección vacía.
- **Mi presupuesto:** arriba de la grilla salen «Hasta $15.000 / $25.000 / $40.000 / $60.000» (`PRESUPUESTOS` en la página; sólo los que filtran algo: dejan al menos una prenda y no las dejan a todas). Filtra por el precio que se paga hoy, en el navegador (instantáneo, la página sigue estática), y queda en la URL (`?hasta=15000`) para compartir; un tope que no es de la lista se ignora. Lo hace `Grilla` con la propiedad `presupuestos`, así que sirve para cualquier otra colección.
- **0036:** los banners «Navidad en Isuwaya» y «2da unidad al 50% OFF» pasan a llevar a la sección (sólo si no se editaron).

# Ruleta de descuentos (Parte 5, migración 0037)

- **Cuándo aparece:** sola, **una vez por semana por cuenta**, mientras haya un evento vigente (`con_eventos`), y también cuando se
  prende **a mano** desde el backoffice (`manual`). Backoffice → Promociones → **Ruleta**: esos dos interruptores, cada cuántos días
  puede girar una cuenta (7), cuánto dura el cupón (30) y los premios con su peso. El primer giro es apenas se registra.
- **Qué pasa en el servidor (`apps/api/src/lib/ruleta.ts`):** valida que esté abierta y que pasaron `cada_dias` desde el último giro,
  sortea con `crypto.randomInt` (ponderado por el peso; el navegador sólo dibuja la rueda y la frena donde dijo la API), guarda el giro y
  crea el cupón, todo en una transacción con un candado por cuenta (dos giros a la vez no pasan los dos).
- **El cupón es personal:** `cupones.cliente_id`, con código `RULETA-XXXXXXXX`, un solo uso, y los de porcentaje/2da unidad con
  `acumula = false` (rige el mejor precio, no se suma a la rebaja). Sólo lo aplica la cuenta que lo ganó: a otra cuenta le dice «Ese cupón
  no existe» y a un invitado «Ingresá a tu cuenta». Si salió de un evento queda atado a él: vale mientras el evento siga vigente y
  nunca más allá de `vence_dias`. Entre un cupón y las promos del evento sigue rigiendo «uno por compra, el que más descuenta».
- **Sin cuenta (0039):** también se puede girar. El navegador guarda un identificador al azar en localStorage (`lib/dispositivo.ts`) y manda sólo eso; la API
  guarda su hash y decide: un giro por dispositivo y semana, y como localStorage se puede borrar, un tope de 3 giros por conexión (IP, guardada sólo como
  hash con sal) en esa ventana. El cupón de un invitado es un código de un solo uso que ve ese dispositivo (`GET /v1/ruleta?d=…`, `POST /v1/ruleta/girar`); no
  es de una cuenta. Una cuenta con sesión gira por su cuenta (no la afecta el tope de la conexión). Límite conocido: quien usa varias conexiones y borra
  localStorage puede juntar algunos giros más; el costo es poco (cupones chicos de un solo uso) y el tope por conexión lo acota.
- **Quién ve qué:** `GET /v1/cuenta/ruleta` y `POST /v1/cuenta/ruleta/girar` piden la sesión de la cuenta y sólo trabajan con SU cuenta (no
  reciben ningún id). El backoffice (`/v1/admin/ruleta…`) pide sesión con doble factor y rol; muestra sólo totales por premio, nunca qué
  cuenta ganó qué.
- **Premios de arranque (pesos sobre 100):** 5% OFF 30 · 10% OFF 18 · 15% OFF 8 · 20% OFF 3 · $3.000 OFF desde $25.000 12 · envío gratis 10 ·
  2da unidad al 50% 6 · «Seguís participando» 8 · «Casi ganás» 5.
- **Web:** tarjeta «Ruleta» en Mi cuenta (`components/cuenta/Ruleta.tsx`), con «Mis cupones» y botón copiar. Con «menos movimiento» la
  rueda salta al resultado sin girar.

# Cupones visibles en la tienda (migración 0038)

Tres clases de cupón:
- **Con código secreto:** se escribe en el carrito (como siempre). Es el cupón común, sin tildar «Mostrarlo en la tienda».
- **Visibles:** en Backoffice → Cupones, «Mostrarlo en la tienda» (con un texto opcional). Salen en `/cupones` y como botones en el carrito
  («Cupones disponibles», que se aplican con un toque), siempre que estén vigentes. Sólo cupones con código: las promociones automáticas
  salen solas en `/cupones`.
- **De la ruleta:** personales (los de una cuenta) o de invitado. Se ven en Mi cuenta y en el carrito de quien los ganó; nunca en `/cupones` ni en el
  backoffice (la lista de Cupones no los incluye). Cuando hay una ruleta abierta, `/cupones` muestra la rueda para girar con o sin cuenta.
- API pública: `GET /v1/cupones` (visibles, promos vigentes y si hay ruleta abierta; sin datos de clientes ni cupones secretos). Hay una caché corta: un
  cambio de visibilidad tarda hasta un minuto en verse.

# Página /ruleta y «Cupones disponibles» del carrito

- **`/ruleta`:** la rueda (con o sin cuenta), cómo funciona (cada cuántos días se gira y cuánto dura el cupón salen de la configuración) y enlaces a
  `/cupones` y Mi cuenta. Siempre existe, así no hay enlaces rotos: sin ruleta abierta lo dice y no se indexa. Se enlaza en el menú, el pie y el sitemap
  sólo mientras haya una abierta (`config.hayRuleta`; prender o apagar la ruleta en el backoffice regenera las páginas).
- **«Cupones disponibles»** (`PanelCupones` en `LineasCarrito.tsx`, sale en el cajón del carrito, la página del carrito y el checkout): cada cupón (los visibles y los
  que ganó ese cliente: cuenta o navegador) evaluado contra ESE carrito, como en las tiendas grandes: «Mejor opción», «Ahorrás $X», «Te faltan $Y» o por qué no aplica,
  y un botón «Aplicar». `POST /v1/cupones/evaluar` cotiza el mismo carrito con cada cupón (hasta 8), así que lo que dice es lo que de verdad pasaría; rige igual uno por
  compra. Se vuelve a pedir cuando cambia el carrito. El cliente elige: no se aplica solo.
- Sólo se evalúan los cupones de quien pregunta: la sesión de la cuenta o el identificador del navegador; nunca los de otro, y no se devuelve ningún dato de clientes.
