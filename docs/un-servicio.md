# La tienda en un solo servicio de Railway

Sirve cuando el plan de Railway no deja crear muchos servicios. La tienda entera ocupa **dos**:

| Servicio | Qué es |
|---|---|
| `isu` | Las cuatro partes juntas: la tienda, la API, el worker y el backoffice (`infra/railway/todo.json`) |
| `Redis` | Las colas: pedidos a Stocker, mails, avisos. **Sin Redis un pedido pagado no llega a Stocker** |

La base es la misma Postgres de Stocker: no se crea otra.

Comparado con cuatro servicios separados, se pierde redundancia: hay una sola copia de cada parte y no se puede escalar cada una por separado. Para arrancar alcanza de sobra. Si más adelante hace falta, se pasa a `api.json`, `worker.json`, `web.json` y `admin.json` sin tocar el código.

## Cómo funciona

`scripts/todo-en-uno.mjs` arranca las cuatro partes en el mismo contenedor:

| Parte | Puerto | Para qué tiene dirección pública |
|---|---|---|
| tienda (web) | `PORT` (3000) | la tienda (`www.<dominio>`) |
| backoffice (admin) | 3001 | el backoffice (`admin.<dominio>`) |
| API | 4000 | el aviso de pagos de Mercado Pago (`api.<dominio>`) |
| worker | — | no tiene (sincroniza Stocker, manda mails y pedidos) |

Entre ellas se hablan dentro de la misma máquina, así que **`API_URL` y `WEB_INTERNAL_URL` no hacen falta**: si están cargadas, se ignoran.

Si una parte se cae, se levanta sola y las demás siguen andando. En el log de Railway cada línea dice de qué parte es: `[api]`, `[worker]`, `[web]`, `[admin]`.

## Paso a paso

### 1. Redis (el servicio libre)

En el proyecto: **+ New → Database → Add Redis**. Es un Redis **compartido** por todas las plataformas: cada una usa su propia base numerada y la tienda usa la **1**. Las reglas y la configuración de una sola vez (que no borre datos, que guarde en disco) están en [`redis-compartido.md`](redis-compartido.md).

### 2. Usuario de la base (una vez)

En el Postgres de Stocker (*Data → Query*), corré `infra/sql/rol-tienda.sql` cambiando la clave por una larga. La tienda entra con su propio usuario y sólo puede tocar sus tablas, nunca las de Stocker.

### 3. El servicio `isu`

- *Settings → Config-as-code → Railway config file*: `infra/railway/todo.json`
- *Settings → Root directory*: vacío (la raíz del repo).

### 4. Variables de `isu`

Todas en el mismo servicio. Las referencias `${{…}}` las completa Railway solo; usá el nombre exacto de tus servicios.

**Imprescindibles**

| Variable | Valor |
|---|---|
| `PORT` | `3000` |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `postgres://tienda_app:<la clave del paso 2>@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}` |
| `REDIS_URL` | `${{Redis.REDIS_URL}}/1` (con `/1` al final: la base 1 del Redis es la de la tienda; ver `redis-compartido.md`) |
| `NEXT_PUBLIC_SITE_URL` y `SITIO_URL` | la dirección de la tienda, p. ej. `https://isu-production.up.railway.app` (después, `https://www.isuwaya.com`) |
| `ADMIN_URL` | la dirección del backoffice (paso 5) |
| `API_PUBLICA_URL` | la dirección de la API (paso 5) |
| `ORIGENES_PERMITIDOS` | la de la tienda y la del backoffice, separadas por coma |
| `INTERNO_TOKEN`, `REVALIDAR_TOKEN`, `PAGOS_TOKEN` | cada uno `openssl rand -hex 32`, distintos |
| `ADMIN_CLAVE_CIFRADO` | `openssl rand -base64 32`, **y no la cambies nunca** |
| `STOCKER_API_URL` | `http://${{<backend de Stocker>.RAILWAY_PRIVATE_DOMAIN}}:<su puerto>` (sin `/api`) |
| `STOCKER_TOKEN` | la credencial de Stocker con origen «Tienda online minorista» |
| `PROXIES_DE_CONFIANZA` | `1` mientras se entra por la dirección de Railway; `2` cuando pongas Cloudflare adelante |

**Para que funcione todo**
- Fotos: `R2_*` y `NEXT_PUBLIC_CDN_IMAGENES`.
- Pagos: `MP_ACCESS_TOKEN` y `MP_WEBHOOK_SECRET`.
- Mails: `SMTP_URL`, `CORREO_DE`, `CORREO_RESPONDER`.
- Transportes: los `CORREO_AR_*`, `ANDREANI_*`, etc. que uses, una sola vez porque es un solo servicio.
- `MAYORISTA_URL`, `NEXT_PUBLIC_GA_ID`, `NEXT_PUBLIC_RAZON_SOCIAL`, `NEXT_PUBLIC_CUIT`.

El detalle de cada una está en `.env.example`.

Si antes cargaste `API_URL` apuntando a `tienda-api`, podés borrarla: en este modo no se usa.

### 5. Direcciones (Settings → Networking → Public Networking)

El servicio necesita tres direcciones, cada una a su puerto:

| Dirección | Puerto |
|---|---|
| la que ya tenés (`isu-production.up.railway.app`) | `3000` |
| una nueva para el backoffice (*Generate Domain* o *Custom Domain*, p. ej. `admin.isuwaya.com`) | `3001` |
| una nueva para la API (p. ej. `api.isuwaya.com`) | `4000` |

Railway pide el puerto al crear la dirección. Si ya estaba creada, cambialo con el lápiz que aparece al lado. Con esas direcciones, completá `ADMIN_URL`, `API_PUBLICA_URL` y `ORIGENES_PERMITIDOS` del paso 4.

### 6. Deploy

Hacé *Deploy*. El build compila las cuatro partes y tarda unos minutos. En el log tiene que aparecer:

```
[todo-en-uno] web :3000 · api :4000 · admin :3001
[api] … Server listening …
```

y después líneas `[worker]` de la sincronización con Stocker.

### 7. Una vez instalado (desde la consola del servicio)

En Railway → `isu` → el deploy activo → *Shell*:

```bash
node apps/api/dist/cli/crear-admin.js vos@mail.com "Tu Nombre"   # primer usuario del backoffice
node apps/worker/dist/mayorista/cli.js --aplicar                 # fotos y categorías del mayorista (~15 min)
```

### 8. Comprobar (desde tu compu)

```bash
pnpm diagnostico https://isu-production.up.railway.app https://<dirección del backoffice>
```

Tiene que terminar en **«Todo bien»**.

## Memoria

Las cuatro partes juntas usan unos 600–900 MB. Mirá *Metrics* en Railway la primera semana. Si el servicio se reinicia solo por memoria, subile el límite (*Settings → Resources*) o pasá a servicios separados.
