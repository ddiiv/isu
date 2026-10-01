# Salida a producción

Guía para el día de la salida, en orden. El detalle de cada servicio está en
[`despliegue.md`](despliegue.md) y lo que falta cargar (cuentas, credenciales,
textos) en [`pendientes-produccion.md`](pendientes-produccion.md): esto es el
**orden**, las **pruebas de humo** y **cómo volver atrás**.

Regla general: primero Stocker, después la tienda; primero lo que no se ve
(base, API, worker), después lo que se ve (web). La tienda puede estar
publicada y **cerrada** (sin dominio público) hasta la última prueba.

## 0. Antes del día (una semana antes)

- [ ] Todo lo de `pendientes-produccion.md` en "Listo": razón social y CUIT, dominio, Mercado Pago de producción, datos bancarios, SMTP con SPF/DKIM, buckets R2, credencial de Stocker.
- [ ] **Transportes homologados** uno por uno con credenciales reales (cotizar, preparar, etiqueta, despachar, seguimiento). Los que no estén homologados: **apagados** en Ajustes → Transportes (queda el envío estándar).
- [ ] Plantillas de WhatsApp **aprobadas** en Meta (si no, dejar apagado "Avisos por WhatsApp"; los mails salen igual).
- [ ] Preguntas frecuentes del asistente revisadas por alguien de atención (Backoffice → Asistente). Decidir si se prende la IA (`ANTHROPIC_API_KEY` + Ajustes; tiene costo por consulta, con tope diario).
- [ ] Backup de la base de Stocker (Railway → Postgres → *Backups*) y probar restaurarlo en un proyecto aparte.

## 1. Stocker (fuera del horario de venta)

1. Backup manual de la base.
2. Aplicar los parches de Stocker en este orden (con `git apply --check` antes de cada uno): backend acumulado (etapas 1, 2 y 4), frontend acumulado (etapas 2 y 4), backoffice. Desplegar backend y frontend.
3. En Stocker: *Integraciones* → negocio ISUWAYA → origen **Tienda online minorista** → *Emitir* (el token se ve una sola vez) y marcar los locales que **abastecen online**.
4. Humo en Stocker: la venta en el local, Mercado Libre y Jumpseller siguen funcionando como antes (un pedido de prueba en cada uno, y cancelarlo).

## 2. Base y servicios de la tienda

1. Crear el usuario de base con `infra/sql/rol-tienda.sql` (sólo el esquema `tienda`; no puede tocar tablas de Stocker — lo comprueba `node tests/seguridad/aislamiento-db.mjs`).
2. Redis y los cuatro servicios (api, worker, web, admin) con sus variables (`despliegue.md` § 4). Tokens nuevos con `openssl rand -hex 32` y `ADMIN_CLAVE_CIFRADO` con `openssl rand -base64 32` (**no cambiarla después**).
3. Desplegar **api** primero: al arrancar aplica las migraciones (0001 a 0011) con un candado, así dos réplicas no migran a la vez. Mirar el log: "migraciones aplicadas".
4. Desplegar **worker**: trae el catálogo de Stocker (en el log: productos y variantes aplicados). Si dice "sin locales online", volver al paso 1.3.
5. **Fotos y categorías del mayorista** (consola del servicio **worker** — Railway → worker → los tres puntos del deploy → *Shell*, o `railway ssh --service worker` —, con el catálogo ya sincronizado; ahí `DATABASE_URL` y `R2_*` ya son los de producción):
   `node dist/mayorista/cli.js` muestra el plan sin escribir nada (productos enganchados, fotos por color, categorías, los que no están en Stocker). Revisarlo y después `node dist/mayorista/cli.js --aplicar` (tarda ~15 min: le pide las fotos al sitio mayorista de a una). Si se corta, volver a correrlo: completa lo que falta sin duplicar.
6. Desplegar **web** y **admin**, y comprobar: `pnpm diagnostico https://<web> https://<admin>` (desde tu compu) → "Todo bien".
7. Primer usuario del backoffice: consola del servicio api → `node dist/cli/crear-admin.js dueno@<dominio> "Nombre"`.

## 3. Cloudflare y dominio

> Si la tienda nueva reemplaza a la de Jumpseller en `www.isuwaya.com`, seguí también [`seo.md`](seo.md) § «El día del cambio de dominio»: las direcciones viejas ya redirigen solas, pero hay que correr el chequeo, actualizar `MAYORISTA_URL` si apuntaba a ese dominio y avisar a Google.

1. DNS `www`, `api`, `admin` (y `fotos` al bucket R2) **proxied**, SSL *Full (strict)*.
2. Reglas: caché de `/_next/static/*`, WAF administrado, *Bot Fight Mode*, límite en `/v1/*`.
3. `admin.` detrás de **Cloudflare Access** con los emails del equipo.
4. Webhook de Mercado Pago apuntando a `https://api.<dominio>/v1/pagos/mercadopago/aviso`.

## 4. Pruebas de humo (con el dominio real, antes de anunciar)

Con una tarjeta real y montos chicos; después se cancela y se devuelve.

- [ ] `https://api.<dominio>/readyz` → base y Redis OK.
- [ ] Inicio, una categoría, una ficha y el buscador cargan con fotos. Precio y stock coinciden con Stocker.
- [ ] Vender una unidad en el local desde Stocker → la tienda la descuenta en segundos.
- [ ] Compra con **Mercado Pago** (retiro en el local): vuelve a la tienda con "¡Pago confirmado!", llega el mail, el pedido aparece en Stocker como pagado.
- [ ] Compra con **transferencia** y envío con un transporte: registrar el pago en el backoffice → Envíos → Preparar → Imprimir etiqueta → despachar en **Envíos del día de Stocker** → el pedido pasa a "En camino", llegan mail y WhatsApp, y el enlace de seguimiento abre.
- [ ] **Arrepentimiento** de una de las compras: código de trámite por mail y mercadería devuelta en Stocker.
- [ ] Asistente: "¿cuánto sale el envío a 5000?", "¿dónde está mi pedido?" (con la compra de prueba), "¿qué talle soy?".
- [ ] Cupón: crear uno de prueba en Backoffice → Cupones, usarlo en una compra (se ve en el pedido, en el mail y en el detalle del pedido en Stocker) y después borrarlo o pausarlo.
- [ ] Catálogo importado: una prenda con fotos por color (la ficha abre en el color de la foto principal), Abyys en "Negro", Cloe oculta hasta tener fotos.
- [ ] Backoffice: ingreso con doble factor, editar un producto, ver la auditoría.
- [ ] Mails: llegan a Gmail y a Outlook sin ir a spam.
- [ ] `pnpm seo https://www.<dominio> --viejas docs/direcciones-jumpseller.txt` → «Todo bien para Google» (las direcciones de la tienda anterior llegan a su página nueva).
- [ ] `pnpm seguridad` contra producción (`API_URL`, `WEB_URL`, `ADMIN_URL` con los dominios reales) → todo OK. **No** correr `tests/carga` contra producción en horario de venta.

## 5. Abrir

- Google Search Console: verificar el dominio (por DNS) y enviar `https://www.<dominio>/sitemap.xml`.
- Google Merchant Center: fuente de datos programada `https://www.<dominio>/feed/google.xml` (aparecer gratis en Shopping). Perfil de Empresa de Google para cada local. Detalle en [`seo.md`](seo.md).
- GA4: ver que lleguen visitas y la compra de prueba (`purchase`).
- Anunciar.

## 6. Primera semana

- Search Console → *Páginas → No encontrada (404)*: si aparece una dirección vieja, agregarla en Backoffice → Redirecciones.
- Mirar a diario: Backoffice → Panel (lo que hay que atender), Envíos → **Problemas**, Asistente → **Sin respuesta** (sumar preguntas), y los logs de api y worker en Railway.
- Railway → *Metrics*: CPU y memoria de api/worker; conexiones de la base (la tienda usa como mucho `DB_POOL_MAX` × réplicas + 4 del worker + 1 de la escucha).

## Volver atrás

La tienda es **aditiva**: todo lo suyo vive en el esquema `tienda` y en tablas/columnas nuevas de Stocker que Stocker ignora si no las usa.

| Qué falla | Qué hacer |
|---|---|
| La tienda (web/api) | Railway → servicio → *Deployments* → **Redeploy** del anterior. Las migraciones son hacia adelante y compatibles con la versión anterior del código. Mientras tanto, se puede sacar el DNS de `www` (Cloudflare → página de mantenimiento). |
| El worker | Apagarlo no rompe la venta: los pedidos quedan en la cola de Redis y se procesan al volver. Lo que se atrasa: sincronización de stock (la tienda puede vender algo agotado: Stocker lo rechaza y el cliente ve "sin stock"), mails y seguimiento. |
| Stocker después del parche | Redeploy de la versión anterior de Stocker. Las columnas nuevas (`pagoPendiente`, `envioTipo`, `envioId`…) quedan y no molestan; los pedidos de la tienda en curso siguen en la base. Pausar la tienda (sacar `www`) hasta volver a aplicar el parche. |
| Un transporte | Apagarlo en Ajustes → Transportes. Los envíos ya creados siguen con su número; el seguimiento de ese transporte queda en "Problemas" si su API no responde. |
| La IA del asistente | Apagarla en Ajustes (o sacar `ANTHROPIC_API_KEY`): el asistente sigue con las preguntas frecuentes. |
| El asistente entero | Ajustes → "Mostrar el asistente" apagado: vuelve el botón de WhatsApp. |
| Un cupón mal cargado | Backoffice → Cupones → **Pausar**: deja de aplicarse al instante (los pedidos ya hechos conservan su precio). |
| La importación del mayorista | Las fotos se pueden borrar o reordenar por producto en el backoffice; `--reemplazar` vuelve a traerlas de cero. No toca precios ni stock. |
