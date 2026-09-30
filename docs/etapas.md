# Etapas

Cada etapa cierra con dos chequeos obligatorios: **QA** (pantallas, flujos, casos borde) y **Hacker** (seguridad, estrés, permisos). No se pasa a la siguiente con fallas.

| Etapa | Contenido | Estado |
|---|---|---|
| 0 | Monorepo, base (esquema `tienda`), API endurecida, tienda (diseño, legales, SEO, GA4, WhatsApp), backoffice y worker base, CI, infraestructura | **Cerrada** (abajo) |
| 1 | Patch en Stocker (origen `tienda`, catálogo, stock, NOTIFY), sincronización en tiempo real, categorías ↔ productos, grilla con filtros, ficha con selector de color por foto, importador de fotos (5 por color), búsqueda, 404 con salida, eventos GA4 de e-commerce | **Cerrada** (abajo) |
| 2 | Registro/login, carrito lateral (envío gratis, mínimo de compra), checkout, Mercado Pago (tarjeta, cuotas, Pago Fácil), transferencia con API de registro de pago, pago en el local, pedidos a la cola de Stocker, botón de arrepentimiento con código de trámite | **Cerrada** (abajo) |
| 3 | Backoffice: login con 2FA, productos y fotos en vista masiva, categorías, descuentos masivos, clientes sincronizados con Stocker, monto mínimo y ajustes, pedidos y registro de pagos. Además: Destacados y Nuevos (casillas en el producto, secciones y "Nuevos" en la barra), guías de talles tipo Mercado Libre con editor, "Armá tu outfit" y botón Mayorista (`MAYORISTA_URL`) | **Cerrada** (abajo) |
| 4 | Envíos: Correo Argentino, Andreani, OCA, Mercado Envíos, Cabify Logistics (envíos en el día), envíos del día, seguimiento con avisos por email y WhatsApp | |
| 5 | Chatbot de preguntas frecuentes, ajustes finales, prueba de carga final, salida a producción | |

## Etapa 3 · resultados del cierre (28/09/2026)

**Qué entró**
- Backoffice (app aparte, `admin.…`): ingreso con contraseña + **doble factor obligatorio** (QR para Google Authenticator/Authy; el mismo código no sirve dos veces), contraseña provisoria que hay que cambiar, sesión de 12 h como máximo y 30 min sin uso, bloqueo de 30 min a los 5 intentos. Primer usuario: `pnpm admin:crear`.
- Roles: **dueño** (todo, incluidos ajustes, datos bancarios y usuarios), **operador** (pedidos, pagos, productos, fotos, categorías, descuentos, guías, clientes) y **sólo lectura**. Siempre queda al menos un dueño activo.
- **Auditoría** de cada cambio (quién, qué, cuándo, IP), que la base no deja editar ni borrar.
- Panel: pedidos y ventas del día y del mes, lo que hay que atender, catálogo sin fotos/agotado, estado de la sincronización con Stocker.
- Pedidos: buscador y filtro por estado, detalle con historial, registrar transferencia o cobro en el local (Stocker lo deja despachar al instante), cancelar (devuelve la mercadería en Stocker; si estaba pagado avisa que hay que devolver el dinero), listo para retirar / retirado / enviado / entregado, notas internas, descarga de comprobantes (siempre como adjunto).
- Productos: vista masiva con casillas **Visible / Destacado / Nuevo** que se guardan al instante, selección múltiple (marcar/quitar Nuevo y Destacado, publicar/ocultar, agregar a categoría, asignar guía de talles). Edición: nombre (queda fijo frente a Stocker), descripción, SEO, **Destacado (con posición) y Nuevo**, categorías, guía de talles, parte del outfit, color de la muestrita.
- Fotos desde el backoffice: JPG/PNG/WEBP/**HEIC del iPhone** hasta 25 MB, se convierten a los 3 tamaños; 5 por color y 5 × colores por producto (lo controla la base), ordenar y borrar.
- Categorías (dos niveles), descuentos masivos (todo / categorías / productos, con fechas; gana el mayor; tachado y "-X%" en la tienda), clientes (compras, gastado, reenviar a Stocker), ajustes (anuncio, WhatsApp, % transferencia, cuotas, compra mínima, envío, datos bancarios, horas para pagar, locales).
- Tienda: secciones **Destacados** y **Lo nuevo** en el inicio, páginas `/destacados` y `/nuevos`, **"Nuevos" en la barra** (escritorio y celular), etiqueta "Nuevo" y "-X%" en las tarjetas.
- **Guías de talles** (como Mercado Libre): se arma una guía por molde de prenda — de niños (4 a 16) o de adulto (XS a 5XL) — eligiendo las medidas (del cuerpo: altura, edad, pecho, cintura, cadera; de la prenda: ancho, largo, hombros, manga, tiro, entrepierna) y un rango en cm por talle. Se asocia a productos desde la guía (el buscador ofrece los que **coinciden** con sus talles, en verde/amarillo/rojo) o desde el producto. En la ficha: botón "Guía de talles" con la tabla, "Cómo medir" y **"¿Cuál es mi talle?"**, que recomienda el talle con las medidas del cliente (entre dos, el más cómodo; avisa si ninguno le va) y marca su talle en la ficha. Las medidas quedan sólo en el navegador.
- **Armá tu outfit** (`/outfits`, también en la barra): una sola pantalla — para quién, talle **o medidas** (usa la guía de cada prenda), presupuesto, qué partes (arriba, abajo, abrigo) y colores opcionales. Arma hasta 6 combinaciones con stock en ese talle, dentro del presupuesto, que combinan de color y no repiten prendas; cada prenda se puede **cambiar** y el outfit entero va al carrito con un toque. Si no alcanza la plata, dice desde cuánto hay. Más simple que el de Deliver: sin cuestionario de pasos ni registro.
- **Botón Mayorista** en la barra (y en el menú del celular y el pie): pasa por `/mayorista`, que redirige a la variable **`MAYORISTA_URL`**. Se lee en cada clic: se cambia en Railway sin volver a publicar.

**QA**
- Tienda: compartido 28/28 (+guías, recomendación de talle, familias de color), base 28/28 (+0006 y 0007), API 117/117 (+32 del backoffice: ingreso 2FA, roles, auditoría, destacados/nuevos, masivo, fotos, categorías, descuentos, guías, outfits, pedidos, ajustes), worker 38/38.
- E2E (escritorio y celular): 84/84 (6 omitidas a propósito: las que son sólo de escritorio o sólo de celular) — nuevas: Mayorista, Nuevos/Destacados, descuento tachado, guía de talles con recomendación, outfit al carrito, ingreso al backoffice con doble factor, casilla Destacado que aparece en la tienda, editor de guías.
- Celulares: todas las pantallas nuevas de la tienda y del backoffice revisadas a 320, 360, 375, 390, 414 y 768 px, sin desborde horizontal (incluidos la guía de talles abierta, los resultados de outfits y el menú). En el celular, las listas del backoffice pasan a tarjetas: las casillas Visible/Destacado/Nuevo quedan a la vista sin deslizar.
- Hallazgos corregidos en el camino: la clave de cifrado del 2FA mal cargada daba error 500 (ahora la API no arranca con una clave inválida); el botón de la guía dentro del grupo de talles confundía a los lectores de pantalla y a las pruebas (quedó afuera); la calculadora no guardaba las medidas si el talle no había en ese color (ahora se guardan al salir del campo y dice en qué colores hay); restos de pruebas de la base aparecían como descuento en la tienda local (ahora las pruebas limpian lo suyo); Categorías se salía de la pantalla a 320 px.

**Hacker**
- Auditoría: 179/179 (30 nuevos: las 20 rutas del backoffice sin sesión y con token inventado → 401, foto sin sesión no se procesa, 2FA sin primer paso, fuerza bruta → 429, puente del backoffice con rutas raras, CSRF por origen y cabecera, JSON de 300 KB, foto SVG, ingreso fallido sin cookie, `/mayorista` sin redirección abierta, entradas de outfits fuera de rango).
- Decisiones: el secreto del 2FA se guarda cifrado (AES-256-GCM, `ADMIN_CLAVE_CIFRADO`); las sesiones del backoffice se guardan como SHA-256 y el token del primer paso se descarta; cookie `__Host-`, httpOnly, **SameSite=Strict**; el backoffice va en otro subdominio y sin indexar; el navegador nunca habla con la API directo. `pnpm audit`: sin vulnerabilidades.
- Stocker: esta etapa **no necesita cambios nuevos** en Stocker (usa lo de las etapas 1 y 2).

## Etapa 2 · resultados del cierre (28/09/2026)

**Qué entró**
- Cuentas: registro, ingreso, olvidé mi contraseña (enlace de un uso, 1 h), datos, cambio de contraseña, mis pedidos. Compra sin cuenta (queda asociada al email).
- Carrito lateral (envío gratis con barra de avance, cantidades, precio con transferencia) y página de carrito. Todo se recalcula en la API.
- Checkout de una página: contacto, envío a domicilio o retiro en local, medio de pago (sólo los configurados), resumen.
- Pedido → Stocker aparta la mercadería por su cola de ventas online (todo o nada) y queda **SIN PAGAR** en Envíos del día hasta que se cobra.
- Pagos: Mercado Pago (Checkout Pro, aviso firmado + consulta a MP), Pago Fácil / Rapipago (efectivo por MP, con vencimiento), transferencia (20% OFF, datos bancarios, comprobante, **API para registrar el pago** y pantalla que se actualiza sola), pago en el local.
- Vencimientos automáticos: lo no pagado a tiempo se libera en Stocker y se avisa por mail. Pago que llega tarde → `pagado_tarde` para revisar.
- Botón de arrepentimiento con código de trámite; si el pedido no salió, se cancela solo.
- Mails: bienvenida, restablecer, pedido recibido, pago confirmado, comprobante recibido, pedido vencido, arrepentimiento.
- GA4: add_to_cart, remove_from_cart, view_cart, begin_checkout, add_payment_info, purchase.

**QA**
- Stocker: `test-tienda-pedidos.cjs` 45/45 (aparta, reintento idempotente, sin pagar no se despacha, pagado sí, todo o nada, cancelar devuelve, otro canal se llevó la última, clientes sin pisar datos). Regresión: cola online 40/40, envíos del día 107/107, Jumpseller 64/64, catálogo 39/39.
- Tienda: base 24/24, compartido 21/21, API 81/81, worker 38/38 (+2 de cola).
- E2E (escritorio y celular): 71/71 — carrito persistente, checkout con validación y foco en el error, transferencia que pasa sola a «¡Pago confirmado!», Mercado Pago aprobado y rechazado con reintento, cuenta (cookie httpOnly), arrepentimiento.
- Lighthouse (celular) en cuenta, carrito y arrepentimiento: accesibilidad 100.
- Hallazgos corregidos: el checkout ofrecía transferencia sin datos bancarios cargados (ahora sólo los medios configurados); el enlace de vuelta de Mercado Pago llevaba el token de acceso al pedido (ya no sale de la tienda); el foco no iba al primer campo con error; columna nueva de Stocker pisada por una clave repetida en `ensureColumns`.

**Hacker**
- Auditoría: 149/149 (37 nuevos: CSRF por origen y cabecera propia, lista cerrada del puente, cookie httpOnly/SameSite, fuerza bruta → 429, pedidos ajenos → 404, precio/cantidades manipulados → 400, registrar pago y rutas internas sin credencial, aviso de MP sin firma o con firma falsa → 401, comprobante SVG/7 MB, arrepentimiento con email ajeno).
- Aislamiento de la base: 25/25. `pnpm audit`: sin vulnerabilidades.

## Etapa 1 · resultados del cierre (28/09/2026)

**QA**
- Stocker: `test-tienda-online.cjs` 39/39 (puerta, catálogo, mismo número que los otros canales, reservas, otro negocio, NOTIFY partido, credencial revocada, sin locales online). Regresión: Jumpseller 64/64, integraciones 23/23, stock por local 36/36.
- Integración real contra el backend de Stocker: catálogo real sincronizado (10 productos, 77 variantes) y una venta registrada en Stocker llegó a la tienda por NOTIFY y actualizó el stock.
- Tienda: compartido 21/21, base 19/19, API 46/46, worker 35/35 (sincronización, stock más viejo no pisa, bajas, slugs estables, SKU reasignado, escucha con reconexión, cliente que no sigue redirecciones, fotos: EXIF/GPS borrado, bomba de píxeles, topes por la base, rollback si falla la subida).
- E2E (escritorio y celular): 55/55 — grilla, filtros en la URL, color en la tarjeta, ficha con color/talle y mensaje de WhatsApp, JSON-LD de producto, búsqueda, 5 rutas inexistentes → 404 con buscador, y **una venta en el local agota la prenda en la tienda en ~2 s sin intervención**.
- Lighthouse celular: categoría 99/100/96/100, ficha 90/100/96/100 (rendimiento/accesibilidad/buenas prácticas/SEO). El 96 es por servir fotos por http en local; en producción salen de R2 por https.
- Hallazgos corregidos: la CSP bloqueaba las fotos (una fuente con ruta sin "/" final sólo coincide con esa ruta exacta); dos enlaces iguales por tarjeta; orden de títulos en la grilla; prioridad de carga repartida entre 4 fotos.

**Hacker**
- Auditoría: 112/112 (38 chequeos nuevos: slugs y búsquedas maliciosas, parámetros duplicados, fotos fuera de su carpeta, XSS reflejado en la búsqueda, ruta de revalidación sin credencial = 404, ningún secreto en HTML/JS, credencial interna falsa no exime del límite).
- Aislamiento de la base: 25/25 (+ `tienda_app` puede escuchar los avisos pero no leer stock, variantes, productos ni credenciales de Stocker).
- Hallazgo corregido: el límite de pedidos por IP habría frenado al propio servidor de la tienda (todas las páginas se piden desde una IP interna) → credencial interna `INTERNO_TOKEN` entre web y API.
- `pnpm audit`: sin vulnerabilidades (se forzó `uuid` ≥ 11.1.1 en una dependencia de desarrollo).
- Carga: catálogo 4.000–5.100 pedidos/s en la API, búsqueda sin caché 880/s, páginas de categoría y ficha ~670/s; 0 errores; máximo 10 conexiones a la base de Stocker.

## Etapa 0 · resultados del cierre (28/09/2026)

**QA**
- Tests de base: 14/14 — migraciones idempotentes, no tocan las tablas de Stocker, dos réplicas migrando a la vez, edición de migraciones detectada, 5 fotos por color, tope del padre con exhibición, color ajeno rechazado, 12 subidas simultáneas → entran exactamente 5, categorías de 2 niveles, auditoría inmutable.
- Tests de API: 25/25 — salud, config con ajuste roto, categorías, errores, CORS, cuerpos, validación, límite de pedidos con y sin proxies.
- Worker: 2/2. Reglas compartidas: 7/7.
- E2E en navegador real (escritorio 1440 y celular Pixel 7): 26/26 — sin errores de consola ni scroll horizontal, menú escritorio y cajón celular, WhatsApp, arrepentimiento visible desde el inicio, legales sin restos de la plantilla de Jumpseller, 404, robots/sitemap, JSON-LD, cabeceras.
- Lighthouse celular: rendimiento 95–97, accesibilidad 100, buenas prácticas 100, SEO 100 (inicio, subcategoría, página legal). CLS 0.
- Hallazgos corregidos durante el QA: el cajón del menú del celular quedaba atrapado dentro del header (backdrop-filter crea un bloque contenedor) → portal a `body`; dos navegaciones con el mismo nombre accesible; contraste del texto tenue 3,2:1 → 4,9:1; áreas táctiles chicas.

**Hacker**
- Auditoría contra los tres servicios: 74/74 — cabeceras, 28 rutas sensibles sin exponer, sin source maps, métodos, 12 cargas de inyección, JSON de 20.000 niveles, prototype pollution, 1 MB, XML con entidad externa, cabecera de 64 KB, 4 orígenes CORS hostiles, ráfaga con IP falsificada → 429.
- Aislamiento de la base: 19/19 — `tienda_app` no puede leer ni borrar tablas de Stocker, crear tablas en `public`, crear roles, leer `pg_authid` ni archivos, ni ejecutar comandos; una consulta colgada se corta a los 10 s.
- Hallazgo corregido: `CREATE SCHEMA IF NOT EXISTS` exigía permiso sobre la base aunque el esquema existiera → con el usuario restringido la API no habría arrancado en producción. El migrador ahora pregunta antes de crear.
- `pnpm audit --prod`: sin vulnerabilidades conocidas.
- Carga (4 núcleos, sin Cloudflare, todo al origen): API ~8.500 pedidos/s con p99 25 ms; HTML de la tienda ~800 páginas/s con p99 115 ms; 0 errores; máximo 3 conexiones a la base de Stocker.
