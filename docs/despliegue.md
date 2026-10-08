# Despliegue: Railway + Cloudflare

> **¿Pocos servicios disponibles en el plan?** La tienda entera puede ir en **un solo servicio** (más un Redis): [`un-servicio.md`](un-servicio.md). Lo de abajo es la versión con cuatro servicios separados.

## Railway (mismo proyecto que Stocker y el portal mayorista)

1. **Usuario de base.** En el Postgres de Stocker (pestaña *Data* → *Query*, o `psql` con la URL de admin) correr `infra/sql/rol-tienda.sql` con una clave larga.
2. **Redis.** *New → Database → Redis*.
3. **Cuatro servicios desde este repo** (*New → GitHub repo*). En cada uno: *Settings → Config-as-code → Railway config file* = `infra/railway/<servicio>.json`. Root directory: la raíz del repo (es un monorepo pnpm).
4. **Variables** (ver `.env.example`):

| Servicio | Variables |
|---|---|
| api | `PORT=4000` (**fijarlo**: si no, Railway le asigna otro y la tienda no la encuentra) · `DATABASE_URL` = `postgres://tienda_app:<clave>@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}` · `REDIS_URL=${{Redis.REDIS_URL}}/1` (base 1 del Redis compartido: `redis-compartido.md`) · `ORIGENES_PERMITIDOS=https://www.<dominio>,https://admin.<dominio>` · `PROXIES_DE_CONFIANZA=2` · `INTERNO_TOKEN` · `NODE_ENV=production` |
| web | `API_URL=http://${{tienda-api.RAILWAY_PRIVATE_DOMAIN}}:${{tienda-api.PORT}}` · `NEXT_PUBLIC_SITE_URL=https://www.<dominio>` · `NEXT_PUBLIC_CDN_IMAGENES=https://fotos.<dominio>` · `INTERNO_TOKEN` (el mismo que la API) · `REVALIDAR_TOKEN` · `NEXT_PUBLIC_GA_ID` · `NEXT_PUBLIC_RAZON_SOCIAL` · `NEXT_PUBLIC_CUIT` · opcional `GOOGLE_SITE_VERIFICATION` / `BING_SITE_VERIFICATION` (si no se verifica por DNS; ver `seo.md`) |
| admin | `API_URL` (igual que web) · `ADMIN_URL=https://admin.<dominio>` · `INTERNO_TOKEN` (el mismo que la API) · `PROXIES_DE_CONFIANZA=2` · `NEXT_PUBLIC_CDN_IMAGENES` (igual que web) · `NEXT_PUBLIC_SITE_URL` (para "Ver en la tienda") |
| api (etapa 3) | `ADMIN_CLAVE_CIFRADO` (`openssl rand -base64 32`; **no cambiarla después**: todos tendrían que volver a configurar el doble factor) · `R2_*` del bucket público de fotos (para subir fotos desde el backoffice) |
| web (etapa 3) | `MAYORISTA_URL` (a dónde lleva el botón Mayorista; se cambia en cualquier momento, sin volver a publicar) |
| api (etapa 2) | `SITIO_URL=https://www.<dominio>` · `API_PUBLICA_URL=https://api.<dominio>` · `MP_ACCESS_TOKEN` · `MP_WEBHOOK_SECRET` · `PAGOS_TOKEN` · `R2_CUENTA` `R2_BUCKET_PRIVADO` `R2_ACCESS_KEY_ID` `R2_SECRET_ACCESS_KEY` (comprobantes) |
| web (etapa 2) | `PROXIES_DE_CONFIANZA=2` (para frenar abusos por IP real) |
| worker (etapa 2) | `API_URL` (igual que la web) · `INTERNO_TOKEN` · `SMTP_URL` · `CORREO_DE` · `CORREO_RESPONDER` |
| api y worker (etapa 4) | Las credenciales de cada transporte que se use (`CORREO_AR_*`, `ANDREANI_*`, `OCA_*`, `MERCADO_ENVIOS_ACTIVO=true`, `CABIFY_*`; ver `.env.example`) **en los dos servicios**: la API cotiza y genera etiquetas; el worker sigue los envíos. **Nunca** `TRANSPORTES_SIMULADOR` |
| worker (etapa 4) | `SITIO_URL=https://www.<dominio>` (enlace de seguimiento de los avisos) · `WHATSAPP_META_TOKEN` · `WHATSAPP_META_PHONE_NUMBER_ID` (y opcionales `WHATSAPP_META_API_VERSION`, `WHATSAPP_IDIOMA`) · `MP_ACCESS_TOKEN` si se usa Mercado Envíos |
| api (etapa 5) | Opcional: `ANTHROPIC_API_KEY` (respuestas con IA del asistente; además hay que prenderlo en Ajustes) y `CHATBOT_MODELO` |
| api (etapa 11) | Opcional: `GOOGLE_MAPS_API_KEY` (sugerencias de calle en el checkout; clave de Google Cloud con «Places API (New)», cómo sacarla en `direcciones-checkout.md`). **No** poner `GOOGLE_PLACES_URL` ni `GEOREF_URL` (son para los simuladores); `GEOREF_URL=off` apaga la revisión de Georef |
| worker | `DATABASE_URL` (igual que la API) · `REDIS_URL=${{Redis.REDIS_URL}}/1` (base 1 del Redis compartido: `redis-compartido.md`) · `STOCKER_API_URL=http://${{<backend de Stocker>.RAILWAY_PRIVATE_DOMAIN}}:<puerto>` (sin `/api`) · `STOCKER_TOKEN` · `WEB_INTERNAL_URL=http://${{tienda-web.RAILWAY_PRIVATE_DOMAIN}}:${{tienda-web.PORT}}` (con `PORT=3000` fijo en la web) · `REVALIDAR_TOKEN` (el mismo que la web) · `R2_*` si se importan fotos desde el servidor |

Tokens nuevos (`INTERNO_TOKEN`, `REVALIDAR_TOKEN`): `openssl rand -hex 32`, uno distinto para cada uno.

**Primer usuario del backoffice** (etapa 3), una sola vez, desde la consola del servicio `tienda-api` en Railway:
`node dist/cli/crear-admin.js dueno@<dominio> "Nombre Apellido"` — imprime una contraseña provisoria; al entrar pide configurar el doble factor y cambiarla. Los demás usuarios se crean desde Backoffice → Usuarios. Si el único dueño pierde el celular, el mismo comando lo restablece.

`HOST` queda en `::` (Railway enruta la red privada por IPv6).

**No copiar el `.env` de desarrollo a Railway**: trae `DATABASE_URL`, `API_URL`, `REDIS_URL` y `STOCKER_API_URL` apuntando a `127.0.0.1` (la propia máquina). En Railway eso no existe: la tienda carga vacía, los botones que le hablan a la API no responden y los comandos (`mayorista:importar`, `crear-admin`) fallan con `ECONNREFUSED 127.0.0.1`. Cada variable va con las referencias de arriba (`${{…}}`).

**Comprobar la instalación** (desde cualquier compu, no cambia nada): `pnpm diagnostico https://www.<dominio> https://admin.<dominio>` — dice si llegan los archivos del navegador, si la tienda llega a la API, a la base y a Redis, cuántos productos hay y si el dominio configurado coincide, y qué revisar en cada caso.

5. **Credencial de Stocker.** Aplicar el patch de Stocker (backend y backoffice), entrar al backoffice de Stocker → *Integraciones* → negocio ISUWAYA → origen **Tienda online minorista** → *Emitir*. El token se muestra una sola vez: va en `STOCKER_TOKEN` del worker. En Stocker, marcar qué locales **abastecen online** (si no hay ninguno, todo sale sin stock y el worker lo registra).
6. **Fotos (Cloudflare R2).** Crear un bucket (p. ej. `isuwaya-fotos`), conectarle un dominio propio (`fotos.<dominio>`) con acceso público de lectura y crear un token de API de R2 con permiso de escritura sólo sobre ese bucket. Subir fotos: `pnpm fotos:importar <carpeta>` con `DATABASE_URL` y `R2_CUENTA`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (forma de la carpeta en `apps/worker/src/fotos/importar.ts`). En la etapa 3 se suben desde el backoffice.
7. **Mercado Pago.** En *Tus integraciones* → tu aplicación → *Credenciales de producción*: el **Access token** va en `MP_ACCESS_TOKEN`. En *Webhooks*: URL `https://api.<dominio>/v1/pagos/mercadopago/aviso`, evento **Pagos**, y la **clave secreta** va en `MP_WEBHOOK_SECRET`. Las cuotas sin interés se configuran en la cuenta de Mercado Pago (promociones); la tienda sólo las anuncia.
8. **Transferencias.** Cargar titular, CUIT, banco, CBU y alias (ajuste `datosTransferencia`; en la etapa 3, desde el backoffice). Sin CBU ni alias el checkout no ofrece transferencia. Para confirmar una transferencia: `POST https://api.<dominio>/v1/pagos/registrar` con `Authorization: Bearer <PAGOS_TOKEN>` y `{ pedido, medio: "transferencia"|"local", monto (centavos), referencia, quien }`.
9. **Mails.** Un SMTP transaccional (Gmail Workspace con contraseña de aplicación, Brevo, Amazon SES…): `SMTP_URL=smtp://usuario:clave@host:587`. Configurar SPF y DKIM del dominio para que no caigan en spam.
10. **Envíos (etapa 4).** Aplicar el patch de Stocker de la etapa 4 (backend y frontend). Cargar las credenciales de cada transporte (arriba) y **homologar** uno por uno: cotizar, preparar un envío real, imprimir la etiqueta, despacharlo en Envíos del día y ver que el seguimiento avance. Aprobar en Meta las 5 plantillas de WhatsApp (textos en `pendientes-produccion.md`). En Backoffice → Ajustes: transportes a ofrecer, remitente, paquete y envíos en el día. Las etiquetas se guardan en el bucket privado (`R2_BUCKET_PRIVADO`, el de los comprobantes).
11. **Asistente (etapa 5).** Nada que configurar para las preguntas frecuentes (se siembran con la migración 0009): revisarlas en Backoffice → Asistente. Para la IA, `ANTHROPIC_API_KEY` en la api y prenderla en Ajustes con un tope diario.
12. **Healthchecks**: la API usa `/healthz` (proceso vivo; no se reinicia si la base parpadea). `/readyz` dice si base y Redis responden.
13. **Fotos sin ids (etapa 12), una sola vez:** con la versión nueva subida, `pnpm fotos:sin-ids` pasa las fotos y banners ya subidos a direcciones sin el id. Con `REDIS_URL`, `WEB_INTERNAL_URL` y `REVALIDAR_TOKEN` regenera también las fichas. Los archivos viejos quedan hasta correrlo con `--borrar-viejas`. Después, revisar en Backoffice → Portada los banners sugeridos que cargó la migración 0019. Ver [`banners-y-direcciones.md`](banners-y-direcciones.md).

## Cloudflare

- DNS: `www`, `api` y `admin` en modo **proxied** (nube naranja) apuntando a los dominios de Railway. SSL/TLS en **Full (strict)**.
- **Caché:** regla "Cache everything" para `/_next/static/*` (inmutable, 1 año). El HTML y `/v1/config`, `/v1/categorias` respetan el `s-maxage` que manda el origen.
- **WAF:** reglas administradas de Cloudflare activadas; *Bot Fight Mode*; regla de rate limiting en `/v1/*` (p. ej. 600 pedidos/min por IP) como primera barrera, además del límite propio de la API.
- **admin.**: *Cloudflare Access* (Zero Trust, gratis hasta 50 usuarios) con los emails del equipo: el backoffice ni siquiera es alcanzable desde afuera. Sin caché.
- Con Cloudflare adelante, `PROXIES_DE_CONFIANZA=2` (Cloudflare + borde de Railway) hace que la API vea la IP real del cliente.
