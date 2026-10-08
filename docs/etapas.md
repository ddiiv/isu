# Etapas

Cada etapa cierra con dos chequeos obligatorios: **QA** (pantallas, flujos, casos borde) y **Hacker** (seguridad, estrés, permisos). No se pasa a la siguiente con fallas.

| Etapa | Contenido | Estado |
|---|---|---|
| 0 | Monorepo, base (esquema `tienda`), API endurecida, tienda (diseño, legales, SEO, GA4, WhatsApp), backoffice y worker base, CI, infraestructura | **Cerrada** (abajo) |
| 1 | Patch en Stocker (origen `tienda`, catálogo, stock, NOTIFY), sincronización en tiempo real, categorías ↔ productos, grilla con filtros, ficha con selector de color por foto, importador de fotos (5 por color), búsqueda, 404 con salida, eventos GA4 de e-commerce | **Cerrada** (abajo) |
| 2 | Registro/login, carrito lateral (envío gratis, mínimo de compra), checkout, Mercado Pago (tarjeta, cuotas, Pago Fácil), transferencia con API de registro de pago, pago en el local, pedidos a la cola de Stocker, botón de arrepentimiento con código de trámite | **Cerrada** (abajo) |
| 3 | Backoffice: login con 2FA, productos y fotos en vista masiva, categorías, descuentos masivos, clientes sincronizados con Stocker, monto mínimo y ajustes, pedidos y registro de pagos. Además: Destacados y Nuevos (casillas en el producto, secciones y "Nuevos" en la barra), guías de talles tipo Mercado Libre con editor, "Armá tu outfit" y botón Mayorista (`MAYORISTA_URL`) | **Cerrada** (abajo) |
| 4 | Envíos: Correo Argentino, Andreani, OCA, Mercado Envíos, Cabify Logistics (envíos en el día), envíos del día, seguimiento con avisos por email y WhatsApp | **Cerrada** (abajo) · transportes probados contra simuladores: falta homologar con credenciales reales |
| 5 | Chatbot de preguntas frecuentes, ajustes finales, prueba de carga final, salida a producción | **Cerrada** (abajo) · la salida es con [`salida-produccion.md`](salida-produccion.md) |
| 6 | Importación del catálogo del sitio mayorista (fotos por color, foto principal, categorías, colores) y cupones de descuento / promociones por monto | **Cerrada** (abajo) |
| 7 | SEO y posicionamiento: redirecciones 301 de la tienda anterior (Jumpseller), datos estructurados de producto con variantes, textos de categoría, títulos y descripciones automáticos, sitemap con fotos, feed de Google Shopping, chequeo `pnpm seo` | **Cerrada** (abajo) · guía en [`seo.md`](seo.md) |
| 8 | Inicio completo (carrusel de portada, packs, pestañas por categoría, números de la marca, opiniones al final), packs de 2 a 5 unidades con su dirección `pack-xN`, descripción y composición en la ficha, reseñas de compras verificadas con moderación | **Cerrada** (abajo) · guía en [`inicio-packs-resenas.md`](inicio-packs-resenas.md) |
| 9 | Packs de 2 a 10 (configurable) armados sobre la prenda padre con el stock de cada variante, sección Packs y Liquidación en la barra divididas por Hombre / Mujer / Niños, menú del celular con subcategorías y 1–2 fotos por categoría, barra de envío gratis en la ficha | **Cerrada** (abajo) · guía en [`packs-liquidacion-menu.md`](packs-liquidacion-menu.md) |
| 10 | El pack va aparte en el carrito (como Deliver), carrito con el precio por transferencia y por tarjeta/Mercado Pago, checkout de una página, «Comprar ahora» y WhatsApp sólo sin stock, eliminar productos, backoffice rediseñado, guías de talles con Excel (y las 40 de la fábrica), sólo productos padre desde Stocker | **Cerrada** (abajo) · guía en [`carrito-checkout-backoffice.md`](carrito-checkout-backoffice.md) |
| 11 | Direcciones en el checkout: sugerencias de calle con Google Places (la clave sólo en el servidor, topes por día dentro del uso gratis) y revisión de calle y altura con Georef (gratis); aviso en el carrito cuando una variante ya está dentro de un pack y no quedan para sumarla suelta | **Cerrada** (abajo) · guía en [`direcciones-checkout.md`](direcciones-checkout.md) |
| 12 | Revisión pantalla por pantalla (tienda y backoffice, compu y celular); direcciones sin ids (fotos, banners, productos y guías del backoffice, comprobantes); banners interactivos (título, texto, etiqueta, hasta 2 botones, la tarjeta de un producto elegido o automático, colores, datos de Ajustes) con editor y vista previa, y 7 banners sugeridos armados con lo que dice la tienda | **Cerrada** (abajo) · guía en [`banners-y-direcciones.md`](banners-y-direcciones.md) |

## Etapa 12 · resultados del cierre (08/10/2026)

**Qué entró** (cómo se usa en [`banners-y-direcciones.md`](banners-y-direcciones.md))
- **Revisión pantalla por pantalla**, en compu y celular, tienda y backoffice:
  - con `pnpm revisar:pantallas` (nuevo, guarda una captura de cada pantalla);
  - busca errores de JavaScript, pedidos que fallan, cosas que se salen de costado, imágenes rotas, textos «undefined» o «NaN», botones y campos sin nombre y links rotos.
  - Lo encontrado se arregló: una nota interna sin etiqueta, precios que se partían, miniaturas rotas en el backoffice y la etiqueta «20% OFF» del checkout.
- **Direcciones sin ids:**
  - fotos y banners en una carpeta al azar;
  - productos y guías de talles del backoffice por su nombre (un número viejo pasa solo al nombre);
  - comprobantes por su número dentro del pedido;
  - `pnpm fotos:sin-ids` para pasar las fotos que ya estaban.
- **Banners interactivos:**
  - título, texto, etiqueta, hasta 2 botones a páginas de la tienda, la tarjeta de un producto (elegido o automático) y 7 colores de fondo;
  - los datos de Ajustes en los textos (`{descuento}`, `{cuotas}`, `{envioGratis}`, `{packsHasta}`, `{packsMinimo}`, `{packsMaximo}`);
  - editor con vista previa en compu y celular, y el estado de cada banner («No sale: …»).
- **7 banners sugeridos** armados con lo que dice la tienda (migración 0019), y «Agregar banners sugeridos» para recuperarlos.

**QA**
- Pruebas unitarias: **537/537**, 21 más:
  - banners: datos de Ajustes, botones, links sólo propios, producto por slug, el que no sale y por qué, sacar la foto, sugeridos iguales a la migración;
  - slugs de guías (acentos, repetidos, «nueva»), producto por slug, comprobante por número;
  - `fotos:sin-ids` y el repaso al regenerar páginas.
- Pruebas en navegador: **152/152**, 8 más (compu y celular):
  - el inicio con banners de texto y foto, sus botones, la tarjeta del producto, y que nada se salga de costado;
  - el editor arma un banner con dato, botón, producto y color, se ve en la tienda y se borra;
  - productos y guías con su nombre en la dirección.
- Revisión de pantallas: **sin hallazgos**.
- Hallazgos corregidos antes de entregar:
  - **Una página podía quedar vieja hasta 5 minutos** después de un cambio en el backoffice. Pasaba si se estaba regenerando justo en ese momento: carrera de ISR. Ahora hay un segundo aviso unos segundos después (repaso).
  - Las pruebas de la base dejaban productos de prueba en la base que después usa el e2e.
  - El velo de los banners con foto, en el celular, se aclaraba de un lado y el texto se leía mal.

**Hacker**
- Auditoría: **405/405**, 16 chequeos más (§ 7l y § 7f ampliada, detalle en `seguridad.md`).
- Decisiones:
  - los links de los banners son sólo de esta tienda, con tres llaves: shared, API y el dibujo;
  - el producto va por slug, nunca por id;
  - validación estricta;
  - permisos de operador para editar;
  - las direcciones públicas de fotos no dicen qué id tiene un producto ni cuántos hay.

## Etapa 11 · resultados del cierre (06/10/2026)

**Qué entró** (cómo se usa en [`direcciones-checkout.md`](direcciones-checkout.md))
- **Sugerencias de calle con Google Places:**
  - mientras se escribe la calle, hasta 5 direcciones de Argentina; elegir una completa calle, número, código postal, localidad (en CABA, el barrio) y provincia;
  - la clave sólo en el servidor (`GOOGLE_MAPS_API_KEY`, opcional);
  - sesiones de Google por dirección y sólo `addressComponents`, lo más barato;
  - topes por día en Ajustes (de fábrica 300 y 300: no se pasa del uso gratis).
- **Revisión con Georef (gratis):**
  - con calle, número y provincia: «✓ Encontramos tu dirección», «¿Tu dirección es …?» con la oficial, o aviso de altura o calle que no existe;
  - nunca frena la compra.
- **Ajustes → «Direcciones en el checkout»:** prender o apagar cada ayuda, los topes y el uso de hoy.
- **Aviso del carrito:**
  - si las que quedan de una variante ya están en el carrito (dentro de un pack o sueltas), sumarla no la agrega y explica por qué, con «Ver mi carrito» y «Elegir otro talle o color»;
  - en la ficha («Agregar» y «Comprar ahora»), en la página del pack y en el «+» del carrito;
  - ventana al centro en la compu y la notebook, hoja desde abajo en el celular.
- **El «+» del carrito** descuenta lo que la misma variante lleva en las otras líneas (`disponible` de la cotización).
- **Links de los locales:**
  - en Ajustes, «Link del local» (Google Maps u otro): sólo https, se completa el `https://` y se puede probar;
  - en la tienda, el nombre del local y «Cómo llegar ↗» llevan ahí: Locales, checkout (retiro), ficha, página del pedido y mails.
- **Migración 0018** (el ajuste `direcciones`), el simulador `pnpm demo:direcciones` y la política de privacidad con Google Maps y Georef.

**QA**
- Pruebas unitarias: **510/510**, 21 más.
  - Funciones: código postal, provincias de Google y Georef, componentes de Google (barrio en CABA, nunca la comuna), calles escritas distinto, evaluación de Georef.
  - Clientes de Google y Georef contra simuladores: región, sesión, máscara de campos, códigos de provincia, ids raros descartados, clave mala, caído y lento.
  - Rutas: configuración pública sin la clave, validación, apagado en Ajustes, tope del día, Google o Georef caídos, caché de Georef y backoffice sin sesión.
  - Carrito: lo que queda por línea descuenta las otras.
- Pruebas en navegador: **141/141**, 6 más (compu y celular):
  - elegir una sugerencia completa la dirección y Georef la confirma (con el teclado);
  - Georef propone la calle bien escrita, avisa la altura y deja seguir;
  - el aviso del carrito en compu, notebook y celular, con «Comprar ahora».
- Hallazgos corregidos antes de entregar:
  - la ficha ve el stock hasta 10: con 10 o más no se sabe el exacto, así que el aviso no bloquea y lo controla la API;
  - la respuesta de sugerencias podía abrir la lista encima de otro campo si ya se había pasado a otro;
  - en el celular el aviso de Georef quedaba lejos de la calle;
  - una prueba de cupones leía el total antes del recálculo al cambiar el pago;
  - la auditoría se cortaba entera si la API cerraba la conexión mientras se subía el Excel de 7 MB, aunque ese corte es justamente el rechazo que se busca. Ahora cuenta como rechazo.

**Hacker**
- Auditoría: **385/385**, con 22 chequeos nuevos (§ 7j, detalle en `seguridad.md`).
- Decisiones:
  - la clave de Google nunca sale del servidor;
  - el id de Google se valida antes de ir en su URL;
  - sin Redis no se usa Google (no se puede contar el tope);
  - freno por IP y tope por día: lo peor de un abuso es un día sin sugerencias;
  - a Google y Georef va sólo la dirección, nunca nombre, email ni teléfono.

## Etapa 10 · resultados del cierre (06/10/2026)

**Qué entró** (cómo se usa en [`carrito-checkout-backoffice.md`](carrito-checkout-backoffice.md))
- **El pack va aparte en el carrito:** una línea «Pack x5 …» con lo que lleva y cuántos packs. La misma prenda suelta va a su precio y no suma para el pack. El stock se controla con lo suelto más lo de los packs. A Stocker va una línea por SKU.
- **Carrito con dos botones de pago:** «Pagar con transferencia» (con el % ya aplicado y cuánto se ahorra) y «Tarjeta o Mercado Pago» (con las cuotas). Cada uno lleva al checkout con ese pago elegido.
- **Checkout de una página, como Deliver:** a la izquierda los datos, la entrega, el envío y el pago (cada forma con su precio); a la derecha el resumen fijo con fotos, packs, cupón, el total y cuánto se ahorra. En el celular, el resumen va plegado arriba.
- **Ficha:** con stock, «Agregar al carrito» y «Comprar ahora»; sin stock en el color, «Consultar por WhatsApp».
- **Eliminar productos** (uno o varios). Es una baja suave: Stocker no los vuelve a publicar y se restauran desde el filtro «Eliminados».
- **Backoffice rediseñado:** menú oscuro agrupado con íconos, tarjetas, tablas y campos con el mismo estilo, y el panel con indicadores.
- **Guías de talles con Excel:** exportar e importar, con vista previa. Se agregan los talles propios y las medidas con nombre propio. La migración 0017 carga las 40 guías de la fábrica.
- **Sólo productos padre desde Stocker:** se descarta lo marcado como evento, pack o combo.
- **Migraciones 0016** (productos eliminados y guías con talles propios) **y 0017** (guías de la fábrica).

**QA**
- Pruebas unitarias: **489/489**, 13 más que en la entrega anterior.
  - Carrito: el pack aparte, el mismo pack dos veces, 7 prendas, un pack que no se arma (prenda que no es pack, mezclado, fuera del rango, sin stock contando lo suelto), formas inválidas y la rebaja contra el pack.
  - Stocker: las líneas para Stocker; sólo productos padre.
  - Backoffice: eliminar y restaurar (no se puede publicar, la base no deja).
  - Excel: el archivo real de la fábrica, la vuelta exportar → importar, valores, hojas mal armadas, zip inflado, nombres de hoja; importar, vista previa y exportar por la API; la migración con las 40 guías.
- Pruebas en navegador: **135/135** (1 más que la entrega anterior).
  - Nuevas o cambiadas: el pack aparte de la suelta en el carrito, «Comprar ahora» al checkout, y la ficha sin stock con WhatsApp (agota un color y lo devuelve).
  - Los flujos de compra entran por «Pagar con transferencia», y el resumen del checkout se abre en el celular.
- Hallazgos corregidos antes de entregar:
  - Con algo sin stock en el carrito, los botones de pago mostraban «$ 0». Ahora dicen qué corregir.
  - Un pack que no se podía armar también sumaba al control de stock y daba dos avisos.
  - El aviso «falló /api/t/cuenta» en el navegador era de Chromium con las respuestas 204, no de la tienda: la prueba lo ignora.

**Hacker**
- Auditoría: **363/363**, con 15 chequeos nuevos (§ 7i, detalle en `seguridad.md`).
- Decisiones:
  - el % del pack nunca viaja desde el navegador;
  - eliminado ⇒ oculto como restricción de la base;
  - el Excel se lee con topes de tamaño, inflado, hojas, filas y columnas, y sin fórmulas;
  - importar pide rol operador y queda en la auditoría.

## Etapa 9 · resultados del cierre (06/10/2026)

**Qué entró** (cómo se usa en [`packs-liquidacion-menu.md`](packs-liquidacion-menu.md))
- **Packs de 2 a 10, sobre la prenda padre.** No vienen de Stocker: una prenda marcada «Pack» se vende en cantidad con sus mismas fotos y variantes. Cada prenda del pack con su talle y color.
  - Ajustes → Packs: mínimo, máximo (hasta 20) y un % por cantidad. De fábrica: 2 a 10, del 10 al 25 %.
  - **Stock:** no ofrece más de lo que hay entre todas las variantes, y una variante deja de ofrecerse cuando las otras prendas del pack ya se llevaron todas. «Copiar la prenda 1 a todas» copia hasta donde alcanza y avisa.
  - `pack-x15-…` (fuera del rango) redirige a la cantidad más cercana.
- **Packs en la barra**, con desplegable Hombre / Mujer / Niños; `/packs` con una sección por categoría y `/packs/<categoría>` con la grilla y filtros.
- **Liquidación:** un descuento con la casilla «Es liquidación» (o Productos → «Mandar a Liquidación…»).
  - Sus prendas con stock salen en `/liquidacion` y `/liquidacion/<categoría>`, en la barra con su desplegable, con la etiqueta «Liquidación» en la tarjeta y en la ficha.
- **Menú del celular por niveles:** al tocar Hombre, Mujer o Niños, sus subcategorías, los atajos a sus packs y su liquidación, y 1 o 2 fotos de prendas que la representan. Elige las destacadas primero, después las nuevas, siempre con foto y stock. En la compu, el desplegable de cada categoría muestra lo mismo.
- **Envío gratis en la ficha:** «Te faltan $ X para el envío gratis» con barra, según el carrito (Ajustes → Envío gratis desde).
- **Migración 0015:** pasa el ajuste viejo de packs (x2 a x5) al nuevo y suma la casilla de liquidación a los descuentos.

**QA**
- Pruebas unitarias: **476/476**, 10 más que en la entrega anterior.
  - Compartido: rango y % de packs, formato viejo, direcciones `pack-xN`.
  - API: config con el rango y las categorías con packs, 7 unidades → 22 %, ajuste inválido o viejo → 400, rango 3–4, packs por categoría, liquidación (sección, por categoría y por subcategorías; vencida o agotada no sale), fotos del menú (destacadas primero, 2 como mucho, sin stock no).
  - Caché con techo.
- Pruebas en navegador: **134/134**, 7 más (las nuevas corren en compu y celular según corresponda).
  - Nuevas: el pack de 10 con el stock real (cantidades apagadas, dirección que baja sola, «Copiar a todas» que no alcanza, variante agotada en la última prenda), Packs y Liquidación por categoría, el menú del celular (subcategorías, fotos, volver, Packs, Escape) y la barra de envío gratis.
- Hallazgos corregidos antes de entregar:
  - **«Copiar la prenda 1 a todas» no avisaba** cuando no alcanzaba el stock: la cuenta de las que faltaban se hacía dentro de una actualización de React que corre después, y el aviso salía con 0. Lo encontró la prueba nueva del pack.
  - Pruebas anteriores puestas al día con el cambio:
    - el menú del celular ahora va por niveles (Hombre › Pantalones);
    - «Mujer» también es un acceso del header en el celular;
    - el orden por precio se lee del precio que se cobra, no del tachado de una prenda en liquidación.

**Hacker**
- Auditoría: **348/348**, con 22 chequeos nuevos (§ 7h, detalle en `seguridad.md`).
- Hallazgos corregidos antes de entregar:
  - **Caché sin techo.** La caché corta de la API guardaba para siempre cada clave pedida, y las claves salen de la dirección: pedir miles de categorías inventadas la hacía crecer sin límite. Ahora tiene tope y borra las vencidas.
  - **La auditoría leía el ajuste de packs viejo** (una lista): con el formato nuevo se habría caído en vez de chequear el tope.

## Transferencias que se confirman solas (06/10/2026)

Guía en [`transferencias.md`](transferencias.md).

**Qué entró**
- **Un CVU por pedido con Talo.** Al crear un pedido por transferencia se pide a Talo un cobro con su CVU y alias, por el monto exacto. Talo avisa y la tienda lo confirma preguntándole con su credencial.
- **La cuenta de Mercado Pago, sin costo.** El pedido pide un monto con centavos únicos ($ 45.000,37). La tienda reconoce la transferencia entre lo que entró a la cuenta y la confirma. Recibir transferencias en Mercado Pago no tiene comisión.
- **Ajustes → Transferencias que se confirman solas:** las dos opciones. Juntas, va Talo y, si no responde, Mercado Pago. Con ninguna, todo como antes.
- **Cómo se busca la plata:** el aviso (Talo o Mercado Pago), la página del pedido abierta (cada 20 s) y la vuelta del worker (cada 2 minutos). Además, antes de vencer un pedido se mira si la transferencia llegó.
- **Página del pedido y mail:** el monto exacto con los centavos y botón de copiar, y el CVU propio con Talo. El comprobante pasa a ser el plan B.
- **Backoffice → Transferencias:** lo que no se pudo asignar solo (sin los centavos, de menos, plata que no es de una compra). Se asigna a un pedido o se descarta. El panel muestra cuántas hay.
- **Migración 0014**, simulador de Talo (`pnpm demo:talo`) y transferencias simuladas en el Mercado Pago de prueba.
- **Precios:** tarjeta y Mercado Pago al precio de lista y transferencia con descuento, como ya estaba. No hay recargo por pagar con tarjeta: lo prohíbe la Ley 25.065 (art. 37 c) y la Res. 51-E/2017.

**QA**
- Pruebas unitarias: **466/466**, 22 más que en la entrega anterior.
  - API: 15 nuevas de transferencias (Talo: CVU por pedido, aviso que no se cree, de menos y después completo, pago de otro pedido, token vencido, Talo caído; Mercado Pago: centavos únicos, la vuelta, ventas del local y tarjetas que no cuentan, el aviso, la página abierta, antes de vencer, apagar el ajuste con pedidos esperando, nada que esperar) y 5 del backoffice (lista, asignar, no a uno ya cobrado ni si no alcanza, descartar, ajuste).
  - Compartido: el monto con centavos. Worker: el mail con el CVU o los centavos.
- Pruebas en navegador: **127/127**, 2 más. Nuevas: Talo de punta a punta, y Mercado Pago con centavos confirmado solo y sin centavos asignado a mano desde el backoffice. Corren en su propio proyecto, después de las demás, porque cambian un ajuste de toda la tienda.
- Hallazgos corregidos antes de entregar:
  - **Montos redondeados.** Se mostraban a pesos ($ 16.000 en vez de $ 16.000,37): con la cuenta de Mercado Pago, el cliente habría transferido sin los centavos. Ahora el monto a transferir se muestra exacto.
  - **Pedidos colgados al apagar el ajuste.** Apagar la opción de Mercado Pago dejaba sin confirmar los pedidos que ya habían pedido el monto con centavos. Ahora el ajuste sólo decide qué hacen los pedidos nuevos, y los que esperan se siguen confirmando. Lo encontró la prueba en navegador; hay una prueba nueva que con el código anterior falla.

**Hacker**
- Auditoría: **326/326**, con 15 chequeos nuevos (§ 7g, detalle en `seguridad.md`).
- Decisiones:
  - El aviso de Talo no se cree (no viene firmado) y, con un id ajeno, ni se consulta.
  - Las credenciales de Talo quedan sólo en el servidor.
  - Asignar a mano pide rol operador y queda auditado.
  - Una transferencia nunca se cuenta dos veces.

## Etapa 8 · resultados del cierre (06/10/2026)

**Qué entró** (cómo se usa en [`inicio-packs-resenas.md`](inicio-packs-resenas.md))
- **Inicio más completo**, de arriba hacia abajo:
  - carrusel de banners (backoffice → **Portada**): foto para compu y, si se quiere, otra vertical para celular, con orden, fechas y enlace a una página de la tienda;
  - beneficios, nuevos, **packs**, destacados;
  - **pestañas por categoría** (Hombre, Mujer, Niños);
  - categorías con foto de fondo;
  - **números de la marca** (Ajustes, más el promedio de reseñas y los locales);
  - **opiniones de quienes compraron**, al final.
  - El anuncio de arriba dice «Te faltan $X para el envío gratis» cuando hay algo en el carrito.
- **Packs de 2 a 5 unidades:**
  - casilla «Se vende en pack» en cada prenda y % por cantidad en Ajustes (10, 15, 18 y 20 por defecto);
  - página `/packs` y página de cada pack, `/producto/pack-x2-<prenda>`: al elegir la cantidad, la dirección pasa a `pack-x3`, `pack-x4`… (se puede compartir; Google indexa la de 2);
  - cada unidad con su talle y su color, e «Igual a la anterior»;
  - el % lo calcula la API contando las unidades de la prenda en cualquier talle y color, aunque se sumen sueltas; no se suma a una rebaja (gana el mayor);
  - el carrito muestra «Pack x3 · −15%», y Stocker recibe el precio por unidad ya con el descuento.
- **Descripción en la ficha:** siempre hay una (la del backoffice o una armada con lo que se sabe de la prenda), más desplegables de **Composición y cuidados** y **Cambios y devoluciones**. Campo «Composición» por prenda, cuidados generales en Ajustes y filtro «Sin descripción».
- **Reseñas de compras verificadas:**
  - Unos días después de entregado o retirado (Ajustes, 4 por defecto) sale un mail con estrellas y un enlace firmado. También desde «Mi pedido» → Opinar.
  - Una opinión por prenda (estrellas, calce y texto) y una general.
  - Entran por revisar. En backoffice → **Reseñas** se publican (de a una o varias), se rechazan o se responden. Hay un ajuste para publicarlas sin revisar.
  - Se ven en las tarjetas (estrellas), en la ficha (promedio, cuántas de cada puntaje, cómo calza, lista ordenable) y al final del inicio. Las estrellas van en los datos para Google.
- **Migración 0013:** sale sola al desplegar. También borra la redirección `/packs` → `/` que traía la 0012 de la tienda anterior.

**QA**
- Pruebas unitarias: **444/444**, 18 más que en la entrega anterior.
  - compartido 50: dirección del pack, nombre de quien opina, opiniones válidas y estrellas en los datos para Google;
  - API 226: packs en el carrito (cualquier talle y color, contra una rebaja, % en Ajustes), enlace para opinar, guardar y moderar, publicar solas, el freno por cliente, y banners con fotos y enlaces propios;
  - worker 78: el mail para opinar sale una sola vez y no a pedidos viejos ni sin entregar.
- Pruebas en navegador (escritorio y celular): **125/125**, 8 más. Las 11 omitidas son, como antes, flujos que alcanza con probar en un solo tamaño de pantalla. Nuevas:
  - el inicio con carrusel, packs, pestañas y opiniones;
  - el pack: la cantidad cambia la dirección, cada prenda con su talle y color, y el carrito cobra el pack;
  - una prenda que no se vende en pack manda a su ficha;
  - la ficha con descripción, composición y opiniones;
  - el flujo completo: enlace del mail → opinar → el backoffice publica → se ve en la ficha.
- Hallazgos corregidos:
  - **`/packs` mandaba al inicio.** La redirección de la tienda anterior (0012) le ganaba a la página nueva, y el navegador además la precargaba desde el menú. La 0013 la borra.
  - El inicio con banners se quedaba sin título principal (`h1`): ahora va uno para lectores de pantalla y Google.
  - Moderar una reseña daba error 500 (un mismo parámetro usado con dos tipos en la consulta).
  - El panel de la página del pack era más alto que la pantalla y quedaba cortado: deja de quedar fijo.

**Hacker**
- Auditoría: **311/311**. La sección nueva (§ 7f, detalle en `seguridad.md`) tiene 48 chequeos; 2 corren sólo si hay un pedido entregado para probar con una firma buena (en los datos de prueba, ISU-1001), y dan 313/313.
- Hallazgo corregido: **el freno contra probar enlaces para opinar no se aplicaba por la tienda.** Contaba por IP con el límite general, y el servidor de la tienda está exento, así que por la tienda no había tope. Ahora usa el freno propio y cuenta por la IP del cliente. Prueba nueva: con el código anterior no frena; con el arreglo, al 11.º intento da 429 y otro cliente sigue pudiendo opinar.
- Decisiones:
  - Sólo opina quien compró y recibió: no hay formulario abierto.
  - Se publica con nombre e inicial.
  - El texto se muestra como texto.
  - El enlace de un banner se comprueba también en la tienda (tercera llave).

## Arreglo: la importación de fotos se cortaba por tiempo (04/10/2026)

En producción, `mayorista/cli.js --aplicar` se cortó con `canceling statement due to statement timeout` (en `producto_colores`).

- **Causa.** Cada foto se subía a R2 **dentro** de la transacción que inserta su fila. El trigger de los topes bloquea el producto, así que el producto quedaba bloqueado los segundos de la subida. Si a la vez corría la sincronización con Stocker, se esperaban entre ellas, y la base corta cualquier espera a los 10 s.
- **Arreglo, en el worker y en la subida del backoffice:** primero se suben los archivos y después entra la fila, en una transacción de milisegundos. Si la fila no entra (tope, repetida), los archivos se borran.
- **Importación:**
  - cada producto espera un bloqueo hasta 5 s y se reintenta con espera creciente;
  - si sigue ocupado, se saltea, se sigue con los demás y se lista al final para volver a correrla;
  - sólo escribe un color si cambió algo.
- **Prueba nueva:** reproduce el bloqueo con otra conexión. Con el código anterior falla con el mismo error de producción; con el arreglo pasa.

## Contrato v1 de Stocker · tanda 1: catálogo, stock y aviso (04/10/2026)

Con el JSON real del catálogo y del stock que mandó Stocker (punto 3.1 de [`respuesta-contrato-stocker.md`](respuesta-contrato-stocker.md)). Detalle de cada campo en [`contrato-stocker.md`](contrato-stocker.md).

- **Catálogo** (`packages/stocker`):
  - lee `skuAgrupador`, `precioMinorista` (no el mayorista), `publicable`, `activo` y `generadoEn`;
  - una variante con `activo: false` no se vende;
  - un `publicable` negativo cuenta como 0.
- **`truncado`:** si la lista vino cortada, no se da de baja nada de lo que faltó, y se avisa en el log.
- **Stock:** un SKU en `desconocidos` no pasa a «sin stock». Se avisa en el log y se pide el catálogo.
- **Aviso en vivo:** `LISTEN stock_cambio` (`<negocio>:<variante>`) reemplaza a `stocker_stock`. La variante se traduce a su SKU por `stocker_id`, y una variante que la tienda no tiene dispara el catálogo.
- **Errores de conexión:** «Stocker no responde» ahora dice la causa (`ENOTFOUND`, `ECONNREFUSED`, tiempo agotado…) y qué revisar en `STOCKER_API_URL`.
- **Simulador:** el Stocker simulado de las pruebas habla v1 en catálogo, stock y aviso. Los pedidos siguen con las formas viejas hasta la tanda 2 (3.2–3.4).
- **Verificado** desde una copia limpia:
  - lint y tipos;
  - 423 pruebas unitarias, con 4 nuevas (la respuesta real de Stocker, `truncado` en el cliente y en la base, y el trabajo de stock por variante con `desconocidos`), más las del aviso y del stock pasadas a v1;
  - 117 pruebas en navegador;
  - diagnóstico «Todo bien», seguridad y seo.

## Despliegue en un solo servicio (02/10/2026)

- `infra/railway/todo.json` + `scripts/todo-en-uno.mjs`: la tienda entera en **un** servicio de Railway (más un Redis), para planes con pocos servicios. Guía: [`un-servicio.md`](un-servicio.md).
  - Arranca la api, el worker, la tienda y el backoffice en el mismo contenedor y los levanta solos si se caen (esperando cada vez más, hasta 30 s).
  - Al apagar el servicio, apaga todo en orden.
  - `API_URL` y `WEB_INTERNAL_URL` se fijan a 127.0.0.1.
- Escucha en `::` y, si la máquina no tiene IPv6, en `0.0.0.0`. Era un hallazgo: con `::` fijo, la tienda no arrancaba en una máquina sin IPv6.
- **Hallazgo (también con cuatro servicios):** como el build de Railway no llega a la API, el inicio, Nuevos y Destacados salían del deploy con los valores de respaldo (sin productos destacados ni asistente) durante hasta 5 minutos. Ahora la tienda, al arrancar y apenas contesta la API, regenera esas páginas sola (`apps/web/src/instrumentation.ts`).
- Verificado desde una copia limpia, compilando sin API como Railway y probando apenas arranca: ver la entrega.
- **Redis compartido** entre todas las plataformas del proyecto ([`redis-compartido.md`](redis-compartido.md)): cada una en su base numerada (la tienda, la 1), con prefijo propio en claves, colas y canales.
  - El worker avisa al arrancar si el Redis puede borrar trabajos (`maxmemory-policy` distinto de `noeviction`) o no guarda en disco (`appendonly no`).
  - Los comandos de consola (`mayorista:importar`, `fotos:importar`, `seo:tienda-anterior`) se conectan por la red interna de Railway igual que el worker (`family: 0`).

## Etapa 7 · resultados del cierre (01/10/2026)

**Qué entró** (detalle y pasos con Google en [`seo.md`](seo.md))
- **Redirecciones 301 desde la tienda anterior.**
  - Las 70 direcciones de www.isuwaya.com (sitemap de Jumpseller) vienen en la migración 0012.
  - Productos: por SKU a su ficha actual mientras esté publicada; si no, a su categoría (plan B), nunca a un 404.
  - Lo demás: categorías, `/contact` → `/locales`, políticas → sus páginas.
  - Las resuelve la API (`/v1/redirecciones`: cadenas a un solo salto, círculos descartados) y la tienda redirige antes de armar la página (`apps/web/src/proxy.ts`).
  - El mapa se renueva cada 5 minutos o al toque cuando el catálogo cambia.
  - **Backoffice → Redirecciones**: lista con el estado de cada una (a la ficha / plan B), alta, edición y baja.
  - `pnpm seo:tienda-anterior <url> [--aplicar]` relee el sitemap de la tienda anterior y agrega lo que falte.
- **Datos estructurados.**
  - Ficha como **ProductGroup**, con una variante por talle y color: precio, precio tachado, stock, foto del color, dirección `?color=`, envío (gratis si la prenda llega al mínimo) y devoluciones (30 días).
  - Migas de pan.
  - Inicio con **WebSite** + **OnlineStore**.
  - Locales como **ClothingStore**, con el horario interpretado del texto de Ajustes; si no lo entiende, no lo publica.
  - Categorías con la lista de sus productos.
- **Textos.**
  - Título, descripción y **texto** de cada categoría editables, con vista previa de Google. El texto se muestra abajo de la grilla.
  - Descripciones automáticas de ficha (colores, talles con stock, precio, condiciones) y de categoría (cantidad, precio desde, talles), que nunca se cortan a mitad de frase.
- **Sitemap con fotos**, hasta 5 por producto.
- **Feed de Google Merchant Center** (`/feed/google.xml`): una fila por variante con color, talle, género, edad, oferta y envío.
- El sitemap y el feed se arman en cada pedido: en el build de Railway no hay API y saldrían vacíos.
- Verificación de Search Console y Bing por variable (`GOOGLE_SITE_VERIFICATION`, `BING_SITE_VERIFICATION`).
- `pnpm seo <tienda> [--viejas …]`: chequeo desde afuera de robots, sitemap, 25 páginas (título, descripción, canónica, noindex, h1, alt, datos estructurados), feed y direcciones viejas.

**QA**
- Pruebas: compartido 44/44 (+16: direcciones viejas y destinos propios, ProductGroup con variantes y envío gratis, descripciones que nunca se cortan, horario, feed), base 39/39, API 215/215 (+6: mapa resuelto a la ficha o al plan B, por SKU de talle, cadenas y círculos, destinos ajenos, auditoría, texto de categoría), worker 70/70 (+2: lector de la tienda anterior con un sitio simulado), envíos 49/49.
- E2E (escritorio y celular): **117/117**. Nuevas:
  - direcciones viejas → 301 (mayúsculas, barra final, `?utm_`), y una que nunca existió sigue en 404;
  - sitemap con fotos y feed;
  - ProductGroup, migas y canónica;
  - WebSite y locales;
  - en el backoffice, crear y borrar una redirección y el texto de una categoría, que se ven en la tienda al toque.
- Contra el sitio real: las **72 direcciones** de www.isuwaya.com llegan a una página de la tienda nueva (40 de las 44 fichas a su ficha; las 4 sin fotos, como SOFT, a su categoría). `pnpm seo` → «Todo bien para Google».
- Hallazgos corregidos:
  - **Editar parcialmente una categoría por la API ponía orden 0 y visible.** Venía de la etapa 3: zod 4 aplica los valores por defecto también en `.partial()`. El backoffice mandaba todo y no se notaba.
  - Las categorías perdían la imagen de vista previa (Open Graph propio pisaba el general).
  - Sin dominio configurado, la redirección iba a la dirección interna del contenedor.
  - La foto principal quedaba fuera de las fotos del producto en los datos cuando tenía color.
  - El sitemap y el feed salían vacíos la primera hora después de cada deploy (se generaban en el build, sin API).

**Hacker**
- Auditoría: **265/265**. Hay 11 nuevos:
  - `Host` y `X-Forwarded-Host` falsos;
  - rutas armadas para escaparse a otro dominio (`//`, `%2F%2F`, `\`, CRLF);
  - el backoffice de redirecciones sin sesión (5);
  - el mapa sólo con rutas propias;
  - el feed sin datos internos y escapado;
  - robots.txt.
- Hallazgo corregido: sin dominio configurado, la redirección usaba el `X-Forwarded-Host` del pedido. Iba sin caché, pero ahora sólo acepta el dominio configurado o el de Railway (`RAILWAY_PUBLIC_DOMAIN`).
- Decisiones:
  - Destino siempre propio, con tres llaves: base, API y proxy.
  - El `Location` va con el dominio canónico.
  - El mapa es público, porque no tiene nada secreto.
  - El texto de categoría se muestra como texto, no como HTML.
  - El feed no publica stock exacto.
  - Detalle en `seguridad.md`.

## Etapa 6 · resultados del cierre (30/09/2026)

**Qué entró**
- **Importación del sitio mayorista** (`pnpm mayorista:importar`): lee el catálogo público del mayorista y trae **lo que Stocker no tiene**: las fotos, el color exacto de cada muestra y la categoría de la tienda. Precio y stock siguen saliendo **sólo de Stocker** (los del mayorista son mayoristas).
  - Engancha cada producto por SKU: el padre (`ISUBOXPAN`, sin importar mayúsculas) o, si no, por los SKU de las combinaciones, que son los de las variantes de Stocker. El color de cada foto se resuelve igual (por los SKU de ese color y, si no, por el nombre).
  - **Fotos**: la principal del mayorista queda **primera** (es la de la grilla) y, si tiene color, la ficha **abre en ese color**; las de un color van a ese color (hasta 5, como pide la tienda); las que no tienen color quedan como generales (se ven con cualquier color). Un color sin fotos muestra las del producto en vez de "foto próximamente". Se procesan como cualquier foto (3 tamaños webp, sin metadatos).
  - **Categorías**: las 71 confirmadas por ISUWAYA quedan fijas (`apps/worker/src/mayorista/decisiones.ts`); los 5 unisex en Hombre **y** Mujer; Wolf (chaleco) en Buzos y camperas; Bengalina, Morgan, IBIZA, Comfort y Luxi en Hombre. Un SKU nuevo se ubica solo por el nombre ("Nena"/"Nene" ahora se reconocen como niños).
  - **Sin fotos → ocultos** (13 productos); si después se les cargan fotos, se publican desde el backoffice.
  - **Abyys**: el color "Único" se llama **Negro** en la tienda. **Cloe**: se vende sólo en talle **Único** (los otros talles quedan ocultos aunque existan en Stocker). Las dos cosas las respeta la sincronización con Stocker.
  - Sin `--aplicar` no escribe nada: muestra el plan producto por producto. Es **repetible** (cada foto recuerda su origen y no se duplica; si una corrida quedó a medias, la siguiente completa y reordena) y **no toca** productos con fotos cargadas a mano (salvo `--reemplazar`). Le pide al sitio del mayorista con calma (de a una, con pausa y reintentos): es su sitio de producción.
- **Backoffice → Productos**: renombrar un color (queda fijo; "volver al de Stocker" lo suelta) y destildar **"En la tienda"** en un talle para no venderlo online.
- **Cupones y promociones** (Backoffice → **Cupones**):
  - **Cupón con código** (ej. `VERANO10`) o **promoción automática** sin código ("10% superando $80.000").
  - **Porcentaje**, **monto fijo** o **envío gratis**; para **toda la tienda**, **categorías** (con sus subcategorías) o **prendas elegidas**; compra **mínima**; **fechas**; tope de **usos en total** y **por cliente** (por email); si vale también para prendas **en oferta**. Pausar/activar, y ver en qué pedidos se usó, cuánto se descontó y cuánto se vendió.
  - En la tienda: "¿Tenés un cupón de descuento?" en el carrito lateral, en `/carrito` y en el checkout. Dice por qué no se aplica (no existe, venció, todavía no empezó, se agotó, ya lo usaste, te faltan $X, no aplica a esas prendas o a las que están en oferta) y avisa cuánto falta para una promo ("Te faltan $X para…").
  - **Reglas**: uno por compra (entre el cupón escrito y las promos, **el que más descuenta**; no se suman); orden **rebaja de la prenda → cupón → transferencia**; nunca por debajo de $0; el envío gratis no aplica a Mercado Envíos (lo cobra Mercado Pago). El descuento se reparte **por unidad** (al peso): a Mercado Pago y a **Stocker** va el precio cobrado de verdad, y el cupón queda anotado en el detalle del pedido en Stocker ("Mercado Pago · cupón VERANO10 (10% OFF) · vence…"), en el pedido, en el mail y en el backoffice.
  - Los topes no se pueden pasar con dos compras a la vez (el cupón se bloquea al crear el pedido); si el pedido **vence o se cancela, el uso se libera solo** (lo hace la base).

**QA**
- Compartido 28/28, base 39/39 (+4: 0010 y 0011, total del pedido que cierra con el cupón, uso que se libera y vuelve), API 209/209 (+19: cupones de punta a punta con Mercado Pago y Stocker simulados, topes, carrera por el último uso, vencimiento, backoffice), worker 68/68 (+13: importación con enganche por SKU y por variantes, fotos por color y principal, colores y talles que la sincronización respeta, repetible, corrida a medias que se completa, descargador con reintentos y caché), envíos 49/49.
- E2E (escritorio y celular): **108/108** — nuevas: cupón que no existe, aplicar y quitar en el carrito, cupón que sigue en el checkout y queda en el pedido, envío gratis con mínimo, y en el backoffice crear un cupón, usarlo en la tienda y pausarlo.
- **Importación real** contra el sitio mayorista, en una tienda de prueba con los 71 productos simulados en Stocker: **71 enganchados, 1.068 fotos, 0 fallidas**, 58 visibles y 13 ocultos (sin fotos). Topes: Moron (2 colores) y Abyys (1 color) tienen más fotos sin color que las que entran (5 × colores): entran las primeras, la principal incluida.
- Carga: carrito con cupón **1.732 pedidos/s** (p99 44 ms), 0 errores, como mucho 10 conexiones a la base de Stocker.
- Hallazgos corregidos: el sitio mayorista devolvía 503 si se le pedían varias fotos a la vez (ahora de a una, con pausa y reintentos); **bloqueo mutuo** entre dos compras con el mismo cupón (la clave foránea del pedido al cupón tomaba un bloqueo antes del `FOR UPDATE`: ahora se bloquea el cupón primero); "Pausar" en el backoffice mandaba un campo de más; las pruebas del worker se pisaban entre sí (corren de a un archivo); una prueba del asistente dependía de la hora (Cabify "llega hoy" antes de las 14 h).

**Hacker**
- Auditoría: **254/254** (15 nuevos: inyección y comodines en el código del cupón, código largo, cupón que no es texto, descuento mandado desde el navegador, total nunca negativo, probar códigos a ciegas → 429, puente de la tienda, las 7 rutas nuevas del backoffice → 401).
- Decisiones: el navegador sólo manda el código; el descuento lo calcula la API y se vuelve a calcular al crear el pedido (si el cupón dejó de servir en el medio, el pedido no se crea y se le avisa: nunca se cobra otro total del que vio). Tope de 40 intentos con cupón por IP cada 10 minutos. Importador: sólo pide rutas `/fotos/…` del mismo sitio (sin redirecciones, tope de tamaño y de tiempo, tiene que ser imagen), valida el catálogo con un esquema y no guarda textos del mayorista (nombres y categorías salen de Stocker y de las decisiones).
- Stocker: esta etapa **no cambia** Stocker (usa `precioUnitario` y `pagoDetalle` que ya existían).

## Etapa 5 · resultados del cierre (29/09/2026)

**Qué entró**
- **Asistente de la tienda** (burbuja de chat abajo a la derecha, con WhatsApp adentro; en el celular ocupa la pantalla). Responde:
  - con **datos de verdad**: cuánto sale el envío a un código postal (cotiza con los transportes; si no lo dijo, lo pide), cómo viene un pedido (con número **y** email: estado, transporte y enlace de seguimiento), prendas del catálogo ("¿tienen buzos?", con foto, precio y enlace) y pase a una persona por WhatsApp;
  - con las **preguntas frecuentes** que edita el backoffice (17 de arranque: envíos, pagos, cuotas, transferencia, talles, cambios, arrepentimiento, fallas, locales, retiro, mayorista, seguridad). Las respuestas usan los datos de Ajustes ({descuento}, {cuotas}, {whatsapp}…). Entiende preguntas escritas "como se escriben" (sin tildes, con errores, en plural o singular, sinónimos como "mandan" o "correo");
  - en una ficha, "¿qué talle soy?" **abre la guía de talles** de esa prenda en "¿Cuál es mi talle?";
  - lo que no sabe: lo dice, ofrece WhatsApp y lo anota **sin datos personales** para sumarlo después.
- **IA opcional** (Claude): sólo para lo que no cubren las preguntas frecuentes, sólo si hay `ANTHROPIC_API_KEY` y se prende en Ajustes, con **tope de consultas por día** y por IP. Usa sólo la información de la tienda (no inventa precios, stock ni políticas); si falla o tarda, el asistente contesta como siempre.
- **Backoffice → Asistente**: preguntas frecuentes (crear, editar, desactivar, con "otras formas de preguntarlo"), **Sin respuesta** (lo que no supo, para convertirlo en pregunta), **Probar** (qué respondería y con qué puntaje) y lo más consultado. En Ajustes: prender/apagar (apagado vuelve el botón de WhatsApp), saludo, IA y tope diario.
- **Ajustes finales**: un cambio en Ajustes del backoffice (anuncio, WhatsApp, asistente…) se ve en la tienda **al instante** (antes tardaba hasta 60 s); la tienda **compila sin la API** (como en CI); **CI completo** con `scripts/ci/levantar-e2e.sh` (levanta simuladores, servicios y datos de muestra, y corre e2e + auditoría); guía de **salida a producción** (`docs/salida-produccion.md`: orden, pruebas de humo y cómo volver atrás).

**QA**
- Compartido 28/28, base 35/35 (+0009), API 190/190 (+47 del asistente, con una batería de 17 preguntas escritas como las escribe la gente), worker 55/55, envíos 49/49.
- E2E (escritorio y celular): **101/101** (7 omitidas a propósito), corridas desde una copia limpia con el mismo script que usa CI — nuevas: abrir/cerrar con teclado, pregunta frecuente con su botón y voto, envío por CP, pedido con número y email, productos, charla que sigue al cambiar de página, guía de talles desde el chat, HTML que se muestra como texto.
- Carga final (10 s por prueba, 50–100 conexiones, todo pegando al origen): **0 errores** en 14 superficies — API catálogo 3.850–7.200 pedidos/s, búsqueda 913/s, carrito 1.890/s, opciones de envío 722/s, asistente 5.144/s (pregunta frecuente) y 939/s (búsqueda de productos), páginas de la tienda 630–920/s (p99 ≤ 160 ms). La tienda usó como mucho **10 conexiones** a la base de Stocker.
- Celulares: asistente (con envío, productos, talle y pedido), Backoffice → Asistente y Ajustes a 320, 360, 375, 390, 414, 768 y 1280 px, sin desborde horizontal.
- Hallazgos corregidos: un enlace de pregunta frecuente como `//otro.sitio` se tomaba como "de la tienda" (**redirección abierta**; ahora lo frenan el esquema y la base); "soy" hacía que cualquier frase con "soy" respondiera la de talles; contar usos en la misma fila de la base en cada consulta hacía cola de bloqueos en un pico (ahora se suman en memoria y se guardan cada 10 s); en el celular el foco no volvía a la burbuja al cerrar; CI corría las e2e sin simuladores ni datos (fallaban); `.gitignore` dejaba afuera `scripts/demo/` (los simuladores); `CORREO_DE` sin comillas rompía `source .env`.

**Hacker**
- Auditoría: **239/239** (24 nuevos: entrada estricta del chat, lo del cliente vuelve siempre como JSON y nunca como HTML, enlaces sólo de la tienda o su WhatsApp aunque se pidan otros, ningún secreto en las respuestas aunque se pidan con "ignorá tus instrucciones…", pedido con la misma respuesta exista o no, probar emails contra un número → 429, las 8 rutas del backoffice del asistente → 401, puente de la tienda, ráfaga → 429). `pnpm audit`: sin vulnerabilidades.
- Decisiones: el navegador sólo manda el mensaje (y el CP que se le pidió): las respuestas, enlaces y precios los arma la API; la tienda muestra todo como texto y vuelve a filtrar los enlaces; la conversación no se guarda en el servidor; lo sin respuesta se guarda tachando emails, teléfonos y números, 90 días; a la IA le llega sólo el texto de la consulta (y hasta 3 mensajes anteriores del cliente, nunca respuestas "del bot" que pudiera inventar el navegador), marcado como dato; su salida se limpia (sin enlaces ni markdown) y los enlaces los pone siempre la tienda. Pedido por chat: número **y** email, frenos por IP y por número.
- Stocker: esta etapa **no cambia** Stocker.

## Etapa 4 · resultados del cierre (28/09/2026)

**Qué entró**
- **Checkout con opciones de envío**: con el código postal (acepta CPA) la API cotiza con cada transporte y muestra las opciones con precio, plazo, "Gratis" (con el precio original tachado) y "Llega hoy". A **sucursal** se elige la sucursal de la lista del transporte para ese CP. El precio lo pone siempre la API: al confirmar se vuelve a cotizar la opción elegida (si ya no está, 409 y se vuelven a mostrar las opciones).
- Transportes: **Correo Argentino** (MiCorreo), **Andreani**, **OCA** (e-Pak), **Mercado Envíos** y **Cabify Logistics** (en el día). Cada uno se prende sólo si tiene sus credenciales, y desde Ajustes se elige cuáles se ofrecen, a domicilio y/o sucursal, y un recargo % (redondeado a $10). Si un transporte no responde en 6 s, se muestran los demás y se avisa; si no responde ninguno, queda el envío estándar de costo fijo (la venta no se frena). Cotizaciones en caché 30 min.
- **Envío gratis** desde el monto de Ajustes: la opción estándar más barata sale $0 y las demás cuestan la diferencia (en el día y Mercado Envíos no entran).
- **Mercado Envíos**: sólo pagando con Mercado Pago; el envío lo crea y lo cobra Mercado Pago en su checkout (no suma al total de la tienda; queda anotado lo que cobró). Después del pago el worker trae el envío.
- **En el día (Cabify)**: sólo en los CP, días y antes de la hora de corte de Ajustes; Stocker lo ve en Envíos del día con el horario límite.
- **Paquete**: peso de cada prenda (nuevo campo en el producto, o el de Ajustes) + la caja según la cantidad de prendas. La etiqueta sale con el mismo paquete que se cotizó.
- **Backoffice → Envíos**: Para preparar → **Preparar** (de a 30: crea el envío en cada transporte y guarda la etiqueta; un doble clic no crea dos envíos) → Etiquetados → **Imprimir etiquetas** (un solo PDF con todas) → despacho en **Envíos del día de Stocker** → En camino → Entregados, y **Problemas** (no entregado, devuelto, transporte que no responde). Descartar una etiqueta (vuelve a preparar) y "Actualizar" el seguimiento a mano. Ficha del pedido con el envío, sus eventos y los avisos mandados. Con transporte, "enviado"/"entregado" ya no se marcan a mano.
- **Seguimiento y avisos**: el worker pregunta a cada transporte (cada 10 min, con espera creciente si falla) y guarda los eventos una sola vez. Avisa por **email** y, si el cliente tildó la casilla en el checkout, por **WhatsApp** (Meta Cloud API, plantillas): en camino, en la sucursal, llega hoy, entregado, no se pudo entregar. Nunca se manda dos veces el mismo aviso (`tienda.avisos`).
- **Página de seguimiento pública** `/seguimiento/ISU-…?t=…` (el enlace de los avisos): sin iniciar sesión, sólo el envío y el nombre de pila; la firma no se puede adivinar para otro pedido. La página del pedido muestra "Tu envío" con la línea de tiempo.
- **Ajustes**: transportes (activo, domicilio, sucursal, recargo), remitente, paquete (pesos y cajas), envíos en el día (CP, días, hora de corte) y avisos por WhatsApp.
- Desarrollo: `pnpm demo:transportes` simula los cinco transportes y WhatsApp (con una pantalla para avanzar los envíos y ver los mensajes); el Stocker simulado tiene una pantalla "Envíos del día" con Despachar.

**QA**
- Paquete de envíos 49/49 (adaptadores, estados, teléfonos, XML seguro, PDF), base 32/32 (+0008), API 143/143 (+26 de envíos: opciones, gratis, en el día, sucursal, Mercado Envíos, precio que manda el navegador, seguimiento firmado, backoffice de envíos), worker 55/55 (+17: despacho, avisos sin duplicados, seguimiento, repaso de despachos, Mercado Envíos).
- E2E (escritorio y celular): 87/87 (7 omitidas a propósito) — nuevas: checkout a sucursal con lista y total con el envío, y de punta a punta preparar → imprimir → despachar en Stocker → en camino → WhatsApp → seguimiento público.
- Probado a mano: Mercado Envíos con el pago aprobado en Mercado Pago (simulado) → envío creado, no suma al total, costo cobrado por MP registrado.
- Celulares: checkout con opciones y sucursales, seguimiento, Envíos (todas las vistas), ficha del pedido, Ajustes y producto a 320, 360, 375, 390, 414, 768 y 1280 px, sin desborde horizontal.
- Hallazgos corregidos: la visita fallida del simulador quedaba con fecha anterior al evento previo (el estado no cambiaba); el texto de la casilla de WhatsApp decía "celular" y confundía al lector de pantalla con el campo Celular; **el build de la tienda fallaba con la API apagada** (como en CI: intentaba generar `/hombre` con las categorías de respaldo) — ahora esas páginas se generan en el primer pedido; las pruebas e2e abrían la tienda en `127.0.0.1` y Mercado Pago vuelve a `SITIO_URL` (`localhost`): el navegador no encontraba el acceso al pedido (ahora usan el mismo origen); `pnpm seguridad` no leía el `.env` y no podía revisar los secretos.

**Hacker**
- Auditoría: 215/215 (36 nuevos: seguimiento con firma inventada, corta o rara, igual respuesta exista o no el pedido; opciones con CP inválido, campos de más, 500 ítems, textos enormes; sucursales con transporte inventado; pedido con precio de envío propio, opción inventada o sucursal rara; las 6 rutas del backoffice de envíos sin sesión y con token inventado → 401; el puente de la tienda sólo deja pasar los parámetros de la lista; freno propio de cotizaciones → 429). Ningún secreto (incluidas las claves de transportes y WhatsApp) llega al navegador. `pnpm audit`: sin vulnerabilidades.
- Decisiones: las respuestas XML de los transportes se leen sin DOCTYPE ni entidades (XXE); sin redirecciones y con tiempo máximo; las etiquetas se validan como PDF, se guardan en el bucket privado y se bajan siempre como adjunto; los números de seguimiento se validan antes de guardarlos; teléfono de WhatsApp normalizado a celular argentino; el simulador de transportes se ignora con `NODE_ENV=production`.
- Stocker: patch nuevo (backend incremental sobre la etapa 3 + acumulado, y frontend). Ver `contrato-stocker.md`.

## Etapa 3 · resultados del cierre (28/09/2026)

**Qué entró**
- Backoffice (app aparte, `admin.…`): ingreso con contraseña + **doble factor obligatorio** (QR para Google Authenticator/Authy; el mismo código no sirve dos veces), contraseña provisoria que hay que cambiar, sesión de 12 h como máximo y 30 min sin uso, bloqueo de 30 min a los 5 intentos. Primer usuario: `pnpm admin:crear`.
- Roles: **dueño** (todo, incluidos ajustes, datos bancarios y usuarios), **operador** (pedidos, pagos, productos, fotos, categorías, descuentos, guías, clientes) y **sólo lectura**. Siempre queda al menos un dueño activo.
- **Auditoría** de cada cambio (quién, qué, cuándo, IP), que la base no deja editar ni borrar.
- Panel: pedidos y ventas del día y del mes, lo que hay que atender, catálogo sin fotos/agotado, estado de la sincronización con Stocker.
- Pedidos: buscador y filtro por estado, detalle con historial, registrar transferencia o cobro en el local (Stocker lo deja despachar al instante), cancelar (devuelve la mercadería en Stocker; si estaba pagado avisa que hay que devolver el dinero), listo para retirar / retirado / enviado / entregado, notas internas, descarga de comprobantes (siempre como adjunto).
- Productos: vista masiva con casillas **Visible / Destacado / Nuevo** que se guardan al instante, selección múltiple (marcar/quitar Nuevo y Destacado, publicar/ocultar, agregar a categoría, asignar guía de talles). Edición: nombre (queda fijo frente a Stocker), descripción, SEO, **Destacado (con posición) y Nuevo**, categorías, guía de talles, parte del outfit, color de la muestrita.
- Fotos desde el backoffice: JPG/PNG/WEBP/**HEIC del iPhone** hasta 25 MB, se convierten a los 3 tamaños; 5 por color y 5 × colores por producto (lo controla la base), ordenar y borrar.
- Categorías (dos niveles), descuentos masivos (todo / categorías / productos, con fechas; gana el mayor; tachado y "-X%" en la tienda), clientes (compras, gastado, reenviar a Stocker), ajustes (anuncio, WhatsApp, % transferencia, cuotas, compra mínima, envío, datos bancarios, horas para pagar, locales).
- Tienda: secciones **Destacados** y **Lo nuevo** en el inicio, páginas `/destacados` y `/nuevos`, **"Nuevos" en la barra** (escritorio y celular), etiqueta "Nuevo" y "-X%" en las tarjetas.
- **Guías de talles** (como Mercado Libre): se arma una guía por molde de prenda — de niños (4 a 16) o de adulto (XS a 5XL) — eligiendo las medidas (del cuerpo: altura, edad, pecho, cintura, cadera; de la prenda: ancho, largo, hombros, manga, tiro, entrepierna) y un rango en cm por talle. Se asocia a productos desde la guía (el buscador ofrece los que **coinciden** con sus talles, en verde/amarillo/rojo) o desde el producto. En la ficha: botón "Guía de talles" con la tabla, "Cómo medir" y **"¿Cuál es mi talle?"**, que recomienda el talle con las medidas del cliente (entre dos, el más cómodo; avisa si ninguno le va) y marca su talle en la ficha. Las medidas quedan sólo en el navegador.
- **Armá tu outfit** (`/outfits`, también en la barra): una sola pantalla — para quién, talle **o medidas** (usa la guía de cada prenda), presupuesto, qué partes (arriba, abajo, abrigo) y colores opcionales. Arma hasta 6 combinaciones con stock en ese talle, dentro del presupuesto, que combinan de color y no repiten prendas; cada prenda se puede **cambiar** y el outfit entero va al carrito con un toque. Si no alcanza la plata, dice desde cuánto hay. Más simple que el de Deliver: sin cuestionario de pasos ni registro.
- **Botón Mayorista** en la barra (y en el menú del celular y el pie): pasa por `/mayorista`, que redirige a la variable **`MAYORISTA_URL`**. Se lee en cada clic: se cambia en Railway sin volver a publicar.

**QA**
- Tienda: compartido 28/28 (+guías, recomendación de talle, familias de color), base 28/28 (+0006 y 0007), API 117/117 (+32 del backoffice: ingreso 2FA, roles, auditoría, destacados/nuevos, masivo, fotos, categorías, descuentos, guías, outfits, pedidos, ajustes), worker 38/38.
- E2E (escritorio y celular): 84/84 (6 omitidas a propósito: las que son sólo de escritorio o sólo de celular) — nuevas: Mayorista, Nuevos/Destacados, descuento tachado, guía de talles con recomendación, outfit al carrito, ingreso al backoffice con doble factor, casilla Destacado que aparece en la tienda, editor de guías.
- Celulares: todas las pantallas nuevas de la tienda y del backoffice revisadas a 320, 360, 375, 390, 414 y 768 px, sin desborde horizontal (incluidos la guía de talles abierta, los resultados de outfits y el menú). En el celular, las listas del backoffice pasan a tarjetas: las casillas Visible/Destacado/Nuevo quedan a la vista sin deslizar.
- Hallazgos corregidos en el camino: la clave de cifrado del 2FA mal cargada daba error 500 (ahora la API no arranca con una clave inválida); el botón de la guía dentro del grupo de talles confundía a los lectores de pantalla y a las pruebas (quedó afuera); la calculadora no guardaba las medidas si el talle no había en ese color (ahora se guardan al salir del campo y dice en qué colores hay); restos de pruebas de la base aparecían como descuento en la tienda local (ahora las pruebas limpian lo suyo); Categorías se salía de la pantalla a 320 px.

**Hacker**
- Auditoría: 179/179 (30 nuevos: las 20 rutas del backoffice sin sesión y con token inventado → 401, foto sin sesión no se procesa, 2FA sin primer paso, fuerza bruta → 429, puente del backoffice con rutas raras, CSRF por origen y cabecera, JSON de 300 KB, foto SVG, ingreso fallido sin cookie, `/mayorista` sin redirección abierta, entradas de outfits fuera de rango).
- Decisiones: el secreto del 2FA se guarda cifrado (AES-256-GCM, `ADMIN_CLAVE_CIFRADO`); las sesiones del backoffice se guardan como SHA-256 y el token del primer paso se descarta; cookie `__Host-`, httpOnly, **SameSite=Strict**; el backoffice va en otro subdominio y sin indexar; el navegador nunca habla con la API directo. `pnpm audit`: sin vulnerabilidades.
- Stocker: esta etapa **no necesita cambios nuevos** en Stocker (usa lo de las etapas 1 y 2).

## Etapa 2 · resultados del cierre (28/09/2026)

**Qué entró**
- Cuentas: registro, ingreso, olvidé mi contraseña (enlace de un uso, 1 h), datos, cambio de contraseña, mis pedidos. Compra sin cuenta (queda asociada al email).
- Carrito lateral (envío gratis con barra de avance, cantidades, precio con transferencia) y página de carrito. Todo se recalcula en la API.
- Checkout de una página: contacto, envío a domicilio o retiro en local, medio de pago (sólo los configurados), resumen.
- Pedido → Stocker aparta la mercadería por su cola de ventas online (todo o nada) y queda **SIN PAGAR** en Envíos del día hasta que se cobra.
- Pagos: Mercado Pago (Checkout Pro, aviso firmado + consulta a MP), Pago Fácil / Rapipago (efectivo por MP, con vencimiento), transferencia (20% OFF, datos bancarios, comprobante, **API para registrar el pago** y pantalla que se actualiza sola), pago en el local.
- Vencimientos automáticos: lo no pagado a tiempo se libera en Stocker y se avisa por mail. Pago que llega tarde → `pagado_tarde` para revisar.
- Botón de arrepentimiento con código de trámite; si el pedido no salió, se cancela solo.
- Mails: bienvenida, restablecer, pedido recibido, pago confirmado, comprobante recibido, pedido vencido, arrepentimiento.
- GA4: add_to_cart, remove_from_cart, view_cart, begin_checkout, add_payment_info, purchase.

**QA**
- Stocker: `test-tienda-pedidos.cjs` 45/45 (aparta, reintento idempotente, sin pagar no se despacha, pagado sí, todo o nada, cancelar devuelve, otro canal se llevó la última, clientes sin pisar datos). Regresión: cola online 40/40, envíos del día 107/107, Jumpseller 64/64, catálogo 39/39.
- Tienda: base 24/24, compartido 21/21, API 81/81, worker 38/38 (+2 de cola).
- E2E (escritorio y celular): 71/71 — carrito persistente, checkout con validación y foco en el error, transferencia que pasa sola a «¡Pago confirmado!», Mercado Pago aprobado y rechazado con reintento, cuenta (cookie httpOnly), arrepentimiento.
- Lighthouse (celular) en cuenta, carrito y arrepentimiento: accesibilidad 100.
- Hallazgos corregidos: el checkout ofrecía transferencia sin datos bancarios cargados (ahora sólo los medios configurados); el enlace de vuelta de Mercado Pago llevaba el token de acceso al pedido (ya no sale de la tienda); el foco no iba al primer campo con error; columna nueva de Stocker pisada por una clave repetida en `ensureColumns`.

**Hacker**
- Auditoría: 149/149 (37 nuevos: CSRF por origen y cabecera propia, lista cerrada del puente, cookie httpOnly/SameSite, fuerza bruta → 429, pedidos ajenos → 404, precio/cantidades manipulados → 400, registrar pago y rutas internas sin credencial, aviso de MP sin firma o con firma falsa → 401, comprobante SVG/7 MB, arrepentimiento con email ajeno).
- Aislamiento de la base: 25/25. `pnpm audit`: sin vulnerabilidades.

## Etapa 1 · resultados del cierre (28/09/2026)

**QA**
- Stocker: `test-tienda-online.cjs` 39/39 (puerta, catálogo, mismo número que los otros canales, reservas, otro negocio, NOTIFY partido, credencial revocada, sin locales online). Regresión: Jumpseller 64/64, integraciones 23/23, stock por local 36/36.
- Integración real contra el backend de Stocker: catálogo real sincronizado (10 productos, 77 variantes) y una venta registrada en Stocker llegó a la tienda por NOTIFY y actualizó el stock.
- Tienda: compartido 21/21, base 19/19, API 46/46, worker 35/35 (sincronización, stock más viejo no pisa, bajas, slugs estables, SKU reasignado, escucha con reconexión, cliente que no sigue redirecciones, fotos: EXIF/GPS borrado, bomba de píxeles, topes por la base, rollback si falla la subida).
- E2E (escritorio y celular): 55/55 — grilla, filtros en la URL, color en la tarjeta, ficha con color/talle y mensaje de WhatsApp, JSON-LD de producto, búsqueda, 5 rutas inexistentes → 404 con buscador, y **una venta en el local agota la prenda en la tienda en ~2 s sin intervención**.
- Lighthouse celular: categoría 99/100/96/100, ficha 90/100/96/100 (rendimiento/accesibilidad/buenas prácticas/SEO). El 96 es por servir fotos por http en local; en producción salen de R2 por https.
- Hallazgos corregidos: la CSP bloqueaba las fotos (una fuente con ruta sin "/" final sólo coincide con esa ruta exacta); dos enlaces iguales por tarjeta; orden de títulos en la grilla; prioridad de carga repartida entre 4 fotos.

**Hacker**
- Auditoría: 112/112 (38 chequeos nuevos: slugs y búsquedas maliciosas, parámetros duplicados, fotos fuera de su carpeta, XSS reflejado en la búsqueda, ruta de revalidación sin credencial = 404, ningún secreto en HTML/JS, credencial interna falsa no exime del límite).
- Aislamiento de la base: 25/25 (+ `tienda_app` puede escuchar los avisos pero no leer stock, variantes, productos ni credenciales de Stocker).
- Hallazgo corregido: el límite de pedidos por IP habría frenado al propio servidor de la tienda (todas las páginas se piden desde una IP interna) → credencial interna `INTERNO_TOKEN` entre web y API.
- `pnpm audit`: sin vulnerabilidades (se forzó `uuid` ≥ 11.1.1 en una dependencia de desarrollo).
- Carga: catálogo 4.000–5.100 pedidos/s en la API, búsqueda sin caché 880/s, páginas de categoría y ficha ~670/s; 0 errores; máximo 10 conexiones a la base de Stocker.

## Etapa 0 · resultados del cierre (28/09/2026)

**QA**
- Tests de base: 14/14 — migraciones idempotentes, no tocan las tablas de Stocker, dos réplicas migrando a la vez, edición de migraciones detectada, 5 fotos por color, tope del padre con exhibición, color ajeno rechazado, 12 subidas simultáneas → entran exactamente 5, categorías de 2 niveles, auditoría inmutable.
- Tests de API: 25/25 — salud, config con ajuste roto, categorías, errores, CORS, cuerpos, validación, límite de pedidos con y sin proxies.
- Worker: 2/2. Reglas compartidas: 7/7.
- E2E en navegador real (escritorio 1440 y celular Pixel 7): 26/26 — sin errores de consola ni scroll horizontal, menú escritorio y cajón celular, WhatsApp, arrepentimiento visible desde el inicio, legales sin restos de la plantilla de Jumpseller, 404, robots/sitemap, JSON-LD, cabeceras.
- Lighthouse celular: rendimiento 95–97, accesibilidad 100, buenas prácticas 100, SEO 100 (inicio, subcategoría, página legal). CLS 0.
- Hallazgos corregidos durante el QA: el cajón del menú del celular quedaba atrapado dentro del header (backdrop-filter crea un bloque contenedor) → portal a `body`; dos navegaciones con el mismo nombre accesible; contraste del texto tenue 3,2:1 → 4,9:1; áreas táctiles chicas.

**Hacker**
- Auditoría contra los tres servicios: 74/74 — cabeceras, 28 rutas sensibles sin exponer, sin source maps, métodos, 12 cargas de inyección, JSON de 20.000 niveles, prototype pollution, 1 MB, XML con entidad externa, cabecera de 64 KB, 4 orígenes CORS hostiles, ráfaga con IP falsificada → 429.
- Aislamiento de la base: 19/19 — `tienda_app` no puede leer ni borrar tablas de Stocker, crear tablas en `public`, crear roles, leer `pg_authid` ni archivos, ni ejecutar comandos; una consulta colgada se corta a los 10 s.
- Hallazgo corregido: `CREATE SCHEMA IF NOT EXISTS` exigía permiso sobre la base aunque el esquema existiera → con el usuario restringido la API no habría arrancado en producción. El migrador ahora pregunta antes de crear.
- `pnpm audit --prod`: sin vulnerabilidades conocidas.
- Carga (4 núcleos, sin Cloudflare, todo al origen): API ~8.500 pedidos/s con p99 25 ms; HTML de la tienda ~800 páginas/s con p99 115 ms; 0 errores; máximo 3 conexiones a la base de Stocker.
