# Despliegue: Railway + Cloudflare

## Railway (mismo proyecto que Stocker y el portal mayorista)

1. **Usuario de base.** En el Postgres de Stocker (pestaña *Data* → *Query*, o `psql` con la URL de admin) correr `infra/sql/rol-tienda.sql` con una clave larga.
2. **Redis.** *New → Database → Redis*.
3. **Cuatro servicios desde este repo** (*New → GitHub repo*). En cada uno: *Settings → Config-as-code → Railway config file* = `infra/railway/<servicio>.json`. Root directory: la raíz del repo (es un monorepo pnpm).
4. **Variables** (ver `.env.example`):

| Servicio | Variables |
|---|---|
| api | `DATABASE_URL` = `postgres://tienda_app:<clave>@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}` · `REDIS_URL=${{Redis.REDIS_URL}}` · `ORIGENES_PERMITIDOS=https://www.<dominio>,https://admin.<dominio>` · `PROXIES_DE_CONFIANZA=2` · `INTERNO_TOKEN` · `NODE_ENV=production` |
| web | `API_URL=http://${{tienda-api.RAILWAY_PRIVATE_DOMAIN}}:4000` · `NEXT_PUBLIC_SITE_URL=https://www.<dominio>` · `NEXT_PUBLIC_CDN_IMAGENES=https://fotos.<dominio>` · `INTERNO_TOKEN` (el mismo que la API) · `REVALIDAR_TOKEN` · `NEXT_PUBLIC_GA_ID` · `NEXT_PUBLIC_RAZON_SOCIAL` · `NEXT_PUBLIC_CUIT` |
| admin | `API_URL` (igual que web) · `ADMIN_URL=https://admin.<dominio>` · `INTERNO_TOKEN` (el mismo que la API) · `PROXIES_DE_CONFIANZA=2` · `NEXT_PUBLIC_CDN_IMAGENES` (igual que web) · `NEXT_PUBLIC_SITE_URL` (para "Ver en la tienda") |
| api (etapa 3) | `ADMIN_CLAVE_CIFRADO` (`openssl rand -base64 32`; **no cambiarla después**: todos tendrían que volver a configurar el doble factor) · `R2_*` del bucket público de fotos (para subir fotos desde el backoffice) |
| web (etapa 3) | `MAYORISTA_URL` (a dónde lleva el botón Mayorista; se cambia en cualquier momento, sin volver a publicar) |
| api (etapa 2) | `SITIO_URL=https://www.<dominio>` · `API_PUBLICA_URL=https://api.<dominio>` · `MP_ACCESS_TOKEN` · `MP_WEBHOOK_SECRET` · `PAGOS_TOKEN` · `R2_CUENTA` `R2_BUCKET_PRIVADO` `R2_ACCESS_KEY_ID` `R2_SECRET_ACCESS_KEY` (comprobantes) |
| web (etapa 2) | `PROXIES_DE_CONFIANZA=2` (para frenar abusos por IP real) |
| worker (etapa 2) | `API_URL` (igual que la web) · `INTERNO_TOKEN` · `SMTP_URL` · `CORREO_DE` · `CORREO_RESPONDER` |
| worker | `DATABASE_URL` (igual que la API) · `REDIS_URL=${{Redis.REDIS_URL}}` · `STOCKER_API_URL=http://${{<backend de Stocker>.RAILWAY_PRIVATE_DOMAIN}}:<puerto>` (sin `/api`) · `STOCKER_TOKEN` · `WEB_INTERNAL_URL=http://${{tienda-web.RAILWAY_PRIVATE_DOMAIN}}:<puerto>` · `REVALIDAR_TOKEN` (el mismo que la web) · `R2_*` si se importan fotos desde el servidor |

Tokens nuevos (`INTERNO_TOKEN`, `REVALIDAR_TOKEN`): `openssl rand -hex 32`, uno distinto para cada uno.

**Primer usuario del backoffice** (etapa 3), una sola vez, desde la consola del servicio `tienda-api` en Railway:
`node dist/cli/crear-admin.js dueno@<dominio> "Nombre Apellido"` — imprime una contraseña provisoria; al entrar pide configurar el doble factor y cambiarla. Los demás usuarios se crean desde Backoffice → Usuarios. Si el único dueño pierde el celular, el mismo comando lo restablece.

`HOST` queda en `::` (Railway enruta la red privada por IPv6).

5. **Credencial de Stocker.** Aplicar el patch de Stocker (backend y backoffice), entrar al backoffice de Stocker → *Integraciones* → negocio ISUWAYA → origen **Tienda online minorista** → *Emitir*. El token se muestra una sola vez: va en `STOCKER_TOKEN` del worker. En Stocker, marcar qué locales **abastecen online** (si no hay ninguno, todo sale sin stock y el worker lo registra).
6. **Fotos (Cloudflare R2).** Crear un bucket (p. ej. `isuwaya-fotos`), conectarle un dominio propio (`fotos.<dominio>`) con acceso público de lectura y crear un token de API de R2 con permiso de escritura sólo sobre ese bucket. Subir fotos: `pnpm fotos:importar <carpeta>` con `DATABASE_URL` y `R2_CUENTA`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (forma de la carpeta en `apps/worker/src/fotos/importar.ts`). En la etapa 3 se suben desde el backoffice.
7. **Mercado Pago.** En *Tus integraciones* → tu aplicación → *Credenciales de producción*: el **Access token** va en `MP_ACCESS_TOKEN`. En *Webhooks*: URL `https://api.<dominio>/v1/pagos/mercadopago/aviso`, evento **Pagos**, y la **clave secreta** va en `MP_WEBHOOK_SECRET`. Las cuotas sin interés se configuran en la cuenta de Mercado Pago (promociones); la tienda sólo las anuncia.
8. **Transferencias.** Cargar titular, CUIT, banco, CBU y alias (ajuste `datosTransferencia`; en la etapa 3, desde el backoffice). Sin CBU ni alias el checkout no ofrece transferencia. Para confirmar una transferencia: `POST https://api.<dominio>/v1/pagos/registrar` con `Authorization: Bearer <PAGOS_TOKEN>` y `{ pedido, medio: "transferencia"|"local", monto (centavos), referencia, quien }`.
9. **Mails.** Un SMTP transaccional (Gmail Workspace con contraseña de aplicación, Brevo, Amazon SES…): `SMTP_URL=smtp://usuario:clave@host:587`. Configurar SPF y DKIM del dominio para que no caigan en spam.
10. **Healthchecks**: la API usa `/healthz` (proceso vivo; no se reinicia si la base parpadea). `/readyz` dice si base y Redis responden.

## Cloudflare

- DNS: `www`, `api` y `admin` en modo **proxied** (nube naranja) apuntando a los dominios de Railway. SSL/TLS en **Full (strict)**.
- **Caché:** regla "Cache everything" para `/_next/static/*` (inmutable, 1 año). El HTML y `/v1/config`, `/v1/categorias` respetan el `s-maxage` que manda el origen.
- **WAF:** reglas administradas de Cloudflare activadas; *Bot Fight Mode*; regla de rate limiting en `/v1/*` (p. ej. 600 pedidos/min por IP) como primera barrera, además del límite propio de la API.
- **admin.**: *Cloudflare Access* (Zero Trust, gratis hasta 50 usuarios) con los emails del equipo: el backoffice ni siquiera es alcanzable desde afuera. Sin caché.
- Con Cloudflare adelante, `PROXIES_DE_CONFIANZA=2` (Cloudflare + borde de Railway) hace que la API vea la IP real del cliente.
