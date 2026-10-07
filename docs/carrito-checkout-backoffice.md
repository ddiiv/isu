# Carrito, checkout y backoffice (Etapa 10)

Qué cambió y cómo se usa. Lo anterior de packs, Liquidación y menú sigue en [`packs-liquidacion-menu.md`](packs-liquidacion-menu.md). Las sugerencias de calle, la revisión con Georef y el aviso «esa prenda ya está en un pack» (etapa 11) están en [`direcciones-checkout.md`](direcciones-checkout.md).

## 1. El pack va aparte en el carrito

Como en Deliver, un pack es **una línea propia**:

- «Pack x5 Remera Baby Tee Midi», con su foto, «📦 Pack · −25 %» y lo que lleva (1× L / Gris Mineral, 3× M / Topo…).
- El **+ / −** suma o quita packs enteros (hasta 10 iguales, o los que alcance el stock).
- Agregar el mismo pack otra vez (mismos talles y colores) suma uno más a esa línea. Uno con otra combinación es otra línea.

**La misma prenda suelta va en otra línea, a su precio**, sin el % del pack. Antes, las unidades sueltas sumaban para el pack; ya no.

**Stock:** se controla con todo lo que se lleva de cada variante, suelta y en packs. Si no alcanza, el carrito lo dice en la línea.

**Cuánto se cobra:**
- Dentro del pack, el % del pack o la rebaja de la prenda: gana el mayor, como antes.
- El cupón y el descuento por transferencia se aplican después.

**Pedido y Stocker:**
- En el pedido, el mail, Mercado Pago y el backoffice, las prendas del pack aparecen como «Remera … (Pack x5)».
- A Stocker llega una línea por SKU con el precio por unidad. Si la misma variante va suelta y en un pack, va el promedio al centavo, y el total del pedido es el exacto.

## 2. Carrito con el precio de cada forma de pago

Abajo del carrito (cajón y página) hay dos botones, como en Deliver:

| Botón | Qué muestra | A dónde lleva |
|---|---|---|
| **Pagar con transferencia** | El total con el % OFF ya aplicado y cuánto ahorra | Al checkout con transferencia elegida |
| **Tarjeta o Mercado Pago** | El total de lista y «Hasta N cuotas sin interés de $X» | Al checkout con Mercado Pago elegido |

El envío se calcula en el checkout. Sale lo que esté prendido en Ajustes → Medios de pago, con el % y las cuotas de Ajustes.

## 3. Checkout de una página

Mismo orden que Deliver:

1. **A la izquierda:**
   - Contacto.
   - Entrega (envío o retiro), dirección y métodos de envío.
   - Pago: cada forma con su precio, y el detalle de la elegida abajo.
   - Notas, términos y el botón **Confirmar compra · $ total** (o «Ir a pagar» con Mercado Pago).
2. **A la derecha (fijo):** el resumen:
   - las prendas con su foto y la cantidad encima, y los packs con lo que llevan;
   - el cupón;
   - subtotal, descuentos, envío y el **Total en ARS**;
   - «Ahorrás $ X» (rebajas, packs, cupón y transferencia).
3. **En el celular:** el resumen va arriba, plegado, con el total a la vista («Mostrar resumen del pedido»).

## 4. Ficha del producto

- **Con stock:** «Agregar al carrito» y **«Comprar ahora»**, que agrega y va directo al checkout. En la página del pack, lo mismo.
- **Sin stock en el color elegido:** «Sin stock» y **«Consultar por WhatsApp»**, con la prenda, el color y el talle en el mensaje.

## 5. Backoffice

### Eliminar productos

Hay dos formas:

- **Productos → elegir → «Eliminar…»**, para varios a la vez.
- **Ficha del producto → «Eliminar».**

Pide confirmación y queda en la Auditoría.

**Qué pasa al eliminar:**
- Sale de la tienda y de las listas del backoffice.
- **Stocker no lo vuelve a publicar**: la sincronización no lo trae de vuelta.
- Los pedidos viejos lo siguen nombrando.

**Para recuperarlo:** Productos → filtro **«Eliminados»** → «Restaurar». Vuelve oculto: se publica a mano.

Un producto eliminado no se puede publicar ni editar hasta restaurarlo; la base de datos tampoco lo deja.

### Diseño

- **Menú lateral oscuro, agrupado:** Ventas, Catálogo, Promociones, Tienda y Administración, con íconos y la tarjeta del usuario abajo.
- **En el celular:** barra arriba y el menú como cajón.
- **Pantallas:** tarjetas, botones, campos y tablas con el mismo estilo, y el panel con indicadores destacados.

### Guías de talles con Excel

En **Guías de talles** hay dos botones nuevos:

- **«Exportar a Excel»:** baja todas las guías, una hoja por guía.
- **«Importar Excel»:** muestra primero qué va a crear o actualizar y qué hojas tienen errores. Recién al tocar «Importar» guarda. Una guía con el mismo nombre se actualiza y sigue asociada a sus productos.

El formato es el de la fábrica:

| Medida | S | M | L |
|---|---|---|---|
| Ancho hombro | 44,5 | 46,5 | 48 |
| Largo prenda | 71 | 74 | 74,5 |

**Las celdas:**
- El nombre de la hoja es el nombre de la guía.
- Cada celda lleva un número (con coma o punto), un rango «44-46», o «-» si no aplica.

**El tipo sale solo de los talles:**
- XS a 5XL: adulto.
- 4 a 16: niños.
- Cualquier otra cosa (1 a 8 de pantalón, «3 (L)»): **talles propios**, en el orden de la hoja.

**Las medidas:**
- Las que se llaman como las del sistema («Contorno de pecho», «Edad») sirven para recomendar el talle.
- Las demás («Ancho muslo», «Bota») son de la prenda y sólo se muestran.

El editor de guías también admite «Talles propios» y medidas con nombre propio.

**Tu archivo** (*Guias_de_Talles_Stocker_Final.xlsx*, 40 guías) se carga solo al subir esta versión, con la migración 0017. No pisa guías que ya existan con el mismo nombre y quedan sin productos: se asocian desde cada guía (Asociar productos).

## 6. Sólo productos padre desde Stocker

A la tienda llegan sólo los **productos padre**.

**Lo que ya filtra Stocker:** deja afuera los productos de evento (feria) y las variantes de pack y combo.

**El filtro extra de la tienda:** si algún producto llegara marcado como evento, pack o combo (`esFeria`, `esEvento`, `esPack`, `esCombo`, `definicionCombo` o un `tipo` que no sea de producto común), se descarta, y si ya estaba, se da de baja. Lo mismo con una variante marcada como pack o combo.

**Los packs de la tienda** se arman sobre la prenda padre: a Stocker sólo le llegan SKU de variantes comunes.
