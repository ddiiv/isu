# Recordatorio de carritos abandonados (sólo por mail)

Quien deja el checkout sin terminar y **marcó el tilde** recibe un solo mail, a las 2 horas, con lo que dejó en el carrito. A cada dirección se le manda **uno solo cada 90 días**, y la tienda manda **como mucho 300 por día**.
Sin WhatsApp, sin tilde marcado de fábrica, sin Analytics ni datos del mail hacia Google.

## Cómo funciona

1. **Checkout** (`Checkout.tsx`): un tilde sin marcar: «Quiero recibir un recordatorio por mail si dejo mi compra sin terminar. Puedo darme de baja cuando quiera.», con link a `/privacidad`. Sólo con el tilde marcado y un mail válido, al salir del campo de mail (y 1,5 s de espera) se llama a `POST /v1/carrito-recordatorio`; vuelve a llamar sólo si cambia el mail o el carrito. Desmarcar el tilde deja de mandar actualizaciones (no da de baja: eso es desde el mail).
2. **API** (`apps/api/src/modulos/carritos/rutas.ts`):
   - `POST /v1/carrito-recordatorio {email, items:[{sku,cantidad}], acepto:true}`: valida el mail como el checkout, exige `acepto: true` literal, descarta los SKU que no existen (máx. 30 líneas, 20 unidades por línea), guarda un registro por mail. Contesta **204 siempre** que el pedido sea válido (exista o no el mail; con la tienda apagada también, sin guardar nada). Quien ya se dio de baja **no se vuelve a anotar**.
   - `POST /v1/carrito-recordatorio/baja {token}`: marca la baja y borra los items. 204 aunque el token no exista.
   - Al crear un pedido (`POST /v1/pedidos`, una vez que Stocker apartó la mercadería) el carrito de ese mail queda `convertido_en` y sin items. Si esa consulta falla, el pedido sigue (queda en el log de la API).
   - Quien ya recibió el recordatorio no vuelve a recibir otro (ni se le guardan items nuevos) hasta 90 días después de ese mail.
   - Frenos por Redis: 30 por hora por IP en cada ruta y 20 por hora por mail.
3. **Worker** (`apps/worker/src/correo/carritos.ts`, trabajo `envios/carritos-abandonados`, cada 10 minutos):
   - Elige los carritos con `actualizado_en` de hace más de 2 h, sin `recordado_en`, `convertido_en` ni `baja_en` y con items; los marca `recordado_en = now()` y **vacía los items** en la misma consulta (`FOR UPDATE SKIP LOCKED`): un reintento o dos réplicas nunca mandan dos mails. Además el trabajo de mail lleva un id fijo por carrito (`carrito-<id>`).
   - **Tope diario global**: `TOPE_DIARIO_CARRITOS = 300` (en `carritos.ts`), contado en la propia tabla por `recordado_en` desde las 0 h de Argentina. Lo que exceda queda pendiente para el día siguiente.
   - Si encolar una fila falla, esa fila vuelve a quedar pendiente (con sus items) y las demás salen igual.
   - Recalcula cada línea con la base: nombre, foto, color/talle y **precio de hoy** (con el descuento masivo vigente), sólo las que tienen stock. Si no queda ninguna, marca igual y no manda.
   - Encola el mail `carrito_abandonado` (botón «Volver a mi carrito» a `/carrito`; al pie, el enlace de baja a `/baja-recordatorios#t=<token>`; cabecera `List-Unsubscribe` con ese mismo enlace https). El texto no afirma nada de quien lo recibe: «Alguien pidió en isuwaya.com que te recordemos este carrito. Si fuiste vos, podés volver a él; si no, ignorá este mail o dá de baja acá».
   - **Antes de mandar** (`enviar.ts`), el procesador vuelve a mirar la tabla: si ya hay baja o compra (o el registro no está), descarta el mail sin error. Cubre los reintentos con espera.
   - No manda ni marca nada con la tienda apagada, sin `SMTP_URL` o sin `SITIO_URL`: queda pendiente hasta que vuelva.
   - **Purga** (siempre, aunque la tienda esté apagada): borra los sin recordar a los 7 días; los ya recordados (sin items) a los 90 días del mail; los de baja, a los 90 días de la baja.
4. **Baja** (`/baja-recordatorios#t=…`): el token va en el fragmento de la URL (como el de restablecer clave): no llega al servidor, a los logs ni a Analytics. El componente cliente lo lee y lo borra de la barra de direcciones; también acepta `?t=` de mails viejos. La página sólo muestra el botón «Confirmar baja»; la baja la hace el botón con un POST (un robot de mail que abre los links no da de baja a nadie). Está abierta con la tienda apagada y con `noindex`.

Un solo mail por dirección cada 90 días, cambie o no el carrito.

## Qué se guarda y por cuánto tiempo

Tabla `tienda.carritos_abandonados` (migración 0024): el mail (en minúscula, único), la lista de `{sku, cantidad}`, un token de baja al azar de 256 bits y las fechas (creado, actualizado, recordado, convertido, baja). **Nada de pago, dirección, nombre ni teléfono.**

| Situación | Cuánto se guarda |
| --- | --- |
| Carrito anotado y todavía sin recordar (comprado o no) | 7 días desde la última actividad |
| Ya recordado | 90 días desde el mail, **sin items**: sólo queda el mail y las fechas, para no mandar otro antes |
| Baja | 90 días desde la baja (sólo el mail y la fecha, sin items), para que reenviar el mismo carrito no la vuelva a anotar |

Al comprar, darse de baja o recibir el recordatorio, los items se borran en el acto. Los logs no llevan mails.

## Cómo probarlo con tu mail

1. Levantá la tienda con un SMTP (en local, Mailpit: `SMTP_URL=smtp://localhost:1025`) y con `SITIO_URL`.
2. Agregá algo al carrito, andá al checkout, escribí tu mail, salí del campo y marcá el tilde (un instante después ya está en la base).
3. Hacé que pasen las 2 horas: `UPDATE tienda.carritos_abandonados SET actualizado_en = now() - interval '3 hours' WHERE email = 'vos@ejemplo.com';`
4. En a lo sumo 10 minutos llega el mail. Para no esperar, encolá a mano `envios/carritos-abandonados` en la cola `envios`.
5. Probá el botón del mail (abre la página; el mail no se da de baja hasta que tocás «Confirmar baja»), y que volver a anotar el mismo mail no lo reactiva.
6. Para repetir la prueba: `DELETE FROM tienda.carritos_abandonados WHERE email = 'vos@ejemplo.com';` (sólo tu fila).

## Límites conocidos y riesgos aceptados

- No hay doble confirmación: alguien podría escribir el mail de otra persona y marcar el tilde. Lo acotan el freno por mail y por IP, **un solo mail por dirección cada 90 días**, el tope global de 300 por día, el texto neutro del mail, que sólo lleva prendas (ningún dato personal) y la baja a un clic. Si se quiere eliminar el riesgo, el paso siguiente es un mail previo de confirmación (doble opt-in).
- Los packs se anotan como prendas sueltas: el mail muestra el precio de cada prenda, no el del pack.
- Redis: el trabajo de mail en la cola `notificaciones` lleva el mail del destinatario y se conserva hasta 24 h (7 días si falla), y la clave del freno por mail (`isu:freno:carrito-rec-email:<mail>`) dura 1 h. Es lo mismo que ya pasa con los demás mails de la tienda; se acepta.
- El token de baja de los mails se guarda en claro en la tabla (hace falta para armar el enlace); es de 256 bits al azar y se busca por un índice único.

## Texto propuesto para la política de privacidad

> **Recordatorio de carrito (opcional).** Si en el checkout marcás la opción «Quiero recibir un recordatorio por mail si dejo mi compra sin terminar», guardamos tu email y las prendas de tu carrito (modelo y cantidad) para mandarte, a las 2 horas, un único mail recordándotelo. No guardamos datos de pago ni de entrega para esto. Lo hacemos sólo con tu consentimiento, que podés retirar cuando quieras con el enlace «No quiero más recordatorios» de ese mail. Borramos el carrito cuando comprás o te das de baja, y de todos modos a los 7 días. Si te das de baja, conservamos tu email, sin carrito, hasta 90 días sólo para no volver a anotarte por error si se reenvía el mismo carrito. No compartimos estos datos con terceros salvo el servicio de envío de correo que usamos para mandarte el mensaje.
