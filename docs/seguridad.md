# Seguridad

Cada etapa cierra con el chequeo "hacker" (`tests/seguridad/`) y no pasa a la siguiente con fallas.

## Defensas vigentes (etapas 0 a 3)

| Riesgo (OWASP) | Defensa | Prueba |
|---|---|---|
| Inyección SQL | Consultas parametrizadas (Drizzle/pg); parámetros validados con Zod antes de llegar a la base; usuario de base sin acceso a Stocker | `auditoria.mjs` (12 cargas), `api.test.ts`, `aislamiento-db.mjs` |
| XSS | React escapa todo; el único HTML crudo (JSON-LD) escapa `<`; CSP sin `unsafe-eval`, sin objetos ni iframes de terceros | e2e cabeceras, `auditoria.mjs` |
| Clickjacking | `frame-ancestors 'none'` + `X-Frame-Options: DENY` en las tres superficies | `auditoria.mjs` |
| CORS abierto | Lista cerrada de orígenes; subdominios parecidos y `null` rechazados | `api.test.ts`, `auditoria.mjs` |
| Fuerza bruta / abuso | Límite por IP contado en Redis (vale entre réplicas); la IP real sale de N proxies de confianza, un `X-Forwarded-For` inventado no la cambia | `api.test.ts`, `auditoria.mjs` |
| DoS de aplicación | Cuerpo máx. 64 KB, cabeceras máx. 16 KB, JSON sólo, timeouts, freno por presión del event loop (503 rápido), Cloudflare adelante | `auditoria.mjs` |
| Prototype pollution | `__proto__` y `constructor.prototype` rechazados en el parser | `api.test.ts`, `auditoria.mjs` |
| Filtración de errores | 500 genérico con `idPedido`; mensaje real, SQL y stack sólo al log | `api.test.ts` |
| Datos sensibles en logs | `redact` de authorization, cookies, tokens, contraseñas y tarjeta | revisión |
| Exposición de archivos | `.env`, `.git`, `package.json`, fuentes y source maps no se sirven | `auditoria.mjs` (28 rutas) |
| Dependencias | `pnpm audit --prod` en CI; scripts de instalación bloqueados salvo lista | CI |
| Base compartida | Esquema y usuario propios, techo de conexiones, `statement_timeout`; el stock de Stocker se lee por su API, nunca de sus tablas | `aislamiento-db.mjs` |
| Integración con Stocker | Credencial propia por origen (la del portal mayorista no abre la tienda ni al revés); el negocio sale de la credencial; respuestas validadas con Zod antes de guardarlas; el cliente no sigue redirecciones con la credencial | `test-tienda-online.cjs`, `stocker.test.ts` |
| Ruta de revalidación | Credencial comparada en tiempo constante; sin credencial responde 404 (no confirma que existe); etiquetas con formato cerrado | `auditoria.mjs` |
| Límite vs. servidor propio | La web se identifica con `INTERNO_TOKEN` (comparación en tiempo constante); una credencial falsa no exime | `api.test.ts`, `auditoria.mjs` |
| Fotos subidas | Sólo formatos de imagen (SVG rechazado), máx. 25 MB y 50 MP (bomba de píxeles), se re-codifican a webp y se borran EXIF/GPS; nombres aleatorios; rutas validadas; topes aplicados por la base | `fotos.test.ts`, `auditoria.mjs` |
| Inventario a la vista | El stock exacto no viaja al navegador (tope 10) ni campos internos | `productos.test.ts`, `auditoria.mjs` |
| Sesiones | Token al azar en cookie `__Host-` httpOnly, Secure, SameSite=Lax; en la base sólo su SHA-256; se renueva con el uso y se cierran todas al cambiar la contraseña | `compras.test.ts`, e2e, `auditoria.mjs` |
| CSRF | El navegador sólo habla con la tienda (mismo origen); todo lo que cambia algo exige `Origin` propio y la cabecera `x-isu: 1`; lista cerrada de rutas | `auditoria.mjs` |
| Contraseñas | argon2id (m=19 MiB, t=2); mismo mensaje y tiempo para email inexistente o clave equivocada; bloqueo tras 10 fallas; frenos por IP y por email; enlaces de restablecer de un uso y 1 h, en el fragmento de la URL | `compras.test.ts`, `auditoria.mjs` |
| Cuentas de invitados | Quien compró sin cuenta no puede «registrarse» con ese email sin demostrar que es suyo (enlace por mail) | `compras.test.ts` |
| Precios | El navegador sólo manda SKU y cantidad (esquemas estrictos); precio, descuento, envío y total los calcula la API; la base exige `total = subtotal − descuento + envío` | `compras.test.ts`, `db.test.ts`, `auditoria.mjs` |
| Pedidos ajenos (IDOR) | Se ven sólo con la sesión del dueño o el token de acceso del pedido (guardado como hash); mismo 404 exista o no | `compras.test.ts`, `auditoria.mjs` |
| Pagos | Aviso de Mercado Pago con firma HMAC (≤ 10 min) y luego consulta a MP con nuestra credencial; se verifica pedido, monto y moneda; idempotente por id de pago; registro de transferencias con credencial propia; sin reserva en Stocker no se cobra | `compras.test.ts`, `auditoria.mjs` |
| Comprobantes | Se mira el contenido (no el tipo declarado); imágenes re-codificadas; PDF tal cual; bucket privado; 6 MB, 5 por pedido | `compras.test.ts`, `auditoria.mjs` |
| Mails | Todo dato del cliente escapado; botones sólo con enlaces http(s) | `plantillas.test.ts` |
| Backoffice: ingreso | Contraseña (argon2id) + **doble factor TOTP obligatorio**; secreto cifrado con AES-256-GCM (`ADMIN_CLAVE_CIFRADO`); un código no sirve dos veces; el token del primer paso se descarta; clave provisoria que hay que cambiar (12+ caracteres); bloqueo 30 min a los 5 intentos; frenos por IP, por email y por usuario en el código | `admin.test.ts`, e2e, `auditoria.mjs` |
| Backoffice: sesión | Cookie aparte (`__Host-isu_adm`), httpOnly, Secure, **SameSite=Strict**; 12 h como máximo y 30 min sin uso; en la base sólo el SHA-256; cambiar rol, desactivar o restablecer cierra sus sesiones | `admin.test.ts` |
| Backoffice: permisos | Rol controlado en la API en cada ruta (dueño / operador / lectura); siempre queda un dueño; nadie cambia su propio rol | `admin.test.ts`, `auditoria.mjs` |
| Backoffice: auditoría | Cada cambio queda en `tienda.auditoria` (quién, qué, detalle, IP); la base impide editarla o borrarla | `admin.test.ts`, `db.test.ts` |
| Backoffice: puente | Sólo `/v1/admin/…`, tramos de ruta simples (sin `..` ni codificados), CSRF por origen + `x-isu`, JSON ≤ 256 KB, fotos sólo imagen ≤ 25 MB; comprobantes siempre como adjunto con `sandbox` | `auditoria.mjs` |
| Fotos subidas | Se decodifican y re-codifican a WEBP (se descarta cualquier contenido extra y los metadatos); topes en la base | `admin.test.ts` |
| Mayorista | `/mayorista` redirige sólo a `MAYORISTA_URL` (http/https); el visitante no puede elegir el destino | `auditoria.mjs`, e2e |
| Outfits y medidas | Entrada estricta y acotada; las medidas del cliente viajan por POST, no se guardan en el servidor ni quedan en URLs | `admin.test.ts`, `auditoria.mjs` |
| Búsqueda | El texto se reduce a `[a-z0-9]` antes de armar la consulta de texto completo; parámetro, nunca concatenado; 2–60 caracteres | `productos.test.ts`, `auditoria.mjs` |

### Etapa 4: envíos

| Qué | Defensa | Prueba |
|---|---|---|
| Precio del envío | Lo calcula siempre la API (se vuelve a cotizar al confirmar); el navegador sólo manda el id de la opción; entrada estricta | `envios.test.ts`, `auditoria.mjs` |
| Seguimiento público | `/seguimiento/ISU-…?t=` con firma HMAC (clave derivada de `INTERNO_TOKEN`), comparación en tiempo constante; muestra sólo el envío y el nombre de pila; misma respuesta exista o no; sin indexar | `envios.test.ts`, `auditoria.mjs`, e2e |
| Respuestas de los transportes | XML sin DOCTYPE/ENTITY (XXE), sin redirecciones, tiempo máximo, números de seguimiento validados (`^[A-Za-z0-9_-]{3,60}$`, también en la base) | `envios.test.ts` (paquete) |
| Etiquetas | Se valida que sean PDF, bucket privado con nombre aleatorio, descarga sólo como adjunto con CSP `sandbox`; imprimir y preparar exigen rol operador y quedan auditados | `envios.test.ts` |
| Cotizaciones | Freno propio por IP (120 cada 10 min), caché y tope de 6 s por transporte | `envios.test.ts`, `auditoria.mjs` |
| Avisos | Una sola vez por pedido, tipo y canal (`tienda.avisos`); WhatsApp sólo con plantillas y al celular normalizado; el mail escapa todo lo del pedido | worker `envios.test.ts` |
| Doble preparación | Candado por pedido y un solo envío vigente por pedido (índice único) | `envios.test.ts` |
| Simuladores | `TRANSPORTES_SIMULADOR` se ignora con `NODE_ENV=production`; las pantallas de los simuladores sólo responden desde la misma máquina | — |

### Etapa 5: asistente

| Qué | Defensa | Prueba |
|---|---|---|
| Respuestas | Las arma la API (preguntas frecuentes, cotizador, buscador); el navegador sólo manda el mensaje. Se muestran como texto (React escapa); nunca HTML | `chat.test.ts`, e2e, `auditoria.mjs` |
| Enlaces | Sólo rutas de la tienda (`/algo`, nunca `//otro.sitio`) o `https://wa.me/<número de la tienda>`: lo controlan el esquema, la base (CHECK) y otra vez la tienda antes de mostrarlos | `chat.test.ts`, `db.test.ts`, `auditoria.mjs` |
| Pedido por chat | Número **y** email; misma respuesta exista o no; frenos por IP (10/10 min) y por número (5/hora); no muestra dirección, ítems ni montos | `chat.test.ts`, `auditoria.mjs` |
| IA (opcional) | Instrucciones fijas + información de la tienda; el mensaje del cliente va marcado como dato; salida limpiada (sin enlaces); tope diario y por IP; sin respuesta o con error → respuesta normal | `chat.test.ts` (IA de mentira), `auditoria.mjs` |
| Datos personales | La charla no se guarda; lo sin respuesta se guarda tachado y 90 días; estadísticas sólo por tema | `chat.test.ts` |
| Abuso | Freno por IP (60 consultas/10 min), cotización con el freno de envíos, votos 30/10 min | `chat.test.ts`, `auditoria.mjs` |

## Pendiente por etapa

- **Producción (etapa 3):** poner `admin.` detrás de Cloudflare Access (ver despliegue) como segunda llave además del 2FA.
- **Etapa 4 (hecho):** no se usan webhooks de los correos ni de WhatsApp (el seguimiento es por consulta, sin nada público que firmar). Si más adelante se suman, van con firma y lista de IPs.
- **Producción (etapa 4):** homologar cada transporte con credenciales reales antes de abrir (los adaptadores sólo se probaron contra los simuladores).

## Cupones e importación (etapa 6)

- El descuento lo calcula siempre la API con lo que hay en la base: el navegador manda sólo el código. Al crear el pedido se vuelve a calcular con el cupón **bloqueado** (`FOR UPDATE`, antes de insertar el pedido): dos compras a la vez no pueden pasar un tope. Si el cupón dejó de servir entre el carrito y la compra, el pedido no se crea (409 `cupon`).
- Probar códigos: tope de 40 cotizaciones con cupón por IP cada 10 minutos (carrito y opciones de envío), además del límite general.
- El uso de un cupón se libera por un trigger de la base cuando el pedido se cae (vencido, cancelado, sin stock, error de reserva): no depende de cada camino del código.
- La base impone las reglas aunque falle la validación de la API: código en mayúsculas y único, porcentaje 1–90, monto ≥ $1, promo sin código, total del pedido que cierra (`total = subtotal − cupón − transferencia + envío`), precio cobrado nunca mayor al de la prenda.
- Importador del mayorista: pide sólo rutas `/fotos/<id>.(jpg|png|webp)` del origen configurado, sin seguir redirecciones, con tope de 25 MB y 60 s, y exige `content-type` de imagen; el catálogo se valida con un esquema; las fotos pasan por el mismo procesado que las subidas (sin metadatos, tope de píxeles). No guarda textos del mayorista.

## SEO: redirecciones, feed y sitemap

- **Sin redirección abierta:** una redirección manda siempre a una página de esta tienda. Hay tres llaves:
  - La base sólo acepta rutas propias (`CHECK`: empieza con `/`, sin `//` ni `\`, sin espacios).
  - La API se queda sólo con la ruta aunque se pegue una dirección completa de otro sitio.
  - El proxy de la tienda vuelve a comprobarlo.
- **Dominio del `Location`:**
  - Es el configurado (`NEXT_PUBLIC_SITE_URL`), nunca el `Host` o `X-Forwarded-Host` del visitante. Una redirección guardada en la caché de Cloudflare con un Host falso mandaría a todos a otro sitio.
  - Sin dominio configurado, sólo se acepta el de Railway (`RAILWAY_PUBLIC_DOMAIN`), y esa respuesta va sin caché.
- **Círculos y cadenas:**
  - A → B → A se rechaza al guardar (409) y se descarta del mapa.
  - Las cadenas se resuelven a un solo salto.
  - La raíz, `/_next` y `/api` no se pueden redirigir.
- **Si la API se cae:** el mapa es público (no hay nada secreto en a dónde lleva una dirección vieja) y lo cachean la API, Cloudflare y la tienda. La tienda sigue andando sin él.
- **Feed de Google Shopping:**
  - No publica stock exacto, costos ni identificadores internos.
  - Todo el texto va escapado.
  - Se sacan los caracteres de control, que harían rechazar el archivo entero.
- **Texto de categoría:** se muestra como texto, nunca como HTML. Los datos estructurados escapan `<` (`components/JsonLd.tsx`).
- **Auditoría** (`tests/seguridad/auditoria.mjs` § 7e):
  - `Host` y `X-Forwarded-Host` falsos.
  - Rutas armadas para escaparse (`//evil.com`, `%2F%2F`, `\`, CRLF).
  - Backoffice sin sesión.
  - Mapa con rutas propias, feed sin datos internos y escapado, y robots.txt.

## Packs, reseñas y portada (etapa 8)

- **Packs:** el % lo calcula la API con lo que hay en el carrito (`pedidos/cotizar.ts`), al cotizar y otra vez al crear el pedido. El navegador manda SKU y cantidad, o (etapa 10) qué lleva cada pack y cuántos: cualquier campo de más (`porcentaje`…) es 400. Un pack que no es de una sola prenda marcada como pack, o fuera del rango de Ajustes, no se arma. No se suma a una rebaja: gana el mayor. El ajuste se valida entero (de 2 a 20 unidades, un % por cantidad, nunca más de 60 % ni menor al de una unidad menos).
- **Reseñas, quién opina:** sólo con el enlace del mail.
  - El enlace va firmado (HMAC) con una clave derivada de `INTERNO_TOKEN` para este uso (`isu:opinar:`): la firma del seguimiento no sirve acá ni al revés, y la de un pedido no sirve para otro. Se compara en tiempo constante.
  - Mismo 404 si el pedido no existe o la firma no corresponde: no se puede averiguar qué números existen.
  - Un pedido sin entregar o retirar responde 409, y sólo a quien tiene una firma buena.
  - Una opinión por prenda del pedido y una general: lo impone un índice único de la base. Una prenda que no es del pedido da 400.
  - Probar enlaces a ciegas: tope de 10 envíos por cliente cada 10 minutos. Se cuenta por la IP del cliente que pasa la tienda (`x-isu-ip`, con la credencial interna), no por la del servidor de la tienda, que está exento del límite general.
- **Reseñas, qué se guarda y qué se muestra:**
  - El esquema es estricto: el cliente no elige estado, nombre, talle ni color.
  - El nombre sale del pedido y se muestra como nombre + inicial («Ana G.»). El talle y el color salen de lo que compró.
  - El texto, hasta 1000 caracteres, se guarda tal cual y la tienda lo muestra como texto, nunca como HTML.
  - Lo público (ficha, inicio, `/opinar`) no trae número de pedido, mail, apellido, montos ni datos de moderación.
- **Moderación:** listar pide sesión; publicar, rechazar y responder piden rol operador y quedan en la auditoría.
- **Banners:**
  - El enlace es sólo una ruta de esta tienda. Hay tres llaves: el `CHECK` de la base, el esquema de la API y la tienda, que no arma el enlace si no es propio.
  - Las fotos pasan por el mismo procesado que las de productos: sin metadatos, con tope de píxeles y medidas mínimas y máximas.
  - Las claves siguen el patrón `b/<id>/<azar>` y alta, edición, foto y baja piden rol operador y quedan en la auditoría.
- **Auditoría** (`tests/seguridad/auditoria.mjs` § 7f, 48 chequeos):
  - reseñas públicas sin datos internos y con parámetros raros;
  - firmas inventadas, de otro pedido y del seguimiento;
  - cuerpos con campos de más, 6 estrellas, repetidos y textos largos;
  - freno a ciegas y la tienda sin su cabecera;
  - banners con rutas propias;
  - el % de pack desde el navegador y el tope con 10 unidades;
  - backoffice sin sesión (11).

## Transferencias que se confirman solas

- **El aviso de Talo no viene firmado.** Por eso no se cree:
  - si el id no es de un cobro que creó la tienda, no se le pregunta nada a Talo, así que un id inventado no genera tráfico;
  - si es de la tienda, se le pregunta a Talo con la credencial propia;
  - se exige que el pago sea de ese pedido (`external_id`) y que haya llegado el monto.
- **El aviso de Mercado Pago** sigue con su firma (HMAC) y la consulta del pago a Mercado Pago.
- **Transferencias a la cuenta de Mercado Pago:**
  - se reconocen por un monto único: el total más 1 a 99 centavos. Lo garantiza un índice único de la base entre los pedidos que esperan;
  - no cuentan las ventas del local (QR/Point), los cobros con tarjeta ni los pagos del checkout (traen número de pedido);
  - con el ajuste apagado, lo que entra a la cuenta ni se mira ni se anota.
- **Una vez y sólo una:** cada transferencia recibida es única por proveedor e id, y el pago, por proveedor y referencia. El aviso, la página abierta y la vuelta del worker pueden llegar a la vez sin cobrar dos veces.
- **Asignar a mano:**
  - pide rol operador y queda en la auditoría;
  - no se puede asignar a un pedido ya cobrado, ni una transferencia que no alcanza.
- **Credenciales:** las de Talo viven sólo en el servidor (la auditoría revisa que no aparezcan en el HTML ni en el JavaScript). El token se renueva solo si Talo lo rechaza.
- **Auditoría** (`tests/seguridad/auditoria.mjs` § 7g):
  - avisos de Talo inventados, con `../`, inyección, de otro tipo o gigantes;
  - la vuelta interna sin credencial;
  - un aviso de Mercado Pago sin firma;
  - el backoffice sin sesión.

## Packs de 2 a 10, Liquidación y menú (etapa 9)

- **Packs:** el rango y los % se validan enteros en el backoffice. Un ajuste viejo o roto se lee como el de fábrica, nunca como «sin tope». La página del pack sólo reconoce `pack-x2` a `pack-x20` (otra cosa es 404). Una cantidad fuera del rango de Ajustes redirige a la más cercana de la misma prenda, dentro de la tienda. Que no se ofrezca más que el stock es comodidad: el carrito y Stocker lo vuelven a controlar.
- **Liquidación:** es un descuento con la casilla «Es liquidación». Crearlo o editarlo pide sesión de operador y queda en la auditoría, como cualquier descuento. «Mandar a Liquidación…» usa la misma ruta.
- **Parámetros nuevos:** `coleccion` es una lista cerrada y `categoria` un slug validado. Un campo de más es 400 y una categoría que no existe, 404. Nada de eso llega armado a la consulta.
- **Fotos del menú (`/v1/menu`):** sólo nombre, slug y foto de prendas publicadas con stock, 2 por categoría como mucho.
- **Caché de la API con techo:** las claves salen de la dirección (categoría, colección). Antes, pedir miles de slugs inventados las dejaba en memoria para siempre. Ahora, pasadas 5000, se borran las vencidas y, si no alcanza, las más viejas (prueba en `apps/api/test/cache.test.ts`).
- **Auditoría** (`tests/seguridad/auditoria.mjs` § 7h):
  - colección y categoría con `../`, inyección, mayúsculas, 500 letras o un campo de más;
  - que el menú no exponga stock ni precios, y que sus fotos sean claves propias;
  - que el rango de packs de la config esté dentro del tope;
  - el backoffice sin sesión: liquidación, rango de packs;
  - páginas de Packs y Liquidación con un script en la dirección, y `pack-x999` / `pack-x15`.

## Carrito con packs aparte, eliminar productos y guías en Excel (etapa 10)

- **Pack en el carrito:** el navegador manda qué lleva cada pack (SKU y cuántas) y cuántos packs, nunca el %. La API arma el pack sólo si es de una prenda marcada como pack y con una cantidad del rango de Ajustes. Si no, lo avisa y no lo cobra. El stock se controla sumando lo suelto y lo de los packs.
- **A Stocker** va una línea por SKU (Stocker suma las repetidas y se queda con un solo precio): con la misma variante suelta y en pack, el promedio al centavo.
- **Eliminar productos:** pide rol operador y queda en la auditoría. Es una baja suave: una restricción de la base (`eliminado ⇒ oculto`) impide volver a publicarlo por cualquier camino (backoffice, importador mayorista) sin restaurarlo antes.
- **Sólo productos padre desde Stocker:** la tienda descarta lo que venga marcado como evento, pack o combo, además del filtro de Stocker.
- **Excel:**
  - el archivo se lee en el servidor, sin librerías pesadas (fflate + XML);
  - topes: 5 MB el archivo, 40 MB descomprimido (un zip chico que se infla se corta antes), 100 hojas, 500 filas y 50 columnas;
  - no se leen fórmulas ni macros, sólo valores;
  - cada guía se valida con las mismas reglas que el editor, y una hoja mal armada no se importa;
  - importar pide rol operador y queda en la auditoría; exportar pide sesión;
  - el backoffice deja pasar el archivo sólo en esa ruta, con su tipo y hasta 5 MB.
- **Auditoría** (`tests/seguridad/auditoria.mjs` § 7i):
  - packs con %, vacíos, gigantes o mezclados con una suelta;
  - un pack de una prenda que no es pack;
  - eliminar, restaurar y Excel sin sesión;
  - un Excel de 7 MB.

## Direcciones del checkout y aviso del carrito (etapa 11)

- **Google Places sólo desde el servidor:**
  - la clave (`GOOGLE_MAPS_API_KEY`) no llega al navegador: la tienda pregunta a la API y la API a Google;
  - la auditoría revisa que no aparezca en respuestas, HTML ni JavaScript, y que el JS no llame a Google directo.
- **Lo que llega se valida antes de llamar a nadie** (zod estricto, sin campos de más):
  - texto de 3 a 120 caracteres;
  - sesión que tiene que ser un UUID;
  - el id del lugar, sólo letras, números, `_` y `-` (10 a 300), porque va en la URL de Google: nada de `../`, `?`, `%2F`.
  - Lo que contesta Google también se filtra: ids raros se descartan, y los textos se cortan al largo de los campos.
- **Costo acotado:**
  - freno por IP: 150 búsquedas, 40 datos y 80 revisiones cada 10 minutos;
  - topes por día de Argentina en Redis (Ajustes; de fábrica 300 y 300, dentro del uso gratis). Sin Redis no se cuenta, así que no se usa Google: mejor sin ayuda que una factura;
  - sesiones de Google por compra: las búsquedas que terminan en una dirección elegida no se cobran;
  - sólo se pide `addressComponents`, el nivel más barato.
  - Lo peor que logra un abuso es agotar el tope del día: el checkout sigue a mano.
- **Nada frena una compra:**
  - Google o Georef caídos o lentos (3,5 y 4 segundos de tope): sin sugerencias, «escribila a mano» o nada, nunca un 500;
  - los errores de afuera van al registro, no al cliente.
- **Georef:** sin clave. Se cachea 10 minutos por dirección (hasta 2.000), así la misma dirección no sale dos veces.
- **Datos personales:** a Google y Georef va sólo lo que se escribe en la calle (y altura y provincia a Georef), sin nombre, email ni teléfono. Está en la política de privacidad.
- **Tienda (BFF):** sólo `POST /api/t/direcciones/{sugerencias,lugar,revisar}` con `x-isu`. `GET /v1/admin/direcciones` (si hay clave y el uso de hoy) pide sesión del dueño.
- **Aviso del carrito:** es del navegador; el control de verdad sigue en la API, que cotiza con el stock sumando lo suelto y los packs. `disponible` de cada línea ahora descuenta lo de las otras líneas: es lo que el «+» deja sumar, nunca más del stock.
- **Auditoría** (`tests/seguridad/auditoria.mjs` § 7j):
  - entradas malas → 400;
  - sólo POST y sin caché;
  - un lugar desconocido → 503 sin detalles de Google;
  - la clave en ningún lado;
  - ráfaga → 429;
  - la tienda sin `x-isu` → 403;
  - el backoffice sin sesión → 401.

### Links de los locales

- `Local.mapa` (el «Link del local» de Ajustes) es sólo `https://` con un dominio, hasta 500 caracteres: `EnlaceLocal` en shared. La API rechaza `javascript:`, `data:`, `http:` y cualquier texto que no sea un link.
- Un valor viejo guardado antes de exigirlo no rompe nada: la configuración pública muestra el local sin link.
- La tienda abre el link en otra pestaña con `rel="noopener noreferrer"`. Los mails lo vuelven a validar antes de ponerlo en un `href`, y si no es https muestran sólo el nombre.
- **Auditoría** (§ 7k):
  - los links de la configuración pública son sólo https;
  - `/locales` no tiene enlaces `javascript:` ni `data:`;
  - lo que abre otra pestaña va con `noopener`;
  - cambiar los locales pide sesión del dueño.

## Banners interactivos y direcciones sin ids (etapa 12)

- **Los links de los banners son sólo de esta tienda** (tres llaves):
  - `RutaTienda` en shared: una dirección que empieza con `/`, sin `//`, `\\` ni espacios, hasta 300 caracteres;
  - la API rechaza el resto al guardar (botones y link del banner entero);
  - el dibujo (`@isu/ui/banner`) vuelve a revisarlo y, si no es propio, lo dibuja sin link.
  - Nada de `https://`, `javascript:` ni `data:`. Los textos son texto: React no dibuja HTML.
- **Validación estricta** (zod `.strict()`, sin campos de más):
  - largos máximos (título 90, texto 220, etiqueta 40, botón 30);
  - hasta 2 botones;
  - colores y alineación de una lista fija;
  - un dato `{…}` desconocido no se guarda.
  - Producto elegido y automático a la vez → 400. Lo frena también la base: `banners_un_producto`.
- **El producto va por su slug**, nunca por el id. La API lo traduce adentro y la respuesta no lleva `producto_id`. Si el producto se borra, el banner queda sin producto (`ON DELETE SET NULL`).
- **La tarjeta del producto** sale de la misma consulta que la grilla:
  - sólo productos visibles, con stock y con foto;
  - al precio con descuentos de la tienda.
  - El navegador nunca manda un precio.
- **Permisos:**
  - ver la lista y la vista previa pide sesión;
  - crear, editar, sacar fotos, borrar y «Agregar banners sugeridos» pide operador;
  - todo queda en la auditoría del backoffice;
  - hasta 30 banners.
- **Direcciones sin ids:**
  - las fotos y banners nuevos van en una carpeta al azar (`p/3f9a0c1b2d4e/…`, 48 bits): por la dirección no se sabe qué id tiene un producto ni cuántos hay;
  - los patrones del almacén (`PATRON_FOTOS`, `PATRON_BANNERS`) y de `/fotos/…` aceptan los dos formatos, sin `..` ni otra cosa;
  - en el backoffice, productos y guías van por su slug;
  - los comprobantes, por su número dentro del pedido (`/pedidos/ISU-1042/comprobantes/1`).
- **Auditoría** (`tests/seguridad/auditoria.mjs` § 7l, más § 7f ampliada):
  - en la portada:
    - hay banners con título y botones;
    - los botones llevan sólo a rutas propias;
    - con botones o producto, el banner entero no es un link;
    - no queda ningún `{dato}` sin reemplazar;
    - el producto va por slug, sin ids;
    - las fotos nuevas no llevan el id del banner;
  - el inicio no tiene links `javascript:` ni `data:`;
  - las fotos de productos van sin id;
  - las rutas nuevas del backoffice (por slug, sacar foto, sugeridos, vista previa del producto, comprobante por número) con token inventado → 401.

## Datos de clientes y Correo Argentino con MiCorreo (etapa 15)

- **Los datos de un cliente** (nombre, email, teléfono, DNI, dirección) los ve sólo quien se identifica como el cliente o como alguien del backoffice. Si no, se rechaza:
  - **el cliente:**
    - su pedido, con la sesión de su cuenta o con el token de acceso del enlace que le llegó por mail (en la base, sólo su hash);
    - el seguimiento público, con el enlace firmado: muestra el nombre de pila y el envío, nada más;
    - el chat: número de pedido **y** email, con freno; responde sólo el estado.
  - **el backoffice:** usuario, contraseña y doble factor. Preparar envíos, imprimir etiquetas y cargar el número del rótulo piden operador.
- **Queda registrado quién miró:** cada vez que alguien del backoffice abre un pedido o la lista de pedidos, de clientes o de envíos, va a la auditoría (`ver_datos_cliente`, entidad `datos_cliente`): quién, qué, cuándo y desde qué IP. Una vez por persona, dato y hora (con Redis), para no llenarla al recargar. La auditoría no se puede editar ni borrar.
- **A Correo le llega sólo lo del envío:** nombre, email, teléfono y dirección (o sucursal). El DNI no.
- **MiCorreo:**
  - las credenciales de la API sólo en el servidor (`CORREO_AR_*`); `pnpm correo:cliente` pide la contraseña de MiCorreo sin mostrarla ni guardarla;
  - el seguimiento de MiCorreo (un GET con cuerpo) usa el mismo cuidado que el resto: tiempo máximo, sin redirecciones y hasta 2 MB de respuesta;
  - la referencia de cada envío en MiCorreo es el id interno del intento (no se repite);
  - el número del rótulo: sólo letras y números (8 a 40); no se puede repetir en otro pedido ni cambiar después del despacho, y cada carga queda en la auditoría.
  - El simulador (y su portal) no se usa nunca en producción: con `NODE_ENV=production` se ignora `TRANSPORTES_SIMULADOR`.
- **Auditoría** (`tests/seguridad/auditoria.mjs` § 7n):
  - sin sesión o con un token inventado, los pedidos, clientes, envíos, etiquetas, preparar, el número del rótulo y el peso y las medidas → 401, sin datos;
  - un pedido de la tienda sin la sesión de su dueño o con un acceso inventado no se muestra;
  - el seguimiento con firma inventada → 404;
  - un número de rótulo con HTML se rechaza.
