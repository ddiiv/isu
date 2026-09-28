# Arquitectura

## Principios

1. **Stocker es la fuente de verdad** del stock, los precios y las ventas. La tienda nunca calcula stock: lo pregunta.
2. **Lo público es estático.** Las páginas de catálogo se generan de antemano y se revalidan cada minuto; Cloudflare las sirve desde su caché. Un pico de tráfico pega en el CDN, no en la base.
3. **Una sola puerta a los datos.** Sólo la API habla con la base y con Stocker. La tienda y el backoffice le piden todo a la API.
4. **Lo lento va en segundo plano.** Correos, Mercado Pago, avisos: por cola (BullMQ), con reintentos. El cliente nunca espera a un tercero.

## Servicios en Railway (mismo proyecto que Stocker)

| Servicio | Qué es | Dominio |
|---|---|---|
| `tienda-web` | Next.js standalone, 2 réplicas | `www.isuwaya…` (vía Cloudflare) |
| `tienda-api` | Fastify, 2 réplicas, migra al arrancar (con candado) | `api.isuwaya…` (vía Cloudflare) |
| `tienda-admin` | Next.js | `admin.isuwaya…` (Cloudflare Access) |
| `tienda-worker` | BullMQ | sin dominio |
| Redis | plugin de Railway | red privada |
| **Postgres de Stocker** | compartido: la tienda usa el esquema `tienda` con el usuario `tienda_app` | red privada |
| **backend de Stocker** | la API de la tienda le habla por `*.railway.internal` | red privada |
| **pedidos mayoristas** | el portal existente; comparte proyecto y red | el suyo |

### La base compartida

- Esquema propio `tienda`; usuario propio `tienda_app` (`infra/sql/rol-tienda.sql`) **sin permisos sobre `public`** (las tablas de Stocker). Probado en `tests/seguridad/aislamiento-db.mjs`: no puede leer ni borrar tablas de Stocker, crear roles, leer archivos ni ejecutar comandos.
- Pool chico (10 por réplica) con `statement_timeout` de 10 s y techo de 30 conexiones para el rol: la tienda nunca le come las conexiones a Stocker. En la prueba de carga (8.500 pedidos/s a la API) usó como máximo 3.
- Migraciones en SQL plano con candado (`pg_advisory_lock`) y checksum: nunca corren dos a la vez y no se pueden editar una vez aplicadas.

## Fotos

- **color**: la prenda sola (estirada/percha) de un color → máximo 5 por color. Es la que se ve al elegir el color y la muestra del selector.
- **exhibición**: con modelo, para la galería → color opcional (el que lleva puesto).
- Tope del producto padre = 5 × cantidad de colores, contando las dos clases.
- Las reglas viven en la base (trigger con bloqueo por producto: dos subidas simultáneas no se saltean el tope) y se repiten en `@isu/shared` para avisar antes en pantalla.
- Archivos en Cloudflare R2, servidos por CDN en AVIF/WebP.

## Pagos (etapa 2)

| Medio | Cómo funciona |
|---|---|
| Mercado Pago (tarjeta, cuotas, dinero en cuenta) | Checkout de MP. El pedido se confirma sólo con el webhook firmado (se verifica la firma y se consulta el pago a MP; nunca se confía en la redirección del navegador). Idempotente por `payment_id`. |
| Pago Fácil / Rapipago | Medios en efectivo de Mercado Pago (ticket). El pedido queda "esperando pago" hasta que MP avisa la acreditación; vence a los N días y libera el stock. |
| Transferencia | El cliente ve CBU/alias y el total con descuento; **API para registrar el pago** (`POST /v1/pedidos/:id/transferencia` con comprobante e importe) → el pedido pasa a "verificando pago" y el cliente ve "Aguardá un momento, estamos confirmando tu transferencia". Se confirma desde el backoffice o por conciliación automática; vence a las 48 h sin comprobante. |
| Pago en el local | Reserva con vencimiento; se cobra al retirar (Stocker registra la venta en el local). |

En todos los casos el stock se aparta en Stocker al confirmar el pedido (cola de ventas online) y se libera si vence o se cancela.

## Sincronización con Stocker (etapa 1)

Ver [contrato-stocker.md](contrato-stocker.md).
