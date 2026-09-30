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
| Cuenta de correo transaccional (SMTP) + SPF/DKIM del dominio | `SMTP_URL`, `CORREO_DE` (worker) | Pendiente |
| Credencial de Stocker (origen «Tienda online minorista») | `STOCKER_TOKEN` (worker y api) | Pendiente (se emite desde el backoffice de Stocker) |
| Locales que abastecen online en Stocker | Stocker → Locales | Revisar |
| Bucket de fotos (público) y de comprobantes (privado) en Cloudflare R2 | `R2_*` (api y worker) | Pendiente |
| Clave de cifrado del backoffice (2FA) | `ADMIN_CLAVE_CIFRADO` (api) — `openssl rand -base64 32` | Generar al desplegar |
| Tokens internos (`INTERNO_TOKEN`, `REVALIDAR_TOKEN`, `PAGOS_TOKEN`) | api, web, worker — `openssl rand -hex 32` | Generar al desplegar |
| Primer usuario del backoffice | `pnpm admin:crear <email> "<nombre>"` contra la base de producción | Crear al desplegar |
| Dirección del botón Mayorista | `MAYORISTA_URL` (web) — hoy `https://www.isuwaya.com` | Confirmar |
| Guías de talles con las medidas reales de cada molde | Backoffice → Guías de talles (y asociarlas a los productos) | Pendiente (las de muestra son de ejemplo) |
| Destacados y Nuevos iniciales | Backoffice → Productos (casillas) | Pendiente |
| Fotos reales de productos | `pnpm fotos:importar` o Backoffice → Productos → Fotos | Pendiente |
| Costo de envío fijo y "envío gratis desde" (hasta la etapa 4) | Backoffice → Ajustes | Revisar |

Cuando estén, se cargan en Railway (variables) y en el backoffice (ajustes);
no hace falta tocar código.
