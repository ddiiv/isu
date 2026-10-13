# Contrato con Stocker

> ⚠️ **Desde la etapa 1 hasta la 5, este documento describía el parche entregado (`stocker-backend-tienda-acumulado.patch`), que no se aplicó.** Lo que Stocker tiene hoy está en [`contrato-movimientos-stocker-v1.md`](contrato-movimientos-stocker-v1.md).
>
> **Todo habla el contrato v1 de Stocker v3.39:** catálogo, stock y aviso (tanda 1) y pedidos, cobros y novedades (tanda 2). Las dos secciones de abajo son lo vigente; lo que sigue después es la historia del parche.

## Pedidos, cobros y novedades: lo que la tienda manda hoy (contrato v1, Stocker v3.39)

Con el código de Stocker v3.39 (`integracionesController`, `colaVentasOnlineService`, `tiendaService.resoluciones`, `utils/sobreMovimiento`). Lo usa `packages/stocker` (`crearPedido`, `cancelarPedido`, `cargarEnvio`, `registrarCobro`, `resoluciones`).

**El sobre.** Todo lo que se escribe va en `{ contrato: 1, tipo, id: "isu:<n>", ocurrioEn, datos }`. El `id` es la idempotencia: el mismo pedido reenviado lleva siempre el mismo y Stocker lo aparta una sola vez.

| Qué | Ruta | Qué manda la tienda | Qué contesta Stocker y qué hace la tienda |
|---|---|---|---|
| **Apartar** | `POST /pedidos` | `tipo: "venta"`, `id: "isu:ISU-1042"`, `datos: { pedidoExterno, items: [{ sku, cantidad, precioUnitario }], comprador: { nombre, email, documento }, total, pagoPendiente: true, pagoDetalle, pagoVenceEn, envio: { tipo, despacharAntesDe? } }` | **201** aceptado → sigue el checkout. **200** ya lo tenía. **409** rechazado (no apartó nada): el cliente ve qué faltó, leído del `motivo` («A: pide 2 y faltan 1»). **202** lo guardó sin resolver: se reenvía una vez con el mismo `id`; si sigue así, «no pudimos confirmar el stock» (503) y el vencimiento lo cancela. **`parcial`** (un SKU que Stocker no conoce): no se vende incompleto, se cancela en el acto y se pide el catálogo. Un 400 o Stocker caído: 503 y el pedido queda `error_reserva`. |
| **Cobrar** | `POST /cobros` | `tipo: "cobro"`, `id: "isu:ISU-1042-C<pago>"`, `datos: { ventaId: "isu:ISU-1042", importe (pesos), medio, operacion }` | Uno por pago aprobado. **Sin cobro el depósito no despacha.** `aplicado: false` (pedido cancelado, operación repetida) queda escrito en el pedido y en la ficha del backoffice. Cada pago guarda cuándo lo confirmó Stocker (`pagos.stocker_en`, migración `0021`) y el worker reenvía solo lo que no tiene confirmación. |
| **Liberar** | `POST /pedidos/:n/cancelar` | `tipo: "cancelacion"`, `datos: { motivo }` | `{ accion, liberadas, yaSalio }`. 404 = Stocker no lo tiene (nada que liberar). `yaSalio: true` queda anotado en el pedido: si vuelve, entra por devolución. |
| **Etiqueta** | `POST /pedidos/:n/envio` | `{ tipo, seguimiento }` | `{ pedidoExterno, seguimiento, envioTipo, despacharAntesDe }`. Se puede corregir hasta que sale. |
| **Novedades** | `GET /pedidos/resoluciones?desde=&limite=` | el cursor de la vuelta anterior | `{ cursor, cambios, hayMas }`. El worker pregunta cada minuto (`NOVEDADES_CADA_SEGUNDOS`): **despachado** → el pedido sale y se avisa al cliente; **faltante** → queda anotado para que lo vea una persona; **cancelado** → si esperaba el pago, vence ya (y le llega el mail); si ya estaba cobrado, queda marcado para devolver el dinero o volver a apartar. El despacho gana: cancelado y despachado a la vez es despachado. |

- **El cursor** se guarda en `tienda.ajustes` (`cursorNovedadesStocker`) y avanza recién después de aplicar cada tanda: si el worker se cae a la mitad, la próxima vuelta la repite (todo lo que hace es idempotente). La primera vez Stocker no manda historia, sólo el cursor de ahora.
- **«¿Sigue en el depósito?»** (para cancelar un pedido ya cobrado desde el backoffice o con el botón de arrepentimiento): se lee el feed desde ese cursor sin moverlo. Si el feed dice que salió, o Stocker no contesta, o todavía no hay cursor, no se cancela desde la tienda.
- **El plazo de pago** viaja en `pagoVenceEn`. Stocker libera solo lo que no se cobró y **nunca aparta más de 7 días**: los plazos de Ajustes llegan hasta 168 h. Una transferencia «informada» (con comprobante subido) no frena el reloj de Stocker: conviene revisarla antes de que venza.
- **Lo que ya no existe en Stocker** y la tienda dejó de pedir: `GET /pedidos/:n`, `POST /pedidos/:n/pagado`, `PUT /clientes` (el comprador viaja en el pedido: no hay una ruta de datos personales sólo para eso) y el aviso `NOTIFY stocker_tienda_envios` (lo reemplaza el feed, que no se pierde si el worker está caído).
- **En desarrollo** el Stocker simulado (`pnpm demo:stocker`, `scripts/demo/stocker-simulado.mjs`) contesta igual: sobre, 201/200/409/202, `parcial`, cobros con `aplicado`, el feed con cursor y el vencimiento propio de 7 días.

## Catálogo, stock y aviso: lo que la tienda lee hoy (contrato v1)

Formas tomadas de una respuesta real de Stocker (04/10/2026):

- `GET /api/integraciones/tienda/catalogo` → `{ negocio, productos: [{ id, skuAgrupador, titulo, precioMinorista, precioMayorista, descripcion, categoria, modelo, genero, variantes: [{ id, sku, color, talle, precioMinorista, precioMayorista, publicable, activo }] }], truncado, sinLocalesOnline, generadoEn }`.
- `GET /api/integraciones/tienda/stock?skus=A,B` (hasta 200) → `{ stock: { A: 32 }, desconocidos: ["B"], generadoEn }`.
- `NOTIFY stock_cambio, '<negocio>:<variante>'`, uno por variante, también al apartar y al liberar una reserva.

Cómo los usa la tienda (`packages/stocker`, `apps/worker/src/stocker`):

| Stocker | Tienda |
|---|---|
| `id` (producto y variante) | `stocker_id`: la clave que no cambia aunque se corrija un SKU |
| `skuAgrupador` | SKU del producto (`stocker_padre`) |
| `precioMinorista` (pesos) | precio, en centavos. El de la variante pisa el del producto. **El mayorista no se lee.** |
| `publicable` | stock que muestra la tienda. Un negativo (más reservado que stock) cuenta como 0. |
| `activo: false` | la variante no se vende: es como si no viniera, y se desactiva |
| `truncado: true` | la lista vino cortada: se aplica lo que vino y **no se da de baja nada** (se avisa en el log) |
| `generadoEn` | un dato viejo nunca pisa uno nuevo |
| `desconocidos` | **no es «sin stock»**: el stock de esa variante no se toca, se avisa en el log (`[stocker] SKU que Stocker no conoce`) y se pide el catálogo, que la da de baja si de verdad no existe |
| `stock_cambio` | se filtra por negocio, se juntan ~1 s de avisos, la variante se traduce a su SKU y se pide `/stock`. Una variante que la tienda no tiene → catálogo (producto nuevo) |

Lo que sigue abajo es la historia del parche.

La tienda es un canal online más de Stocker, como Mercado Libre y Jumpseller,
y publica **el mismo número**: lo disponible en los locales que abastecen
online, menos reservas y el margen de seguridad de cada variante
(`stockPublicableService`). Stocker es la fuente de verdad del producto, el
precio y el stock; la tienda guarda una copia para no preguntarle en cada visita.

## Etapa 1 (hecho · patch en la rama `backend`)

1. **Origen `tienda`** en las credenciales de integración (`integracionesService.ORIGENES`) y en el backoffice de Stocker (*Integraciones → Tienda online minorista*). La credencial de la tienda sólo abre las rutas de la tienda; la del portal mayorista no las abre, ni al revés.
2. **Rutas** (credencial de máquina, `requireIntegracion('tienda')`, `Cache-Control: no-store`):
   - `GET /api/integraciones/tienda/catalogo` → `{ negocio, generado, sinLocalesOnline, productos: [{ id, sku, titulo, descripcion, categoria, genero, modelo, precio, variantes: [{ id, sku, color, talle, precio, cantidad }] }] }`. Sólo activos, sin feria, sin packs. Color y talle salen del **nombre** del eje (`/color/i`), así que da igual si el producto los tiene al revés. El precio de la variante pisa el del producto. No viaja costo ni precio mayorista.
   - `GET /api/integraciones/tienda/stock?skus=A,B` (hasta 200) → `{ generado, stock: { A: 3, B: 0 } }`. Lo inexistente, inactivo o de otro negocio sale en 0.
   - `generado` se toma **antes** de leer: la tienda lo usa para que un dato viejo nunca pise uno nuevo.
3. **Aviso en tiempo real.** `avisoStockService` (la misma cola que avisa a ML y Jumpseller: agrupa unos segundos y suma los packs afectados) tiene un canal más, `tienda`, activo si el negocio tiene una credencial `tienda` activa. Emite `NOTIFY stocker_stock, '{"b":<negocio>,"s":["SKU",…]}'`, partido en tandas de menos de 8000 bytes. Sin número: la tienda lo pide por la ruta de stock.
4. Prueba: `scripts/test-tienda-online.cjs` (39 chequeos).

### Del lado de la tienda (worker)

- `LISTEN stocker_stock` con reconexión; filtra por negocio; junta ~1 s de avisos → trabajo `stocker/stock` → `GET …/stock` → actualiza `tienda.variantes` sólo si `generado` es más nuevo → tira la caché de la API (Redis pub/sub) y regenera las páginas afectadas (`POST /api/revalidar` de la web).
- Catálogo completo al arrancar, cada `CATALOGO_CADA_MINUTOS` (10) y cuando llega un SKU desconocido (producto nuevo). Sólo escribe lo que cambió.
- **Requisito:** el worker necesita una conexión **directa** a Postgres. Un pooler en modo transacción (PgBouncer) no deja usar LISTEN. En Railway, la URL del Postgres ya es directa.

### Qué pisa la sincronización y qué no

| Campo | Lo manda Stocker | Lo decide la tienda |
|---|---|---|
| Nombre | sí (salvo `nombre_fijo`) | puede fijarlo |
| Descripción | `stocker_descripcion` | `descripcion` propia (tiene prioridad) |
| Categorías | propuesta automática por género y tipo de prenda | corregir (`categorias_fijas`) |
| Slug (URL) | — | se genera una vez y no cambia nunca |
| Colores | nombre y orden | hex de la muestrita, fotos |
| Precio y stock | siempre | — |
| Visible | — | sí (`publicarNuevos` decide si lo nuevo entra visible) |
| Baja en Stocker | se esconde (`en_stocker = false`), no se borra | — |

## Etapa 2 (hecho · patch en `backend` y `frontend`)

- Plataforma `tienda` en `colaVentasOnlineService.PLATAFORMAS`.
- `plataforma_pedidos.pagoPendiente` / `pagoDetalle` (se agregan solas al arrancar, `ensureColumns`). Un pedido con `pagoPendiente` se ve en **Envíos del día** con la marca **SIN PAGAR** y `despachar` lo rechaza (409 `SIN_PAGAR`). ML y Jumpseller quedan en `false`.
- `POST /api/integraciones/tienda/pedidos` `{ pedido: "ISU-1234", items: [{ sku, cantidad, precioUnitario }], comprador, total, pagoPendiente, pagoDetalle }` (etapa 6: `precioUnitario` es lo que se cobró por unidad, con la rebaja y el cupón ya repartidos; el descuento por transferencia sólo baja `total`. Si hubo cupón, `pagoDetalle` lo dice: "Transferencia · cupón VERANO10 (10% OFF) · vence 02/10 14:00") → entra por `encolarYProcesar`. **Todo o nada**: si queda `parcial`, se cancela en el acto y se devuelve `faltantes: [{ sku, pedido, hay }]`. Idempotente por número (`repetido: true`).
- `GET /api/integraciones/tienda/pedidos/:pedido` → estado.
- `POST …/pedidos/:pedido/pagado` `{ detalle }` → levanta la marca (idempotente; 409 si el pedido ya se canceló).
- `POST …/pedidos/:pedido/cancelar` `{ motivo }` → `cancelarPorPlataforma` (devuelve lo apartado; idempotente).
- `PUT /api/integraciones/tienda/clientes` `{ email, nombre, apellido, telefono, dni }` → cliente minorista por email (sin distinguir mayúsculas); lo vacío no pisa lo que Stocker ya tenía; no se pueden tocar tipo, cuenta corriente ni límite.
- Pruebas: `scripts/test-tienda-pedidos.cjs` (45 chequeos).

## Etapa 4 (hecho · patch en `backend` y `frontend`)

La tienda elige el transporte, cotiza y genera la etiqueta con la API de cada correo; **el despacho sigue siendo de Stocker** (Envíos del día), porque ahí la reserva se convierte en egreso de stock.

- `POST /api/integraciones/tienda/pedidos` acepta `envio: { tipo, seguimiento?, despacharAntesDe? }`. `tipo`: `correo_argentino` · `andreani` · `oca` · `mercado_envios` · `cabify` · `retiro` · `envio` (estándar). `despacharAntesDe` (ISO) marca el corte de los envíos en el día (Cabify).
- `POST …/pedidos/:pedido/envio` `{ tipo, seguimiento }` → carga el número de seguimiento cuando la tienda genera la etiqueta. Idempotente; **409 `YA_DESPACHADO`** si ya salió con otro número. `seguimiento`: `^[A-Za-z0-9-]{4,60}$`.
- El resumen del pedido suma `envioTipo` y `envioId`.
- Al despachar (y al marcar faltante) en Envíos del día, Stocker avisa con `pg_notify('stocker_tienda_envios', {"b": negocio, "p": "ISU-…", "e": "despachado" | "faltante"})`. Sólo para pedidos de la plataforma `tienda`. La tienda además repasa cada 15 minutos (`GET …/pedidos/:pedido`, `despachadoEn`) por si se perdió un aviso.
- Frontend: en **Envíos del día** los paquetes de la tienda dicen "Tienda online · ISU-… · Andreani · 3600…" (transporte y número de seguimiento a la vista para armar la caja).
- Pruebas: `scripts/test-tienda-envios.cjs` (17 chequeos). Regresión: tienda-pedidos 45, tienda-online 39, cola 40, envíos del día 107, Jumpseller 64.
