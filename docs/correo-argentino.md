# Correo Argentino con MiCorreo (etapa 15)

La tienda usa la **API MiCorreo**, la que Correo Argentino da para tiendas online (el manual «Correo Argentino - API MiCorreo», versión del 18/05/2026). La API **PaqAr** es para sistemas de gestión (ERP): no se usa.

## Qué hace la tienda con MiCorreo

| Paso | Cómo |
|---|---|
| **Cotizar antes de pagar** | En el checkout, con el código postal, la tienda le pregunta a MiCorreo cuánto sale a domicilio y a sucursal (una sola consulta trae los dos) y lo muestra con el plazo. Se cobra el **Clásico**. Lo que pasa de 50 kg o de las medidas que acepta Correo no se ofrece. |
| **Sucursales** | Sólo las abiertas donde se puede retirar, con su horario, las más cercanas primero. |
| **Generar el envío** | Backoffice → Envíos → «Preparar»: lo carga en MiCorreo con el remitente, el destinatario, la dirección o la sucursal, el peso, las medidas y el valor declarado con que se cotizó. |
| **El rótulo (la etiqueta)** | **La API de MiCorreo no lo devuelve**: no tiene ningún pedido para el rótulo, y al cargar el envío sólo contesta la fecha. El envío cargado aparece en MiCorreo, donde **se paga y se imprime el rótulo**. El backoffice tiene el botón «Pagar e imprimir en MiCorreo». |
| **El número de seguimiento** | Sale en el rótulo. Se carga en Envíos → Etiquetados, a mano o con un lector de códigos de barras (lee el código del rótulo y aprieta Enter solo). La tienda le pregunta a MiCorreo si lo conoce y avisa si parece mal escrito. Se puede corregir hasta que el paquete sale. |
| **Seguimiento** | Con el número, el envío se sigue solo (cada 10 minutos el worker le pregunta a MiCorreo) y el cliente recibe los avisos de siempre (mail y WhatsApp). Stocker lo muestra en Envíos del día. |

> **Si querés que el rótulo salga directo desde la tienda** (sin pasar por MiCorreo), Correo Argentino lo da sólo por **PaqAr**, que pide un acuerdo comercial con Correo. Con ese acuerdo se puede sumar como opción.

### En el día a día

1. **Envíos → Para preparar**: elegí los pedidos y «Preparar envíos». Los de Correo quedan **cargados en MiCorreo**.
2. **Envíos → Etiquetados**: los de Correo dicen «Falta el número del rótulo».
   - Entrá a MiCorreo (el enlace está ahí mismo), andá a los envíos importados, **pagalos e imprimí los rótulos**.
   - Pegá cada rótulo en su bolsa y cargá su número en la tienda (con el lector: un «bip» por paquete).
3. Despachalos desde **Envíos del día en Stocker**, como siempre.
4. Si un paquete salió sin el número cargado, aparece en **Problemas** hasta que se cargue (el cliente no lo puede seguir).
5. **Descartar** un envío de Correo: borralo también de los importados en MiCorreo, para no pagarlo dos veces. Al volver a prepararlo se carga con otra referencia.

## Todo en una bolsa (para todos los transportes)

- **Cada producto lleva su peso y sus medidas**: la prenda doblada, como va en la bolsa (alto = el grosor).
  - Backoffice → Productos → filtro **«Sin peso o medidas»**: elegís varios y **«Peso y medidas…»** los carga de una vez.
  - En la ficha de cada producto, la tarjeta «Peso y medidas para el envío»: no se guarda el producto sin los cuatro datos.
  - El panel cuenta los publicados que todavía no los tienen.
- **Todo el pedido viaja en una sola bolsa:** las prendas se apilan (si la pila queda muy alta, en 2 o 3 pilas una al lado de la otra) y se elige la bolsa más chica en la que entran. El peso es el de las prendas más el de la bolsa.
- Las bolsas se cargan en **Ajustes → «Paquete: todo en una bolsa»** (nombre, ancho, largo y peso). Debajo se ve el ejemplo de cuál usa con 1, 3, 6 y 12 prendas.
- Con ese paquete cotizan **todos** los transportes (Correo, Andreani, OCA, Mercado Envíos, Cabify). El pedido guarda el paquete con que se cotizó: la etiqueta sale con los mismos datos que se cobraron, y Envíos dice en qué bolsa va cada pedido.
- Un producto sin peso o medidas cotiza con la **prenda por defecto** de Ajustes (para no frenar una venta), pero conviene cargarlos todos.

## Datos de los clientes

Los datos de un cliente (nombre, email, teléfono, DNI, dirección) los ve **sólo**:

- **el cliente**: con la sesión de su cuenta, o con el enlace de su pedido que le llega por mail. El seguimiento público (el enlace firmado del aviso) muestra sólo el nombre de pila y el envío; el chat pide número de pedido y email, y responde sólo el estado;
- **alguien del backoffice identificado**: usuario, contraseña y doble factor. Imprimir etiquetas, cargar o generar envíos pide el rol **operador** o más.

Cada vez que alguien del backoffice abre datos de clientes (un pedido, la lista de pedidos, de clientes o de envíos) queda en **Auditoría → «Quién vio datos de clientes»**: quién, qué, cuándo y desde qué IP (una vez por persona, dato y hora). A Correo le llegan sólo los datos que necesita para el envío.

## Configuración

| Variable | Qué es |
|---|---|
| `CORREO_AR_USUARIO` / `CORREO_AR_CLAVE` | Usuario y clave de la API MiCorreo. Los da Correo Argentino (son distintos para pruebas y producción). |
| `CORREO_AR_CLIENTE` | Tu n.º de cliente de MiCorreo (`customerId`). Se saca con `pnpm correo:cliente`: pide el email y la contraseña de la cuenta de MiCorreo de la tienda (la contraseña no se ve ni se guarda). |
| `CORREO_AR_URL` | Producción: `https://api.correoargentino.com.ar/micorreo/v1` (por defecto). Pruebas: `https://apitest.correoargentino.com.ar/micorreo/v1`. |
| `CORREO_AR_PORTAL` | Opcional: a dónde lleva el botón «Pagar e imprimir en MiCorreo» (por defecto, MiCorreo). |

Van en la API y en el worker (o una sola vez, si es un solo servicio). La cotización toma como origen la sucursal de tu cuenta de MiCorreo; el remitente de los envíos es el de Ajustes → Remitente.

### Homologar antes de vender

Con las credenciales de **pruebas** y `CORREO_AR_URL` de pruebas:

1. `pnpm correo:cliente` → anotá el n.º de cliente.
2. Una compra de prueba a domicilio y otra a sucursal: el checkout tiene que mostrar el precio de Correo.
3. Prepararlas en Envíos: tienen que aparecer en los importados de MiCorreo (pruebas).
4. Cargar el número de un rótulo de prueba y ver que el seguimiento responda.

## En desarrollo

`pnpm demo:transportes` levanta el simulador, que habla como el manual (los mismos campos, límites y mensajes de error). En `http://127.0.0.1:3920/correo/portal` hace de MiCorreo: muestra lo cargado y «Pagar e imprimir rótulo» le da el número.
