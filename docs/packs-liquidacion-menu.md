# Packs de 2 a 10, Liquidación y el menú del celular (Etapa 9)

Qué hay y cómo se maneja desde el backoffice. Lo de la Etapa 8 (inicio, descripción, reseñas) sigue en [`inicio-packs-resenas.md`](inicio-packs-resenas.md).

## 1. Packs armados sobre la prenda

Los packs **no salen de Stocker**. Los packs armados de Stocker siguen sin llegar a la tienda (el contrato es «sin packs»). Un pack de la tienda es la **prenda padre** (por ejemplo CAIRO) vendida en cantidad. Usa las mismas fotos y el mismo stock, con la página de pack: se elige cuántas y, para cada una, el talle y el color.

### Qué prendas

Productos → casilla **Pack**, en la lista o en la ficha. Se pueden marcar muchas juntas con «Vender en pack». Nada más: el pack se arma solo con las variantes que tenga la prenda.

### Cuántas y cuánto se descuenta

Ajustes → **Packs**:

| Campo | De fábrica | Qué hace |
|---|---|---|
| **Mínimo** | 2 | La cantidad más chica que se ofrece |
| **Máximo** | 10 | La más grande (hasta 20) |
| **% por cantidad** | 2 → 10 %, 3 → 15 %, 4 → 18 %, 5 → 20 %, 6 → 21 %, 7 → 22 %, 8 → 23 %, 9 → 24 %, 10 → 25 % | Un casillero por cantidad. Llevando más, el % no puede ser menor (como mucho 60 %) |

Al cambiar el mínimo o el máximo, los casilleros se agregan o se quitan solos. *(Etapa 10: en el carrito el pack va aparte; las prendas sueltas de la misma prenda van a su precio y no suman para el pack.)*

> Al subir esta versión, la migración 0015 pasa el ajuste viejo (x2 a x5) al nuevo. Si tenía los % de fábrica, quedan los nuevos de 2 a 10. Si los había cambiado, se respetan y de 6 a 10 se repite el de x5. Revisalos en Ajustes → Packs.

### La página del pack

La dirección es `/producto/pack-x4-<prenda>`, y cambia sola al elegir otra cantidad (se puede compartir).

- **Arriba, las cantidades** (x2 … x10) con su % y la etiqueta «+ barato» en la más grande.
- **Cada prenda con su talle y su color.** Primero el talle, después los colores que hay en ese talle. «Igual a la anterior» copia la elección, y **«Copiar la prenda 1 a todas»** llena las vacías.

### El stock

Se mira el stock de la prenda padre y de cada variante:

- **No se ofrece más de lo que hay.** Si entre todas las variantes quedan 6, x7 a x10 aparecen apagadas y el texto dice «hay stock para 6 como máximo». Una dirección con más (`pack-x10-…`) baja sola a la que se puede.
- **Una variante deja de ofrecerse** cuando las otras prendas del pack ya se llevaron todas las que hay. Por ejemplo: de la negra en M quedan 3 y ya se eligieron 3. En la prenda 4, ese color aparece apagado («no quedan más»), o el talle entero si no tiene otro color.
- «Copiar la prenda 1 a todas» copia hasta donde alcanza. Las que faltan quedan para elegir con otro talle o color, y lo avisa.
- Si no hay stock ni para el mínimo, la página lo dice y lleva a la prenda suelta.
- Al pagar, el carrito y Stocker vuelven a controlar el stock, como siempre.

### Dónde se ven

- **Barra de arriba (compu):** **Packs** con un desplegable por categoría (Packs Hombre, Packs Mujer, Packs Niños) y «Todos los packs».
- **Celular:** el acceso **Packs** abre el menú en el panel de packs, por categoría.
- **`/packs`:** una sección por categoría, con «Ver todo». Arriba hay botones para filtrar: Todo, Hombre, Mujer, Niños.
- **`/packs/hombre`, `/packs/mujer`, `/packs/ninos`:** la grilla entera de esa categoría (con sus subcategorías), con filtros.
- En cada categoría aparece sólo si tiene alguna prenda pack con stock.
- Una prenda en dos categorías (unisex) sale en las dos.

## 2. Liquidación

Prendas de la temporada anterior (o las que se elijan) a precio más bajo, en su propia sección.

### Cómo se manda algo a Liquidación

Hay dos formas:

1. **Descuentos → Descuento nuevo**, con la casilla **«Es liquidación»**. Funciona como cualquier descuento: % por todo, por categorías o por productos, con fechas si se quiere. Sus prendas salen en Liquidación mientras el descuento esté activo y en fecha.
2. **Productos → seleccionar → «Mandar a Liquidación…»:** pide el % y crea ese descuento con las prendas elegidas (lo podés editar después en Descuentos).

**Para sacar algo de Liquidación:** apagá o borrá el descuento, o sacale la casilla «Es liquidación». Si se le saca la casilla, la rebaja sigue, pero sale de la sección.

### Qué se ve

- **Barra de arriba:** **Liquidación**, con desplegable por categoría.
- **`/liquidacion`** y **`/liquidacion/mujer`**, igual que Packs.
- **Tarjetas:** la etiqueta **Liquidación** junto al −%.
- **Ficha:** un botón **Liquidación** arriba del nombre.
- Sólo aparecen prendas **con stock**. Si no hay nada en liquidación, la sección no se muestra en el menú.
- Si una prenda tiene dos rebajas, se cobra la mayor (como siempre). Sale en Liquidación si alguna de sus rebajas activas es de liquidación.

## 3. Menú del celular

Al tocar **Hombre**, **Mujer** o **Niños** (en el menú ☰ o en los accesos de abajo del logo) se abre su panel:

- **Sus subcategorías** (Remeras, Pantalones…) y «Ver todo Mujer».
- **Atajos** a «📦 Packs Mujer» y «Liquidación Mujer», si hay.
- **1 o 2 fotos de prendas que representan la categoría**, con su nombre y enlace a la ficha.
- **«‹ Menú»** vuelve al menú. **Escape** vuelve y, desde el menú, cierra.

En la compu, el desplegable de cada categoría muestra lo mismo: subcategorías, atajos y las 2 fotos.

**Qué fotos aparecen**, en este orden: las **destacadas** de esa categoría (en el orden de Destacados), después las **nuevas** y después las últimas que entraron. Siempre con foto y con stock. Para elegir cuáles salen, marcalas como destacadas (Productos → Destacado).

## 4. Envío gratis desde cierto monto

Ajustes → **Envío gratis desde** (por ejemplo $ 80.000). Con eso:

- **En la ficha** (prenda y pack), abajo del botón: «🚚 Te faltan $ X para el envío gratis», con una barra que se llena según lo que ya hay en el carrito, y «Envío gratis desde $ X». Con el carrito por encima: «¡Tenés envío gratis!».
- **En el carrito y en el anuncio de arriba**, como antes.
- **En el checkout**, el envío sale $ 0 cuando el total llega al monto. Se cuenta lo que se paga: con las rebajas, el cupón y el descuento por transferencia ya restados.

Sin monto cargado, la barra no aparece.
