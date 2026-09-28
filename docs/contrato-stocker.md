# Contrato con Stocker (etapa 1)

La tienda es un canal online más de Stocker, como Mercado Libre y Jumpseller.
Stocker ya tiene la maquinaria: `stockPublicableService` (lo disponible en los
locales que abastecen online, menos reservas y margen, packs incluidos) y la
cola de ventas online (`colaVentasOnlineService`: aparta en orden de llegada,
idempotente, rechaza lo que ya no hay). Falta exponerla para la tienda.

## Cambios en Stocker (patch en la rama `backend`)

1. **Plataforma `tienda`** en `colaVentasOnlineService.PLATAFORMAS` y origen `tienda` en las credenciales de integración (`integracionesService.ORIGENES`).
2. **Rutas con credencial de máquina** (`requireIntegracion('tienda')`), sólo por red privada:
   - `GET  /api/integraciones/tienda/catalogo` → productos visibles, variantes (SKU, color, talle), precios y **cantidad publicable** (el mismo número que se manda a ML y Jumpseller).
   - `GET  /api/integraciones/tienda/stock?skus=…` → cantidades publicables actuales (para el carrito y el checkout).
   - `POST /api/integraciones/tienda/pedidos` → encola el pedido pagado (o reservado) en la cola de ventas online. Idempotente por número de pedido de la tienda.
   - `POST /api/integraciones/tienda/pedidos/:id/cancelar` → libera la reserva (pago vencido, arrepentimiento).
   - `PUT  /api/integraciones/tienda/clientes` → alta/actualización del cliente por DNI/CUIT/email (identificación en Stocker).
3. **Aviso de cambio de stock en tiempo real.** Como la base es compartida, Stocker emite `NOTIFY stock_cambio, '<businessId>:<variantId>'` en cada movimiento (desde `stockService`, no con trigger, para no acoplar el esquema). El worker de la tienda escucha (`LISTEN`), junta los cambios de 1–2 segundos y pide las cantidades nuevas por la ruta de stock. Respaldo: conciliación completa cada 10 minutos por si se pierde un aviso (LISTEN no guarda mensajes si el worker estaba reiniciando).

## Lo que la tienda guarda

Sólo lo suyo: slug, categoría, SEO, visibilidad y fotos de cada producto padre
(`tienda.productos`, `tienda.producto_colores`, `tienda.fotos`), y en la etapa 2
pedidos, pagos y envíos. **Nunca** el stock ni el precio como dato propio: se
cachean por segundos y se piden a Stocker.
