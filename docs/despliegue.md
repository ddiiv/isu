# Despliegue: Railway + Cloudflare

## Railway (mismo proyecto que Stocker y el portal mayorista)

1. **Usuario de base.** En el Postgres de Stocker (pestaña *Data* → *Query*, o `psql` con la URL de admin) correr `infra/sql/rol-tienda.sql` con una clave larga.
2. **Redis.** *New → Database → Redis*.
3. **Cuatro servicios desde este repo** (*New → GitHub repo*). En cada uno: *Settings → Config-as-code → Railway config file* = `infra/railway/<servicio>.json`. Root directory: la raíz del repo (es un monorepo pnpm).
4. **Variables** (ver `.env.example`):

| Servicio | Variables |
|---|---|
| api | `DATABASE_URL` = `postgres://tienda_app:<clave>@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}` · `REDIS_URL=${{Redis.REDIS_URL}}` · `ORIGENES_PERMITIDOS=https://www.<dominio>,https://admin.<dominio>` · `PROXIES_DE_CONFIANZA=2` · `NODE_ENV=production` |
| web | `API_URL=http://${{tienda-api.RAILWAY_PRIVATE_DOMAIN}}:4000` · `NEXT_PUBLIC_SITE_URL=https://www.<dominio>` · `NEXT_PUBLIC_GA_ID` · `NEXT_PUBLIC_RAZON_SOCIAL` · `NEXT_PUBLIC_CUIT` |
| admin | `API_URL` (igual que web) |
| worker | `REDIS_URL=${{Redis.REDIS_URL}}` |

`HOST` queda en `::` (Railway enruta la red privada por IPv6).

5. **Healthchecks**: la API usa `/healthz` (proceso vivo; no se reinicia si la base parpadea). `/readyz` dice si base y Redis responden.

## Cloudflare

- DNS: `www`, `api` y `admin` en modo **proxied** (nube naranja) apuntando a los dominios de Railway. SSL/TLS en **Full (strict)**.
- **Caché:** regla "Cache everything" para `/_next/static/*` (inmutable, 1 año). El HTML y `/v1/config`, `/v1/categorias` respetan el `s-maxage` que manda el origen.
- **WAF:** reglas administradas de Cloudflare activadas; *Bot Fight Mode*; regla de rate limiting en `/v1/*` (p. ej. 600 pedidos/min por IP) como primera barrera, además del límite propio de la API.
- **admin.**: *Cloudflare Access* (Zero Trust, gratis hasta 50 usuarios) con los emails del equipo: el backoffice ni siquiera es alcanzable desde afuera. Sin caché.
- Con Cloudflare adelante, `PROXIES_DE_CONFIANZA=2` (Cloudflare + borde de Railway) hace que la API vea la IP real del cliente.
