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
| Transferencia | El cliente ve CBU/alias y el total con descuento; **API para registrar el pago** (`POST /v1/pedidos/:id/transferencia` con comprobante e importe) → el pedido pasa a "verificando pago" y el cliente ve "Aguardá un momento, estamos confirmando tu transferencia". Se confirma desde el backoffice o por conciliación automática; vence a las 48 h sin comprobante. **Confirmación automática** (migración 0014, ver [transferencias.md](transferencias.md)): un CVU por pedido con Talo, o el alias de la cuenta de Mercado Pago con centavos únicos. |
| Pago en el local | Reserva con vencimiento; se cobra al retirar (Stocker registra la venta en el local). |

En todos los casos el stock se aparta en Stocker al confirmar el pedido (cola de ventas online) y se libera si vence o se cancela.

## Sincronización con Stocker (etapa 1)

Ver [contrato-stocker.md](contrato-stocker.md).

## Envíos (etapa 4)

- `packages/envios`: un adaptador por transporte (Correo Argentino, Andreani, OCA, Mercado Envíos, Cabify) con la misma forma — cotizar, sucursales, crear envío, etiqueta, seguimiento, enlace público — más WhatsApp (Meta Cloud API) y un simulador de todos para desarrollo y pruebas. Cada uno se prende con sus credenciales (`crearTransportes(env)`).
- **API**: `POST /v1/envios/opciones` (cotiza con todos a la vez, con caché de 30 min y 6 s de tope por transporte), `GET /v1/envios/sucursales`, `GET /v1/seguimiento/:numero?t=` (público, firmado). Al crear el pedido se vuelve a cotizar la opción elegida y se guardan transporte, servicio, sucursal y paquete. Backoffice: `/v1/admin/envios` (vistas, preparar, etiquetas en un PDF con pdf-lib, descartar, actualizar).
- **Stocker** sigue siendo quien despacha (Envíos del día): la tienda le pasa el transporte y el número de seguimiento, y Stocker avisa por `NOTIFY stocker_tienda_envios` cuando la caja sale.
- **Worker** (cola `envios`): `despachado` (del NOTIFY; y un repaso cada 15 min por si se perdió), `seguimiento` cada 10 min (reserva los envíos con `proximo_chequeo` para que dos réplicas no pregunten lo mismo), `mercado-envios` (trae el envío que creó Mercado Pago), y los avisos por mail y WhatsApp (cola `notificaciones`), deduplicados en `tienda.avisos`.
- Tablas: `tienda.envios` (un envío vigente por pedido; los descartados quedan como historia), `tienda.envio_eventos`, `tienda.avisos`; columnas nuevas en `tienda.pedidos` y `peso_gramos` en productos (migración `0008`).

## Asistente (etapa 5)

- **API** `modulos/chat`: `texto.ts` (normalizar, raíces, puntaje con pesos por rareza de la palabra, tachar datos personales), `motor.ts` (intenciones con datos de verdad → preguntas frecuentes → productos → IA opcional → sin respuesta), `ia.ts` (Claude con `@anthropic-ai/sdk`, esfuerzo bajo, instrucciones + información de la tienda cacheadas, `fallbacks` del lado del servidor), `rutas.ts` (`/v1/chat`, `/v1/chat/pedido`, `/v1/chat/voto`). Backoffice en `modulos/admin/chat.ts`.
- Las preguntas frecuentes se comparan en memoria (son decenas): sin extensiones de Postgres. Caché corta por réplica, que el backoffice limpia en todas al editar (Redis pub/sub).
- Contadores (temas por día, usos de cada pregunta) en memoria, guardados cada 10 s y al apagar: nada de escribir en la misma fila en cada consulta.
- **Tienda**: `components/chat/Asistente.tsx` (panel no modal, `role="log"` para lectores de pantalla, charla en `sessionStorage`), puente `/api/t/chat*`.
- Tablas: `tienda.faq`, `tienda.chat_sin_respuesta`, `tienda.chat_temas`; ajustes `chatbot` y `chatbotIa` (migración `0009`).

## Packs, Liquidación y menú (etapa 9)

- **Packs** (`packages/shared/src/packs.ts`): ajuste `packs` = `{ minimo, maximo, porcentajes[] }`, validado entero (2 a 20 unidades, un % por cantidad, que no baje). `leerPacks` acepta el formato viejo (`[x2…x5]`). La página `/producto/pack-xN-<slug>` es la prenda padre con `FichaPack`: arma cada unidad con sus variantes y nunca ofrece más que el stock (por variante y en total). El % lo sigue calculando `pedidos/cotizar.ts`.
- **Liquidación**: columna `liquidacion` en `tienda.descuentos` (migración `0015`). `EN_LIQUIDACION` (en `productos/consultas.ts`) repite las reglas de vigencia y alcance de `lib/descuentos`. Las tarjetas y la ficha traen `liquidacion: boolean`.
- **API**:
  - `GET /v1/productos?coleccion=packs|liquidacion[&categoria=<slug de arriba>]`: la categoría incluye sus hijas, y la de liquidación sólo trae prendas con stock;
  - `GET /v1/menu`: 1 o 2 prendas con foto y stock por categoría de arriba, destacadas primero;
  - `GET /v1/config` suma `packsEn`, `hayLiquidacion` y `liquidacionEn` (en qué categorías hay algo).
- **Tienda**: `PaginaSeccion` (`/packs`, `/packs/[categoria]`, `/liquidacion`, `/liquidacion/[categoria]`) y el `Header` con desplegables por categoría.
  - `MenuMovil` va por paneles; los accesos del header (`MenuAcceso`) lo abren en un panel con un evento `isu:menu`.
  - `BarraEnvioGratis` en la ficha usa la cotización del carrito.
- **Caché corta** (`apps/api/src/lib/cache.ts`): con tope de 5000 claves (poda vencidas y, si no alcanza, las más viejas).

## Carrito, checkout y backoffice (etapa 10)

- **Packs aparte:** `ItemCarrito` es `{ sku, cantidad }` o `{ pack: [{ sku, cantidad }], cantidad }` (shared `checkout.ts`). `cotizar.ts` agrupa los packs por `clavePack` y arma cada uno.
  - `Cotizacion.lineas` trae todas las prendas, cada una con su `clave`; `Cotizacion.packs` las agrupa para mostrarlas.
  - Cupón y "cobrado" van por `clave`.
  - `paraStocker` junta por SKU para Stocker.
- **Tienda:**
  - `LineaCarrito.pack` guarda lo que lleva; `OpcionesPago` muestra transferencia vs. tarjeta/MP.
  - El checkout es de una página con el resumen fijo y `?pago=` para elegir el medio desde el carrito.
  - En la ficha, «Comprar ahora» agrega sin abrir el cajón y va a `/checkout`.
- **Eliminar productos:** columnas `eliminado_en` y `eliminado_por`, y la restricción `productos_eliminado_oculto` (migración `0016`). Rutas `POST /v1/admin/productos/eliminar` y `/restaurar`, y filtro `eliminados`.
- **Guías de talles:**
  - tipo `otro` (talles propios) y medidas con nombre propio (`infoMedida`), de la migración `0016`;
  - `lib/xlsx.ts` (leer y escribir .xlsx) y `admin/guias-excel.ts` (hoja ↔ guía);
  - `GET/POST /v1/admin/guias-talles/excel` (`?vista=1` para la vista previa);
  - migración `0017`: las 40 guías de la fábrica.
- **Stocker:** `CatalogoStocker` descarta productos de evento, pack o combo y variantes de pack o combo, si vinieran marcados.

## Direcciones del checkout y aviso del carrito (etapa 11)

- **Shared `direcciones.ts`:**
  - `PROVINCIAS` con el código INDEC, que es el que entiende Georef;
  - `provinciaDelCheckout`, para pasar los nombres de Google y Georef a los del checkout;
  - los esquemas de las tres rutas, `AjusteDirecciones` y `ConfigPublica.direcciones` (qué ayudas hay).
- **API:**
  - `lib/direcciones.ts`:
    - `crearGoogle`: Places API (New), `places:autocomplete` y `places/{id}` con `X-Goog-FieldMask: addressComponents`;
    - `crearGeoref`: `/v2.0/direcciones`;
    - `evaluarGeoref`: ok, sugerencia, altura o no encontrada.
  - `modulos/direcciones/rutas.ts`: `POST /v1/direcciones/sugerencias`, `/lugar` y `/revisar`, y `GET /v1/admin/direcciones`. Topes en Redis: `isu:direcciones:<tipo>:<día>`.
  - Migración `0018`: el ajuste `direcciones`.
- **Tienda:**
  - `checkout/Direccion.tsx`:
    - `CampoCalle`: un combobox ARIA, 350 ms de espera, desde 4 letras, un UUID de sesión por dirección y la atribución «Google Maps»;
    - `AvisoDireccion`: revisa 900 ms después del último cambio.
  - Las rutas pasan por el BFF (`/api/t/direcciones/*`).
- **Aviso del carrito:**
  - `usoDe(lineas, sku)` cuenta una variante suelta y en packs;
  - `agregar` y `agregarPack` reciben el `stock` y devuelven `false` si no agregan;
  - `AvisoYaEnCarrito` es el `alertdialog` (al centro desde `sm`, hoja abajo en el celular);
  - el «+» del carrito usa `disponible`, que ahora descuenta las otras líneas.
- **Simulador:** `scripts/demo/direcciones-simulado.mjs` (Google y Georef, puerto 3940), en `pnpm demo:direcciones` y `levantar-e2e.sh`.

## Etapa 12: banners interactivos y direcciones sin ids

- **Migración `0019`:**
  - `guias_talles.slug`, que sale solo del nombre con el trigger `tienda.guia_slug()`, único;
  - los banners: `titulo`, `texto`, `etiqueta`, `botones` (jsonb, hasta 2), `fondo`, `alineacion`, `producto_id` / `producto_auto`, `ocultar_sin_producto` y `sugerido`;
  - los 7 banners sugeridos;
  - las claves de foto de banners en los dos formatos.
- **Shared `banners.ts`:**
  - `BotonBanner`, `RutaTienda`, `BannerPublico`;
  - `VARIABLES_BANNER` y `conVariables` (los `{descuento}`… que salen de Ajustes);
  - `BANNERS_SUGERIDOS`, igual a la migración: una prueba lo controla.
- **API:**
  - `modulos/portada/banners.ts`:
    - `variablesDeBanners`;
    - `productoDeBanner`, con las mismas colecciones y tarjetas que la grilla;
    - `armarBanner`, que devuelve el banner o el motivo por el que no sale;
    - `bannersPublicos`, hasta 8.
  - `/v1/portada` los usa. En `admin/resenas.ts`:
    - `GET /v1/admin/banners`, con la vista de cada uno y los valores de los datos;
    - `GET /v1/admin/banners/producto`;
    - `POST /v1/admin/banners/sugeridos`;
    - `DELETE /v1/admin/banners/:id/foto`.
- **`@isu/ui/banner`:** el dibujo del banner, el mismo en el carrusel de la tienda y en la vista previa del backoffice. Usa consultas de contenedor (`@container`), así la vista previa muestra la compu o el celular por el ancho de su caja. El backoffice lo escanea con `@source` en su `globals.css`.
- **Backoffice → Portada:**
  - la lista con el estado de cada banner;
  - el editor con vista previa (compu y celular, achicada con `transform`);
  - el selector de destino (páginas, categorías, packs, un producto o una dirección);
  - el buscador de productos.
- **Direcciones sin ids:**
  - `claveNueva("p" | "b")` en `@isu/almacen`: `p/<12 hex>/<16 hex>`. La usan la API (fotos y banners), el importador de fotos y el del mayorista;
  - `apps/worker/src/fotos/sin-ids.ts` y `pnpm fotos:sin-ids`: pasa las viejas;
  - el backoffice:
    - `productos/[slug]` (`GET /v1/admin/productos/s/:slug`) y `guias-talles/[slug]` (`GET /v1/admin/guias-talles/s/:slug`): un número viejo pasa al slug;
    - los comprobantes por su número en el pedido: `GET /v1/admin/pedidos/:numero/comprobantes/:n`.
- **Repaso al regenerar páginas** (`apps/worker/src/stocker/invalidar.ts`):
  - **El problema:** una página que se estaba regenerando con datos de antes de un cambio podía terminar después del aviso, y Next la guardaba como nueva. Quedaba vieja hasta vencer (5 minutos).
  - **El arreglo:** el worker manda un segundo aviso 2,5 segundos después. Va aparte, sin frenar la cola de Stocker. Los cambios seguidos se juntan en un solo repaso, en tandas de 500 productos.
- **Guía:** [`banners-y-direcciones.md`](banners-y-direcciones.md).
