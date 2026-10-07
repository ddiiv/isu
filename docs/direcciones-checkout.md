# Direcciones en el checkout, aviso del carrito y links de los locales (Etapa 11)

Qué cambió y cómo se usa. Lo anterior del carrito y el checkout sigue en [`carrito-checkout-backoffice.md`](carrito-checkout-backoffice.md).

## 1. La calle con sugerencias (Google)

En el checkout, al escribir la calle aparecen hasta 5 direcciones de Argentina, como en las tiendas grandes:

1. Se escribe «Thames 15…» y abajo aparece «Thames 1500 · Palermo, CABA, Argentina».
2. Al elegirla (con el mouse, el dedo o flechas + Enter) se completan **calle, número, código postal, localidad y provincia**.
3. Si la sugerencia no trae altura (se eligió sólo la calle), el cursor salta al número.

Todo se puede corregir a mano después. Si Google no responde, está apagado o se llegó al tope del día, el campo es uno común y nadie nota nada.

En CABA, la localidad es el barrio («Palermo»), no la comuna.

**La clave de Google vive sólo en el servidor.** El navegador le pregunta a la tienda y la tienda a Google. La clave no aparece en el HTML ni en el JavaScript, y nadie puede usarla desde afuera.

## 2. La revisión con Georef (gratis)

Con calle, número y provincia completos, la tienda le pregunta a **Georef**, el servicio de direcciones del Estado (gratis, sin clave). Puede pasar:

| Qué encontró | Qué ve el cliente |
|---|---|
| La calle y la altura existen | «✓ Encontramos tu dirección.» |
| La calle existe con otro nombre («Corientes» → «Av. Corrientes») o en otra localidad | «¿Tu dirección es **Av. Corrientes 1234, CABA**?» con «Sí, usar esta» y «No, está bien como la escribí» |
| La calle existe pero esa altura no | «No encontramos la altura 99999 en esa calle. Revisá el número; si está bien, seguí igual.» |
| No encontró la calle | «No encontramos esa calle en CABA. Revisá cómo está escrita; si está bien, seguí igual.» |
| Georef no responde | Nada |

**Nunca frena la compra.** Georef no conoce todos los barrios cerrados ni las calles nuevas: el cliente siempre puede seguir con lo que escribió.

## 3. Ajustes → «Direcciones en el checkout»

Hay dos casillas y dos topes:

- **Sugerencias mientras se escribe la calle (Google):** prendida de fábrica. Si falta `GOOGLE_MAPS_API_KEY` en el servidor, lo avisa ahí mismo.
- **Tope por día:** búsquedas y direcciones completadas. Abajo de cada uno dice cuántas se usaron hoy.
- **Revisar que la calle y la altura existan (Georef):** prendida de fábrica.

### Cuánto cuesta Google

Google da **10.000 gratis por mes de cada cosa**:

- **Direcciones completadas** (cuando el cliente elige una): pasadas las 10.000, unos **USD 5 cada 1.000**.
- **Búsquedas:** las que terminan en una dirección elegida no se cobran. Las que no (el cliente escribió y no eligió ninguna) cuentan aparte: 10.000 gratis por mes y después **USD 2,83 cada 1.000**.

**Los topes de fábrica (300 y 300 por día) no pasan nunca del gratis:** 300 × 31 días = 9.300. Alcanzan para unas 50 a 75 direcciones escritas por día. Si la tienda vende más, se suben desde Ajustes; pasado lo gratis, Google cobra a la tarjeta de la cuenta de Google Cloud.

Al llegar al tope, ese día se escribe a mano y al otro día vuelve solo (se cuenta por día de Argentina).

### Cómo sacar la clave de Google (una vez)

1. Entrá a [console.cloud.google.com](https://console.cloud.google.com) con la cuenta de la marca y creá un proyecto («Isuwaya tienda»).
2. **Facturación:** asociá una tarjeta. Google la pide aunque no se pase del gratis.
3. **APIs y servicios → Biblioteca:** buscá **«Places API (New)»** y habilitala. Es la nueva, no «Places API» a secas.
4. **APIs y servicios → Credenciales → Crear credenciales → Clave de API.**
5. **Restringí la clave:**
   - en «Restricciones de API», sólo **Places API (New)**;
   - en «Restricciones de aplicación», **Direcciones IP**, si Railway te da IPs fijas; si no, dejala sin restricción de aplicación (igual vive sólo en el servidor).
6. **Opcional, como red de seguridad:** en **Facturación → Presupuestos y alertas**, un presupuesto de USD 1 con aviso por mail.
7. En Railway, en el servicio de la API (o el único servicio): `GOOGLE_MAPS_API_KEY=AIza…`. **No pongas** `GOOGLE_PLACES_URL` ni `GEOREF_URL`: van las de Google y del Gobierno.

Sin la clave, todo funciona igual: sin sugerencias, pero con la revisión de Georef.

**Atribución:** las sugerencias muestran «Google Maps» abajo de la lista. Google lo exige cuando sus datos se muestran sin un mapa: no hay que sacarlo.

**Privacidad:** la política de privacidad ya dice que la calle y la altura que se escriben pasan por Google Maps y Georef.

## 4. Aviso del carrito: la prenda ya está en un pack

La misma variante suelta y dentro de un pack comparten el stock. Antes, si quedaba 1 «Remera … M / Gris» y ya estaba dentro de un pack del carrito, al sumarla suelta se agregaba y el carrito marcaba en rojo «quedan 1». El cliente tenía que deducir qué hacer.

**Ahora no se agrega y aparece un aviso que lo explica:**

> **Esa prenda ya está en un pack de tu carrito**
> Remera Básica · Talle M · Gris
>
> Queda 1 de esta prenda y ya está en tu carrito:
> 📦 En tu Pack x3 Remera Básica — 1
>
> Mientras esté dentro del pack, no la podés sumar suelta. Si la querés aparte, sacá el pack del carrito o elegí otro talle o color.
>
> [Ver mi carrito] [Elegir otro talle o color]

**Dónde aparece:**

- **Ficha de la prenda:** «Agregar al carrito» y «Comprar ahora». Con «Comprar ahora» tampoco se va al checkout.
- **Página del pack:** si una de sus prendas ya está suelta (u otro pack) en el carrito y no alcanza para armarlo.
- **El «+» del carrito:** si no deja sumar porque esa variante está en otra línea, en vez de quedar apagado sin explicación, muestra el mismo aviso (con «Entendido»).

Si las que quedan están sueltas y no en un pack, el aviso dice «Ya tenés todas las que quedan».

Con 10 o más de una variante, la tienda no muestra el número exacto (nunca lo hizo), así que no avisa antes: el carrito lo controla igual al calcular el total, como siempre.

**Cómo se ve:**

- **En la compu y la notebook:** ventana al centro.
- **En el celular:** hoja que sube desde abajo, con los botones a mano del pulgar.

Se cierra con Escape, tocando afuera o con los botones. Al cerrar, el foco vuelve a donde estaba.

**El «+» del carrito** ahora sabe cuántas quedan descontando lo que va en las otras líneas. Antes, el «+» de una prenda suelta contaba todo el stock, aunque una parte estuviera en un pack.

## 5. Links de los locales

En **Ajustes → Locales**, cada local tiene un campo **«Link del local»**. Va el de Google Maps (en Google Maps: el local → **Compartir → Copiar vínculo**) o cualquier otro link que quieras (Instagram del local, por ejemplo).

- **Si lo pegás sin `https://`** («maps.app.goo.gl/…»), se lo agrega solo al salir del campo.
- **Si el link no sirve**, el campo lo marca en rojo y no deja guardar.
- **«Probar ↗»**, al lado del campo, lo abre para que confirmes que lleva al lugar correcto.

**Dónde se puede tocar en la tienda** (siempre se abre en otra pestaña):

| Dónde | Qué lleva al link |
|---|---|
| **Nuestros locales** | El nombre, la dirección y el botón **«Cómo llegar ↗»** |
| **Checkout**, al elegir «Retiro en el local» | **«Cómo llegar ↗»** debajo de cada local |
| **Ficha de la prenda**, «Retirá gratis en…» | El nombre del local (con varios locales, lleva a la página de locales) |
| **Página del pedido** con retiro | «Cómo llegar ↗» en el aviso y el nombre del local en el resumen |
| **Mails** de pedido recibido y pago confirmado | El nombre del local y, en el texto plano, «Cómo llegar al local: …» |

Un local sin link se ve igual que antes, sin nada para tocar.

**Seguridad:** sólo se aceptan links `https://`. Nada de `javascript:` ni `data:`. Si quedara guardado un link viejo que no cumple, la tienda muestra el local igual, sin el link.

## 6. Para probar en la compu

`pnpm demo:direcciones` levanta Google y Georef simulados (en `http://127.0.0.1:3940`) con unas pocas calles reales:

- **CABA:** Av. Corrientes, Av. Santa Fe, Thames, Bacacay, Av. Rivadavia.
- **Buenos Aires:** San Martín (San Isidro), Belgrano (Quilmes).
- **Córdoba:** Av. Colón.
- **Rosario:** Córdoba.

El `.env.example` ya apunta ahí. Para probar:

- «Thames 1500» → sugerencia → todo completo.
- «Corientes» 1234 → «¿Tu dirección es Av. Corrientes 1234, CABA?».
- Thames 99999 → «No encontramos la altura».

Los datos de muestra (`pnpm demo:fotos`) le ponen link al local de Flores; los de La Salada quedan sin link.
