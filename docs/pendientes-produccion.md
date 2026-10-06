# Pendiente para salir a producción

Datos y cuentas que faltan. La tienda funciona sin ellos en local (con los
simuladores), pero no se puede abrir al público hasta completarlos.

| Qué | Dónde va | Estado |
|---|---|---|
| Razón social y CUIT | `NEXT_PUBLIC_RAZON_SOCIAL`, `NEXT_PUBLIC_CUIT` (web): aparecen en términos, privacidad y pie | Pendiente |
| Dominio definitivo (p. ej. `www.isuwaya.com.ar`, `api.…`, `admin.…`, `fotos.…`) | `NEXT_PUBLIC_SITE_URL`, `SITIO_URL`, `API_PUBLICA_URL`, `ORIGENES_PERMITIDOS`, DNS en Cloudflare | Pendiente |
| ID de Google Analytics 4 (`G-…`) | `NEXT_PUBLIC_GA_ID` (web) | Pendiente |
| Mercado Pago: Access token de producción | `MP_ACCESS_TOKEN` (api) | Pendiente |
| Mercado Pago: clave secreta del webhook | `MP_WEBHOOK_SECRET` (api); URL del webhook: `https://api.<dominio>/v1/pagos/mercadopago/aviso` | Pendiente |
| Datos para transferir: titular, CUIT, banco, CBU, alias | Backoffice → Ajustes → Transferencia | Pendiente |
| Transferencias que se confirman solas (opcional): credenciales de Talo, o los datos de la cuenta de Mercado Pago | `TALO_USER_ID` `TALO_CLIENT_ID` `TALO_CLIENT_SECRET` (api) y Ajustes → Transferencias que se confirman solas. Ver `transferencias.md` | Pendiente |
| Cuenta de correo transaccional (SMTP) + SPF/DKIM del dominio | `SMTP_URL`, `CORREO_DE` (worker) | Pendiente |
| Credencial de Stocker (origen «Tienda online minorista») | `STOCKER_TOKEN` (worker y api) | Pendiente (se emite desde el backoffice de Stocker) |
| Locales que abastecen online en Stocker | Stocker → Locales | Revisar |
| Bucket de fotos (público) y de comprobantes (privado) en Cloudflare R2 | `R2_*` (api y worker) | Pendiente |
| Clave de cifrado del backoffice (2FA) | `ADMIN_CLAVE_CIFRADO` (api) — `openssl rand -base64 32` | Generar al desplegar |
| Tokens internos (`INTERNO_TOKEN`, `REVALIDAR_TOKEN`, `PAGOS_TOKEN`) | api, web, worker — `openssl rand -hex 32` | Generar al desplegar |
| Primer usuario del backoffice | `pnpm admin:crear <email> "<nombre>"` contra la base de producción | Crear al desplegar |
| Dirección del botón Mayorista | `MAYORISTA_URL` (web) — hoy `https://www.isuwaya.com`. **Si la tienda nueva pasa a ese dominio, tiene que apuntar a otro** (el sitio mayorista), o el botón lleva a la misma tienda | Confirmar |
| Google Search Console (propiedad de dominio, verificada por DNS) y envío del sitemap | Search Console · Cloudflare (registro TXT) — ver `seo.md` | Pendiente |
| Google Merchant Center: fuente programada `/feed/google.xml` | merchants.google.com — ver `seo.md` | Pendiente |
| Perfil de Empresa de Google de cada local | business.google.com | Pendiente |
| Texto y título para Google de las categorías principales | Backoffice → Categorías → Editar | Pendiente (sin completar se arman solos) |
| Día del cambio de dominio Jumpseller → tienda nueva | `seo.md` § «El día del cambio de dominio» | Pendiente |
| Guías de talles con las medidas reales de cada molde | Backoffice → Guías de talles (y asociarlas a los productos) | Pendiente (las de muestra son de ejemplo) |
| Destacados y Nuevos iniciales | Backoffice → Productos (casillas) | Pendiente |
| Fotos reales de productos | `pnpm mayorista:importar --aplicar` (trae las del sitio mayorista, ver `salida-produccion.md` § 2), `pnpm fotos:importar` o Backoffice → Productos → Fotos | Pendiente (correr la importación en producción) |
| Fotos de los 13 productos que el mayorista no tiene (SOFT, MONTAN, Cruze, Cloe, Sasha, Sidney, Berlin, Visa, Zara, Garo, Letra, Maev, Mara) | Backoffice → Productos → Fotos, y después tildar **Visible** | Pendiente (quedan ocultos) |
| Medidas de Cloe en su guía de talles (se vende en talle Único) | Backoffice → Guías de talles | Pendiente |
| Cupones y promociones de lanzamiento | Backoffice → Cupones (los de muestra `BIENVENIDA10` / `ENVIOGRATIS` son sólo del entorno local) | Decidir |
| Costo de envío estándar (si no hay transportes o no responde ninguno) y "envío gratis desde" | Backoffice → Ajustes | Revisar |
| **Correo Argentino**: alta en MiCorreo (usuario, clave, n.º de cliente) y **homologación** | `CORREO_AR_*` (api y worker). La etiqueta se imprime desde el portal MiCorreo | Pendiente |
| **Andreani**: contrato, usuario, clave, n.º de cliente, contratos de domicilio y sucursal, y **homologación** | `ANDREANI_*` (api y worker) | Pendiente |
| **OCA e-Pak**: usuario, clave, CUIT, cuenta, operativas de domicilio y sucursal, y **homologación** | `OCA_*` (api y worker) | Pendiente |
| **Mercado Envíos**: activarlo en la cuenta de Mercado Pago / Mercado Libre y probar un envío real | `MERCADO_ENVIOS_ACTIVO=true` (usa `MP_ACCESS_TOKEN`) | Pendiente |
| **Cabify Logistics**: cuenta de empresa, credenciales y **confirmar el contrato de la API** (los campos se armaron con la documentación pública; revisarlos con Cabify antes de salir) | `CABIFY_*` (api y worker) | Pendiente |
| **WhatsApp**: número en Meta Cloud API (el de Stocker u otro) y **aprobar las 5 plantillas** en español (Argentina): `pedido_en_camino` ({{1}} nombre, {{2}} pedido, {{3}} transporte, {{4}} enlace), `pedido_en_sucursal` ({{1}}, {{2}}, {{3}} sucursal, {{4}} enlace), `pedido_llega_hoy` ({{1}}, {{2}}, {{3}} enlace), `pedido_entregado` ({{1}}, {{2}}), `pedido_no_entregado` ({{1}}, {{2}}, {{3}} transporte, {{4}} enlace) | `WHATSAPP_META_*` (worker) | Pendiente |
| Remitente (dirección del depósito, CUIT, teléfono) y medidas reales de las cajas | Backoffice → Ajustes → Remitente y Paquete | Revisar |
| Peso de las prendas pesadas (camperas, jeans) | Backoffice → Productos → Peso para el envío | Pendiente |
| Códigos postales, días y hora de corte de los envíos en el día | Backoffice → Ajustes → Envíos en el día | Revisar |
| **Asistente**: revisar las preguntas frecuentes de arranque (textos, plazos reales) con alguien de atención | Backoffice → Asistente | Pendiente |
| **Asistente con IA** (opcional): cuenta en console.anthropic.com, clave y tope diario. Costo aproximado con el modelo por defecto (`claude-opus-5-5`, US$4 / US$20 por millón de tokens de entrada/salida): 1 a 2 centavos de dólar por consulta con IA (sólo las que no cubren las preguntas frecuentes); con el tope de 300 por día, como mucho unos US$5 diarios. Se puede usar otro modelo con `CHATBOT_MODELO` | `ANTHROPIC_API_KEY` (api) + Backoffice → Ajustes | Decidir |
| Variables de transportes y WhatsApp también en el **worker** (sigue los envíos y manda los avisos) | Railway → worker | Al desplegar |

Cuando estén, se cargan en Railway (variables) y en el backoffice (ajustes);
no hace falta tocar código.
