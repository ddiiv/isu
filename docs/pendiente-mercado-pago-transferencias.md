# Pendiente: transferencias que se confirman solas con Mercado Pago

Lista para hacer cuando haya tiempo. La guía completa está en [transferencias.md](transferencias.md).

La «app de Mercado Libre» que hace falta es la **aplicación de Mercado Pago** del portal de desarrolladores. Es la misma que usa la tienda para cobrar con tarjeta.

## 1. En Mercado Pago (10 minutos)

- [ ] Entrar a **mercadopago.com.ar/developers → Tus integraciones** con la cuenta que va a **recibir las transferencias**. Tiene que ser la dueña del CVU y el alias que se cargan en Ajustes.
- [ ] Si ya hay una aplicación para el cobro con tarjeta, usar esa. Si no, crear una: «Pagos online», producto **Checkout Pro**.
- [ ] **Credenciales de producción** → copiar el **Access token**.
- [ ] **Webhooks → Modo producción**:
  - URL: `https://<API_PUBLICA_URL>/v1/pagos/mercadopago/aviso`
  - Evento: **Pagos**
  - Copiar la **clave secreta** que muestra.

## 2. En Railway (servicio de la API y del worker)

- [ ] Cargar, si todavía no están (si la tarjeta ya cobra con Mercado Pago, ya están):
  ```
  MP_ACCESS_TOKEN=…
  MP_WEBHOOK_SECRET=…
  ```
- [ ] Hacer deploy.

Estas claves van **sólo en Railway**: nunca en el chat, en el repo ni en el `.env` de la compu.

## 3. En el backoffice

- [ ] **Ajustes → Datos para transferir:** titular, CUIT, banco «Mercado Pago», **CVU y alias de esa misma cuenta**.
- [ ] Prender **Mis datos para transferir son de mi cuenta de Mercado Pago** y guardar.

## 4. Probar con una compra chica

- [ ] Hacer un pedido por transferencia.
- [ ] Transferir **el monto exacto, con los centavos** (por ejemplo $ 45.000,37), desde otro banco o billetera.
- [ ] En unos minutos el pedido tiene que pasar a **pagado** solo.

### Si no pasa a pagado

Mirar **backoffice → Transferencias**:

- **Si aparece ahí:** la tienda la vio pero no la pudo asignar. Casi siempre es porque se transfirió sin los centavos. Se asigna a mano con el número del pedido.
- **Si no aparece:** la API de Mercado Pago no está mostrando esa transferencia. Avisar a Claude con cómo se ve la transferencia en el panel de Mercado Pago: se resuelve con los reportes de Mercado Pago.

## Lo que hay que contarle a Claude (sin claves)

- ¿La cuenta de las transferencias es la misma de las tarjetas?
- ¿`MP_ACCESS_TOKEN` ya estaba cargado en Railway?
- Si la prueba falló: qué se vio en backoffice → Transferencias.
