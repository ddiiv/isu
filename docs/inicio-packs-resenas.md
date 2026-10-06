# Inicio, packs y reseñas (etapa 8)

Cómo se usa lo nuevo desde el backoffice y qué ve el cliente.

## 1. El inicio

De arriba hacia abajo:

| Sección | De dónde sale |
|---|---|
| Franja de arriba | El anuncio de Ajustes. Con algo en el carrito y envío gratis configurado, dice «Te faltan $X para el envío gratis». |
| **Carrusel** | Backoffice → **Portada**. Sin banners activos, el título grande de siempre. |
| Beneficios | Envíos, transferencia, cuotas, retiro: salen de Ajustes. |
| Nuevos y en reposición | Casilla «Nuevo» de cada producto. |
| **Packs · Llevá más, pagá menos** | Productos con la casilla «Se vende en pack». Sin ninguno, la sección no aparece. |
| Destacados | Casilla «Destacado». |
| **Para cada uno** (pestañas) | Unas prendas con stock de cada categoría de arriba (Hombre, Mujer, Niños). |
| Armá tu outfit | — |
| Elegí por dónde empezar | Las categorías, con una foto de una de sus prendas de fondo. |
| **Números de la marca** | Ajustes → «Números de la marca» (hasta 4), más el promedio de las reseñas y la cantidad de locales, que se suman solos. |
| Hacemos la ropa que vendemos | — |
| **Lo que dicen quienes compraron** | Las últimas reseñas publicadas con texto (4 y 5 estrellas) y el promedio de **todas**. Sin reseñas, no aparece. |

### Portada (backoffice → Portada)

1. **Banner nuevo:** se escribe qué se ve en la foto y, si se quiere, a dónde lleva (una dirección de la tienda: `/packs`, `/mujer`…).
2. **Foto para compu:** apaisada, por ejemplo 1920 × 800 px (mínimo 600 px de ancho).
3. **Foto para celular (opcional):** vertical, por ejemplo 1080 × 1350. Si no hay, el celular usa la de compu.
4. Las flechas ↑ ↓ cambian el orden. Cada banner se puede apagar o programar con fecha de inicio y de fin.

El carrusel pasa solo cada 6 segundos. Se frena con el mouse encima, y no se mueve si la persona pidió menos animaciones en su teléfono.

## 2. Packs: llevá más, pagá menos

- **Qué prendas.** Productos → casilla **Pack**, en la lista o en la ficha. Se pueden marcar muchas juntas con «Vender en pack».
- **Cuántas y cuánto se descuenta.** Ajustes → **Packs**: el mínimo y el máximo de unidades (2 a 10 de fábrica, hasta 20) y el % por cada cantidad. Por defecto: 10, 15, 18, 20, 21, 22, 23, 24 y 25. Llevando más, el % no puede ser menor. *(Etapa 9: antes era de 2 a 5; el stock, las secciones por categoría y Liquidación están en [`packs-liquidacion-menu.md`](packs-liquidacion-menu.md).)*
- **La página del pack.** `/producto/pack-x2-<prenda>`. Al elegir otra cantidad, la dirección cambia a `pack-x3-…`, `pack-x4-…` y así: se puede compartir. Cada prenda se arma con su talle y su color; «Igual a la anterior» copia la elección y «Copiar la prenda 1 a todas» llena las vacías. Nunca ofrece más de lo que hay en stock.
- **Cómo se cobra.** *(Etapa 10.)* El pack va **aparte** en el carrito, como en las tiendas de referencia: «Pack x5 Remera…» con lo que lleva (1× L / Gris, 3× M / Topo…) y cuántos packs. El % sale de cuántas prendas lleva el pack. Las prendas sueltas, aunque sean la misma, van a su precio y no suman para el pack. El descuento lo calcula la API.
  - **No se suma a una rebaja** de la prenda (Descuentos): gana el mayor.
  - **Un cupón** se aplica después, igual que con una rebaja: un cupón que no vale «sobre rebajas» tampoco vale sobre una prenda en pack.
  - **La transferencia** suma su % al final, como siempre.
- **En el carrito** el pack es una línea con su foto, «📦 Pack · −15%», lo que lleva y el precio de antes tachado; se suman o se quitan packs enteros. Stocker recibe el precio por unidad ya con el descuento (si la misma variante va suelta y en un pack, el promedio al centavo; el total del pedido es exacto).

## 3. Descripción de la ficha

Ni Stocker ni el sitio mayorista tienen descripciones. Por eso la ficha **siempre** muestra una:

- la que se escribe en el backoffice (Productos → la prenda → Descripción); o
- si no hay, una armada con lo que se sabe de verdad: nombre, composición, colores y talles.

Además, en un desplegable:

| Desplegable | De dónde sale |
|---|---|
| **Composición y cuidados** | Campo «Composición» de cada prenda, más los cuidados generales de Ajustes → Ficha de producto |
| **Cambios y devoluciones** | 30 días, con enlaces a la política y al botón de arrepentimiento |

Para encontrar las que faltan: Productos → filtro «Sin descripción».

## 4. Reseñas

### Quién opina

**Sólo quien compró y recibió el pedido.** No hay un formulario abierto, así que no se pueden escribir reseñas falsas ni de la competencia.

1. Unos días después de entregado o retirado (Ajustes → Reseñas, por defecto 4), sale un mail: «¿Qué te pareció tu compra?».
   - Trae cinco estrellas para tocar.
   - El enlace va firmado con el número de pedido.
   - Sale una sola vez por pedido. Los pedidos cerrados hace más de 30 días no lo reciben.
2. En la página para opinar (`/opinar/ISU-…`), por cada prenda se ponen las estrellas, cómo le quedó el talle (chico, justo o grande) y, si quiere, unas palabras. También puede puntuar la compra en general.
3. Desde «Mi pedido», un pedido ya entregado tiene el botón **Opinar**.

Se publica con el nombre y la inicial del apellido («Ana G.»), con la marca **Compra verificada** y el color y talle que compró.

### Moderar (backoffice → Reseñas)

- Entran **por revisar**. Desde ahí se **publican**, se **rechazan** o se **responden** (la respuesta se ve debajo, como «Respuesta de Isuwaya»).
- Se pueden publicar varias juntas.
- El panel muestra cuántas hay por revisar.
- Ajustes → Reseñas → **Publicarlas sin revisar**: entran publicadas directamente.

**Rechazá sólo lo que no se puede mostrar:** insultos, datos personales o algo que no es de la compra. Esconder las malas no conviene, por dos razones:
- una tienda con todas 5 estrellas no le parece creíble a nadie, y responder bien una mala vende más que esconderla;
- mostrar sólo opiniones elegidas como si fueran todas es engañoso para la ley de defensa del consumidor.

### Dónde se ven

- **Tarjetas:** estrellas y cantidad.
- **Ficha:**
  - arriba, el promedio, que lleva a las opiniones;
  - abajo, el promedio, cuántas de cada puntaje, qué dicen del calce y la lista, que se puede ordenar y ver de a 10.
- **Inicio:** al final.
- **Google:** las estrellas van en los datos estructurados de la ficha (sólo si hay reseñas publicadas).
