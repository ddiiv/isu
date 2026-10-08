# Banners interactivos y direcciones sin ids (etapa 12)

Dos cosas de la etapa 12:

1. Los banners del inicio ahora pueden tener texto, botones y la tarjeta de un producto, y vienen armados unos banners sugeridos con lo que dice la tienda.
2. Las direcciones de la tienda y del backoffice ya no muestran números internos (ids): van por el nombre del producto, de la guía o del pedido.

---

## 1. Banners del inicio

Se editan en **Backoffice → Portada**. Se ven en el carrusel de arriba del inicio:

- pasa solo cada 6 segundos (no si la persona pidió menos animaciones);
- se ven los primeros **8** en el orden de la lista.

### Qué puede tener un banner

| Parte | Para qué | Límite |
|---|---|---|
| **Título** | Lo grande del banner. Sin título, el banner es una foto sola (como antes). | 90 letras |
| **Texto** | Una o dos líneas debajo del título. | 220 |
| **Etiqueta** | El cartelito de arriba: «Nuevo», «Hasta 25% OFF». | 40 |
| **Botones** | Hasta 2, cada uno con su texto y a dónde lleva. «Relleno» o «Sólo borde». | 30 letras cada uno |
| **Producto** | La tarjeta de un producto con su foto, su precio y «Ver producto». Puede ser uno elegido, o uno **automático**: el más nuevo, uno en pack, uno en liquidación o uno destacado. | 1 |
| **Color de fondo** | Para los banners sin foto: azul, negro, verde, rojo, crema, rosa o arena. | — |
| **Texto a la izquierda o centrado** | Con producto, el texto va siempre a la izquierda y la tarjeta a la derecha. | — |
| **Fotos** | Una apaisada para la compu (ej. 1920 × 800) y, si se quiere, una vertical para el celular (ej. 1080 × 1350). Con título, el texto va sobre la foto, con un velo oscuro para que se lea. | — |
| **Link del banner entero** | Sólo si no tiene botones ni producto: tocar cualquier parte lleva ahí. | — |
| **Desde / hasta** | Para una promo con fecha. | — |

### Los botones llevan a páginas de la tienda

El selector «Lleva a» trae:

- las páginas fijas: Lo nuevo, Destacados, Packs, Liquidación, Armá tu outfit, Locales e Inicio;
- las categorías y subcategorías visibles (por ejemplo, Mujer › Remeras);
- los packs de cada categoría;
- **«Un producto…»**: se busca por el nombre y el botón lleva a su ficha;
- **«Otra dirección de la tienda…»**: cualquier dirección que empiece con `/`, por ejemplo `/buscar?q=lino`.

Nunca a otro sitio: la API rechaza `https://…`, `//…` y `javascript:`, y la tienda vuelve a revisarlo antes de dibujar el link.

### Datos que salen de Ajustes

Los textos pueden llevar estos datos entre llaves. Toman el valor de Ajustes cada vez, así que el banner nunca queda desactualizado:

| Dato | Qué pone |
|---|---|
| `{descuento}` | el % OFF por transferencia (ej. 20) |
| `{cuotas}` | las cuotas sin interés (ej. 3) |
| `{envioGratis}` | desde cuánto el envío es gratis (ej. $ 80.000) |
| `{packsHasta}` | el % OFF más alto de los packs |
| `{packsMinimo}` / `{packsMaximo}` | cuántas prendas entran en un pack |

- **Para ponerlos:** en el editor, tocar el dato y se agrega donde está el cursor. Al lado de cada uno se ve su valor de hoy.
- **Si hoy un dato no tiene valor** (por ejemplo, no hay envío gratis), el banner no sale en la tienda. La lista lo avisa: «No sale: usa {envioGratis} y hoy no tiene valor en Ajustes».
- **Un dato mal escrito** (`{descuentos}`) no se puede guardar.

### Producto automático

- Elige siempre uno **con stock y con foto**, al precio que muestra la tienda (con sus descuentos).
- Si no hay ninguno (por ejemplo, no hay nada en liquidación):
  - con **«Si no hay ninguno con stock, no mostrar el banner»** marcado, el banner no sale;
  - si no, sale sin la tarjeta.

### La vista previa

- Al tocar **Editar** se ve el banner como en la tienda: el mismo dibujo y los datos ya puestos.
- Con **Compu / Celular** se ve cómo queda en cada pantalla.
- La lista muestra el estado de cada banner:
  - «Se ve en el inicio»;
  - «Apagado»;
  - «Programado»;
  - «Ya terminó»;
  - «No sale: …» con el motivo;
  - «No entra: se ven los primeros 8».

### Banners sugeridos

La migración 0019 carga siete banners armados con lo que la tienda ya dice de sí misma:

| Banner | Texto | Botones | Producto |
|---|---|---|---|
| Nuevos | «Lo último que salió del taller» | Ver lo nuevo · Comprar Mujer | el más nuevo |
| Packs | «Llevá más, pagá menos», hasta {packsHasta}% OFF | Armar mi pack | uno en pack (si no hay, no sale) |
| Transferencia | «{descuento}% OFF pagando con transferencia», hasta {cuotas} cuotas | Comprar Mujer · Comprar Hombre | uno destacado |
| Liquidación | «Liquidación» de fin de temporada | Ver liquidación | uno en liquidación (si no hay, no sale) |
| Envío gratis | «Envío gratis desde {envioGratis}» | Ver novedades | — |
| Outfits | «Armá tu outfit en un minuto» | Armar mi outfit | — |
| Locales | «Vení a probártela»: retiro gratis | Ver locales | — |

- Si al subir esta versión no había ningún banner prendido, quedan prendidos; si ya había, quedan apagados para prenderlos desde Portada.
- **«Agregar banners sugeridos»** vuelve a crear los que se hayan borrado (apagados).

### Sacar una foto

- **«Sacar foto»** (la de compu) deja el banner de texto sobre su color. Se borra también la del celular, que sin la de compu no se usa.
- Un banner sin título necesita la foto: primero hay que escribirle un título.

---

## 2. Direcciones sin ids

### Qué cambió

| Antes | Ahora |
|---|---|
| Fotos: `…/p/139/a1b2c3….webp` (139 = el id del producto) | `…/p/3f9a0c1b2d4e/a1b2c3….webp` (una carpeta al azar) |
| Banners: `…/b/12/….webp` | `…/b/7c0e5d9a1f2b/….webp` |
| Backoffice: `/productos/139` | `/productos/remera-basica-cuello-redondo` |
| Backoffice: `/guias-talles/12` | `/guias-talles/remera-y-top-adulto` |
| Comprobante de un pedido: por su id | `…/pedidos/ISU-1042/comprobantes/1` (el 1.º, el 2.º… de ese pedido) |

- La tienda ya iba por el nombre: `/producto/…`, `/mujer/remeras`, `/pedido/ISU-1042`, `/seguimiento/ISU-1042`.
- Los locales van en `/locales`, sin números.

### Guías de talles

- Cada guía tiene su dirección con el nombre: sin acentos, en minúscula y con guiones. Sale sola del nombre.
- Si dos nombres dan la misma dirección, la segunda lleva `-2`.
- Al cambiarle el nombre, cambia la dirección.
- Una guía que se llame «Nueva» va en `nueva-guia`, porque `/guias-talles/nueva` es la página de crear.

### Links viejos

- **En el backoffice**, un link viejo con el número (`/productos/139`) sigue andando y pasa solo a la dirección con el nombre.
- **Las fotos viejas** (`p/139/…`) siguen andando hasta pasarlas, con el paso de abajo.

### Paso único al subir esta versión: `pnpm fotos:sin-ids`

Las fotos y banners que se suban desde ahora ya van sin el id. Para pasar las que ya estaban, correr una vez, con la versión nueva ya subida:

```bash
pnpm --filter @isu/worker build
pnpm fotos:sin-ids              # copia cada foto a su dirección nueva y cambia la base
pnpm fotos:sin-ids --borrar-viejas   # más adelante: borra los archivos viejos
```

- **Qué necesita:** `DATABASE_URL` y el almacén de fotos (`FOTOS_DIR` o las variables `R2_*`). Con `REDIS_URL`, `WEB_INTERNAL_URL` y `REVALIDAR_TOKEN` regenera también las páginas de los productos que cambiaron.
- **Se puede cortar y volver a correr:** sigue con las que faltan. Una foto que alguien cambió mientras tanto no se toca.
- **Sin `--borrar-viejas`, los archivos viejos quedan:** lo que Google Imágenes o Merchant Center ya tenían guardado sigue andando. Se pueden borrar en unas semanas, cuando Search Console ya muestre las nuevas.
- **Fotos sin archivos:** si una foto vieja no tiene sus archivos, la avisa y queda como estaba.

En Railway: `railway run pnpm fotos:sin-ids` (o desde la consola del servicio) después del deploy. Ver [`subir-a-railway.md`](subir-a-railway.md).

### Lo que sigue llevando números

- **Las respuestas de la API (el JSON)** llevan el id de cada cosa para que el backoffice la edite, pero ninguno va en la barra de direcciones ni en el link de una foto.
- **Los comprobantes de transferencia** se guardan en el almacén privado con el id del pedido en su nombre (`c/…`). Nunca son públicos: sólo se bajan desde el backoffice, con sesión, por el número del pedido.
