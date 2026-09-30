# Contrato con Stocker

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
- `POST /api/integraciones/tienda/pedidos` `{ pedido: "ISU-1234", items: [{ sku, cantidad, precioUnitario }], comprador, total, pagoPendiente, pagoDetalle }` → entra por `encolarYProcesar`. **Todo o nada**: si queda `parcial`, se cancela en el acto y se devuelve `faltantes: [{ sku, pedido, hay }]`. Idempotente por número (`repetido: true`).
- `GET /api/integraciones/tienda/pedidos/:pedido` → estado.
- `POST …/pedidos/:pedido/pagado` `{ detalle }` → levanta la marca (idempotente; 409 si el pedido ya se canceló).
- `POST …/pedidos/:pedido/cancelar` `{ motivo }` → `cancelarPorPlataforma` (devuelve lo apartado; idempotente).
- `PUT /api/integraciones/tienda/clientes` `{ email, nombre, apellido, telefono, dni }` → cliente minorista por email (sin distinguir mayúsculas); lo vacío no pisa lo que Stocker ya tenía; no se pueden tocar tipo, cuenta corriente ni límite.
- Pruebas: `scripts/test-tienda-pedidos.cjs` (45 chequeos).
