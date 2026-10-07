# Subir la tienda a Railway, de cero

Guía completa, en orden: el código, el Redis, la base, las direcciones, **cada variable y de dónde sale**, el deploy y cómo comprobar que anda. La tienda va en **un solo servicio** (`isu`) más el **Redis** compartido.

> ### ⚠️ Antes de empezar: la tienda todavía no puede vender
> El contrato de movimientos que publicó Stocker (`docs/contrato-movimientos-stocker-v1.md`) describe un Stocker que **no tiene** lo que la tienda necesita.
> - El catálogo no trae el número de cada variante, así que la tienda **arranca sin productos**.
> - No hay forma de marcar un pedido como pagado ni de cargarle el envío.
>
> Lo que falta está en `docs/respuesta-contrato-stocker.md`. Igual podés hacer **toda esta guía ahora**: queda instalada, con el backoffice andando y lista para cuando Stocker esté. **No la anuncies ni cambies el dominio** hasta que `pnpm diagnostico` diga que hay productos y una compra de prueba llegue a Stocker.

---

## Lo que vas a tener al final

| Servicio de Railway | Qué es |
|---|---|
| `isu` | La tienda, la API, el worker y el backoffice, juntos |
| `Redis` | Las colas de la tienda (base 1) y de las demás plataformas |
| `Postgres` (ya existe) | La base de Stocker. La tienda usa su propio esquema (`tienda`) con su propio usuario |
| `stocker-backend` (ya existe) | Stocker. La tienda le habla por la red interna |

Tres direcciones públicas, todas del servicio `isu`:

| Para qué | Puerto | Ejemplo |
|---|---|---|
| La tienda | 3000 | `https://isu-production.up.railway.app` (después, `https://www.isuwaya.com`) |
| El backoffice | 3001 | `https://isu-admin-production.up.railway.app` |
| La API (Mercado Pago avisa los pagos acá) | 4000 | `https://isu-api-production.up.railway.app` |

## Herramientas

- Acceso al proyecto de Railway y al repo de GitHub conectado al servicio `isu`.
- Una terminal para generar claves. Cualquiera de estas dos sirve:
  - `openssl rand -hex 32` (Mac o Linux; en Windows, Git Bash);
  - `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

  En esta guía, **«una clave hex»** es el resultado de alguno de esos comandos.
- **Nunca pegues las claves en un chat, un mail o un documento.** Van sólo en Railway. Si alguna quedó escrita en otro lado, generá otra.

---

## Paso 1. Subir el código

1. Descomprimí `isu.zip` y reemplazá con eso la carpeta de la tienda en tu repo.
2. **No copies ningún `.env`:** en Railway las variables se cargan aparte (paso 5).
3. Subilo a GitHub vos (commit y push a la rama que usa el servicio `isu`).
4. En Railway → `isu` → *Settings* revisá que no haya nada que pise la configuración del repo:
   - *Source*: el repo y la rama correctos.
   - *Root directory*: **vacío**.
   - *Config-as-code → Railway config file*: **vacío**. El repo trae `railway.json` en la raíz y Railway lo usa solo.
   - *Build → Custom Build Command* y *Deploy → Custom Start Command*: **vacíos**.

## Paso 2. Redis

1. En el proyecto: **+ New → Database → Add Redis**. Dejale el nombre `Redis`.
2. Configuración de una sola vez, **antes de conectar cualquier plataforma**: que no borre datos al llenarse y que guarde cada cambio en disco.

   **a) En el arranque.** Redis → *Settings → Deploy → **Custom Start Command***. Ahí va **sólo** este comando, en una línea, y nada más:
   ```
   /bin/sh -c "rm -rf $RAILWAY_VOLUME_MOUNT_PATH/lost+found/ && exec docker-entrypoint.sh redis-server --requirepass $REDIS_PASSWORD --save 60 1 --dir $RAILWAY_VOLUME_MOUNT_PATH --appendonly yes --maxmemory-policy noeviction"
   ```
   - Es el arranque de la plantilla de Redis de Railway, con `--appendonly yes --maxmemory-policy noeviction` al final.
   - Antes de guardarlo, revisá en Redis → *Variables* que la contraseña se llame `REDIS_PASSWORD`. Si se llama distinto, cambiá ese nombre en el comando.
   - ⚠️ **Los comandos `redis-cli` NO van acá.** Si se ponen en el Start Command, el contenedor corre eso en vez del Redis y queda caído (`Could not connect to Redis … Connection refused`).

   **b) Comprobar, en la consola.** Cuando el deploy del Redis quede en verde: Redis → **Console**. Es una terminal del contenedor, no Redis: cada comando va con `redis-cli` y la contraseña que ya tiene el contenedor.
   ```bash
   redis-cli -a "${REDIS_PASSWORD:-$REDISPASSWORD}" --no-auth-warning CONFIG GET maxmemory-policy   # noeviction
   redis-cli -a "${REDIS_PASSWORD:-$REDISPASSWORD}" --no-auth-warning CONFIG GET appendonly         # yes
   ```
   La tienda también lo revisa al arrancar y avisa en su log (`[redis] …`) si alguna de las dos está mal.
3. No le actives el *TCP Proxy* (acceso desde internet).

Detalle y reglas para las demás plataformas: `docs/redis-compartido.md`.

## Paso 3. El usuario de la tienda en la base

La tienda no usa el usuario administrador de Postgres. Tiene uno propio, que sólo puede tocar su esquema y **nunca** las tablas de Stocker.

1. Generá la clave: `openssl rand -hex 24`. Que sea hex, sin símbolos, para que no rompa la dirección. Guardala: va en `DATABASE_URL`.
2. En Railway → **Postgres** → *Data → Query*, corré una sola vez, con esa clave:
   ```sql
   CREATE ROLE tienda_app LOGIN PASSWORD 'LA_CLAVE_DEL_PUNTO_1' CONNECTION LIMIT 30;
   CREATE SCHEMA IF NOT EXISTS tienda AUTHORIZATION tienda_app;
   REVOKE ALL ON SCHEMA public FROM tienda_app;
   REVOKE ALL ON ALL TABLES IN SCHEMA public FROM tienda_app;
   ALTER ROLE tienda_app SET statement_timeout = '10s';
   ALTER ROLE tienda_app SET idle_in_transaction_session_timeout = '15s';
   ```
   (Es `infra/sql/rol-tienda.sql`.)
3. Si alguna vez hay que cambiar la clave: `ALTER ROLE tienda_app PASSWORD 'NUEVA';` y actualizá `DATABASE_URL`.

Las tablas las crea la tienda sola al arrancar.

## Paso 4. Las tres direcciones

En `isu` → *Settings → Networking → Public Networking*:

1. La que ya tenés (`isu-production.up.railway.app`) tiene que ir al puerto **3000**. Si dice otro, cambialo con el lápiz.
2. **Generate Domain** → puerto **3001**: el backoffice.
3. **Generate Domain** → puerto **4000**: la API.

Anotá las dos nuevas: van en las variables.

## Paso 5. Variables

En `isu` → *Variables* → **Raw Editor**, reemplazá todo por lo de abajo y completá lo que está entre `< >`. Si algo queda entre `< >`, la tienda no arranca y el log dice qué variable es. Así nada se escapa por error.

```
NODE_ENV=production
PORT=3000
PROXIES_DE_CONFIANZA=1
DB_SSL=false
DB_POOL_MAX=10
CACHE_SEGUNDOS=30
CONCURRENCIA=5
LIMITE_PEDIDOS_POR_MINUTO=300

DATABASE_URL=postgres://tienda_app:<CLAVE_DEL_PASO_3>@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}
REDIS_URL=${{Redis.REDIS_URL}}/1

NEXT_PUBLIC_SITE_URL=https://isu-production.up.railway.app
SITIO_URL=https://isu-production.up.railway.app
ADMIN_URL=https://<DIRECCION_PUERTO_3001>
API_PUBLICA_URL=https://<DIRECCION_PUERTO_4000>
ORIGENES_PERMITIDOS=https://isu-production.up.railway.app,https://<DIRECCION_PUERTO_3001>

STOCKER_API_URL=http://${{stocker-backend.RAILWAY_PRIVATE_DOMAIN}}:${{shared.BACKEND_PORT}}
STOCKER_TOKEN=<CREDENCIAL_DE_STOCKER>

INTERNO_TOKEN=<CLAVE_HEX_1>
REVALIDAR_TOKEN=<CLAVE_HEX_2>
PAGOS_TOKEN=<CLAVE_HEX_3>
ADMIN_CLAVE_CIFRADO=<CLAVE_BASE64>

MAYORISTA_URL=https://isumayoristapedidos-production.up.railway.app
```

> **Los nombres de servicio dentro de `${{…}}` tienen que ser exactamente los de tu proyecto.** Acá dice `Postgres`, `Redis` y `stocker-backend`, pero Railway a veces les agrega un sufijo (por ejemplo `Redis-BU1C`) o se llaman distinto (`stockerback`). Si el nombre no existe, Railway deja la referencia **vacía** y la tienda no arranca («le falta el servidor»). Lo seguro es escribir `${{` en el valor y **elegir el servicio de la lista**.

### De dónde sale cada una

**La base y el Redis**

| Variable | Qué es | De dónde sale |
|---|---|---|
| `DATABASE_URL` | La base, con el usuario de la tienda | La clave del paso 3. El resto lo completa Railway. Si la referencia queda en rojo, el servicio no se llama `Postgres`: escribí `${{` y elegilo de la lista |
| `REDIS_URL` | Las colas, en la base 1 del Redis | Tal cual. El `/1` al final es la parte de la tienda |

**Direcciones**

| Variable | Qué es | De dónde sale |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | La dirección de la tienda | La del puerto 3000. Se graba al compilar: si la cambiás, hacé *Redeploy* |
| `SITIO_URL` | La que va en los mails, la vuelta de Mercado Pago y el seguimiento | **La misma que la anterior.** El día del cambio de dominio se cambian las dos juntas |
| `ADMIN_URL` | La del backoffice | Paso 4, puerto 3001 (con `https://`, sin barra al final) |
| `API_PUBLICA_URL` | La de la API | Paso 4, puerto 4000 |
| `ORIGENES_PERMITIDOS` | Desde dónde se aceptan pedidos del navegador | La de la tienda y la del backoffice, separadas por coma, sin espacios ni barra final |

**Stocker**

| Variable | Qué es | De dónde sale |
|---|---|---|
| `STOCKER_API_URL` | Stocker por la red interna | Tal cual. Si `${{shared.BACKEND_PORT}}` queda en rojo, cambialo por `${{stocker-backend.PORT}}` |
| `STOCKER_TOKEN` | La credencial de la tienda en Stocker | Stocker → **Integraciones** → nueva credencial con origen **«Tienda online minorista»** (`tienda`). Se muestra **una sola vez**: copiala directo a Railway. Si se pierde, se emite otra |

**Claves internas**

| Variable | Qué es | De dónde sale |
|---|---|---|
| `INTERNO_TOKEN` | Las partes de la tienda se reconocen entre sí | Una clave hex |
| `REVALIDAR_TOKEN` | El worker le avisa a la tienda que regenere páginas | Otra clave hex |
| `PAGOS_TOKEN` | Para registrar pagos desde afuera (`POST /v1/pagos/registrar`) | Otra clave hex |
| `ADMIN_CLAVE_CIFRADO` | Cifra el doble factor del backoffice | `openssl rand -base64 32`. **No la cambies después** de que alguien configure el doble factor: todos tendrían que volver a configurarlo |

**Botón Mayorista**

| Variable | Qué es | De dónde sale |
|---|---|---|
| `MAYORISTA_URL` | A dónde lleva el botón «Mayorista» | El sitio de pedidos mayoristas. Se cambia en cualquier momento, sin redeploy |

### Las que podés sumar después (la tienda arranca sin ellas)

El log avisa cuáles faltan, pero no frena.

**Fotos (Cloudflare R2).** Sin esto no hay dónde guardar fotos.
1. Cloudflare → **R2** → *Create bucket*: `isuwaya-fotos`.
2. Ese bucket → *Settings → Public access → Custom domain*: `fotos.isuwaya.com`. Hasta tener el dominio, sirve la dirección `r2.dev` que ofrece ahí.
3. Otro bucket, **sin** acceso público: `isuwaya-privado`, para los comprobantes de transferencia y las etiquetas.
4. *R2 → Manage API tokens → Create token* con permiso **Object Read & Write**, limitado a esos dos buckets.

| Variable | Valor |
|---|---|
| `R2_CUENTA` | El *Account ID* (columna derecha de R2) |
| `R2_BUCKET` | `isuwaya-fotos` |
| `R2_BUCKET_PRIVADO` | `isuwaya-privado` |
| `R2_ACCESS_KEY_ID` | Del token del punto 4 |
| `R2_SECRET_ACCESS_KEY` | Del token del punto 4 (se muestra una sola vez) |
| `NEXT_PUBLIC_CDN_IMAGENES` | La dirección pública del punto 2. Necesita *Redeploy* |

**Mercado Pago**

| Variable | Valor |
|---|---|
| `MP_ACCESS_TOKEN` | mercadopago.com.ar/developers → *Tus integraciones* → tu aplicación → *Credenciales de producción* → **Access token** |
| `MP_WEBHOOK_SECRET` | En la misma aplicación → *Webhooks* → URL `https://<DIRECCION_PUERTO_4000>/v1/pagos/mercadopago/aviso`, evento **Pagos** → la **clave secreta** que muestra |

Las cuotas sin interés se configuran en la cuenta de Mercado Pago; la tienda sólo las anuncia.

**Transferencias que se confirman solas** (opcional, guía en [`transferencias.md`](transferencias.md))

| Variable | Valor |
|---|---|
| `TALO_USER_ID`, `TALO_CLIENT_ID`, `TALO_CLIENT_SECRET` | Sólo para el CVU por pedido con Talo: panel de Talo → *Usuario* → *Credenciales*. Las tres juntas. Después se prende en Ajustes |

Con la cuenta de Mercado Pago no hace falta ninguna variable más: usa `MP_ACCESS_TOKEN`.

**Mails**

| Variable | Valor |
|---|---|
| `SMTP_URL` | `smtp://usuario:clave@servidor:587`. Con Gmail o Workspace: la clave es una **contraseña de aplicación** (cuenta de Google → Seguridad → Contraseñas de aplicaciones), con `smtp.gmail.com`. También sirven Brevo o Amazon SES |
| `CORREO_DE` | El remitente, p. ej. `Isuwaya <hola@isuwaya.com>` |

Para que los mails no caigan en spam, el dominio necesita SPF y DKIM (te los da el proveedor de correo; van en el DNS).

**Datos legales y analítica**

| Variable | Valor |
|---|---|
| `NEXT_PUBLIC_RAZON_SOCIAL` y `NEXT_PUBLIC_CUIT` | Los del negocio. Salen en términos, privacidad y pie de página. Necesitan *Redeploy* |
| `NEXT_PUBLIC_GA_ID` | Google Analytics 4 → Administrar → Flujos de datos → **ID de medición** (`G-…`). Necesita *Redeploy* |
| `GOOGLE_SITE_VERIFICATION` y `BING_SITE_VERIFICATION` | Sólo si no verificás Search Console por DNS (`docs/seo.md`) |

**Transportes, WhatsApp y asistente con IA**
- Transportes: las credenciales de cada uno (`CORREO_AR_*`, `ANDREANI_*`, `OCA_*`, `CABIFY_*`, `MERCADO_ENVIOS_ACTIVO`). Detalle en `.env.example`. **Nunca** `TRANSPORTES_SIMULADOR`.
- WhatsApp: `WHATSAPP_META_TOKEN` y `WHATSAPP_META_PHONE_NUMBER_ID`.
- Asistente con IA (opcional): `ANTHROPIC_API_KEY`, y prenderlo en Ajustes.
- Sugerencias de calle en el checkout (opcional): `GOOGLE_MAPS_API_KEY`, una clave de Google Cloud con «Places API (New)». Cómo sacarla y cuánto cuesta (con los topes de fábrica, nada) en [`direcciones-checkout.md`](direcciones-checkout.md). La revisión de calle y altura con Georef no necesita nada.

### Las que NO van

| Variable | Por qué no |
|---|---|
| `API_URL`, `WEB_INTERNAL_URL` | Las partes se hablan dentro del mismo servicio. Si están, se ignoran |
| `HOST`, `FOTOS_DIR`, `COMPROBANTES_DIR`, `TRANSPORTES_SIMULADOR` | Son sólo para desarrollo |
| Cualquier valor con `localhost` o `127.0.0.1` | Es la propia compu: en Railway no existe |

## Paso 6. Deploy

*Deploy* (o el push del paso 1). El build tarda unos minutos.

**En el log, si todo está bien:**

```
[todo-en-uno] web :3000 · api :4000 · admin :3001 (escuchando en ::)
[api] … Server listening …
[web] [arranque] la API contesta: páginas del catálogo regeneradas
[worker] worker escuchando: stocker, notificaciones, envios, pagos
```

**Si hay una variable mal**, arranca con:

```
✗ Variables del servicio con problemas (la tienda no arranca hasta corregirlas):
   · DATABASE_URL: tiene texto de ejemplo de la guía (<…>, …). Poné el valor real.
```

Corregila en *Variables* y Railway vuelve a desplegar solo.

## Paso 7. Una vez instalada

En Railway → `isu` → el deploy activo → *Shell*:

```bash
node apps/api/dist/cli/crear-admin.js vos@mail.com "Tu Nombre"
```

Ese comando crea el primer usuario del backoffice e imprime una contraseña provisoria. Al entrar en la dirección del puerto 3001, pide configurar el doble factor (Google Authenticator o similar) y cambiar la clave.

**Cuando Stocker ya mande el catálogo**, también desde la *Shell*:

```bash
node apps/worker/dist/mayorista/cli.js             # muestra qué haría
node apps/worker/dist/mayorista/cli.js --aplicar   # trae fotos y categorías (~15 min)
```

## Paso 8. Comprobar (desde tu compu)

```bash
pnpm diagnostico https://isu-production.up.railway.app https://<DIRECCION_PUERTO_3001>
```

Tiene que terminar en **«Todo bien»**. Hasta que Stocker mande el catálogo, va a decir **«no hay productos publicados todavía»**: es esperable.

## Problemas frecuentes

| En el log | Qué es | Qué hacer |
|---|---|---|
| `La raíz del repo no se arranca como un servicio` | Es una versión vieja del código | Subí la versión nueva (paso 1) |
| `Falta compilar: …` | Hay un comando de build propio que pisa el del repo | Vaciá *Custom Build Command* (paso 1) |
| `tiene texto de ejemplo` / `referencia de Railway que no se resolvió` | Variable mal copiada, o nombre de servicio distinto | Corregila (paso 5). Las referencias, mejor con el autocompletado de `${{` |
| `[api] [redis] connect ECONNREFUSED` | `REDIS_URL` mal | Paso 5 |
| `password authentication failed for user "tienda_app"` | La clave de `DATABASE_URL` no es la del paso 3 | Corregila, o cambiala con `ALTER ROLE` |
| `permission denied for schema tienda` | El paso 3 no se corrió completo | Correlo de nuevo (es seguro repetirlo) |
| `[worker] … 401` con Stocker | `STOCKER_TOKEN` mal o revocado | Emití otra credencial (paso 5) |
| `[worker] Catálogo de Stocker con formato inesperado: …` | Stocker cambió la forma del catálogo | Después de los `:` dice qué campo. Pasáselo al agente de Stocker o de la tienda. No es de configuración |
| `Stocker no responde en … (ENOTFOUND …)` | El nombre del servidor de `STOCKER_API_URL` no existe | Rehacé la referencia con el autocompletado: `${{` → el servicio del backend de Stocker → `RAILWAY_PRIVATE_DOMAIN` |
| `Stocker no responde en … (ECONNREFUSED …)` | El servidor existe, pero no escucha en ese puerto | En el servicio de Stocker, mirá en qué puerto arranca (su log o su variable `PORT`) y poné ese número después de los `:` |
| `Stocker no responde en … (no contestó …)` o `UND_ERR_CONNECT_TIMEOUT` | Stocker no escucha por la red interna (IPv6) | Stocker tiene que escuchar en `::`, no en `0.0.0.0`. Es un cambio en Stocker |
| `Stocker no responde en … (ECONNRESET …)` | `STOCKER_API_URL` empieza con `https://` | Por la red interna va `http://` |
| `[redis] appendonly=no` o `maxmemory-policy=…` | El Redis no está configurado | Paso 2 |
| El servicio se reinicia solo | Probablemente memoria (las cuatro partes usan 600–900 MB) | *Metrics*. Subí el límite en *Settings → Resources* |

## Después

- **Dominio propio, Cloudflare y día del cambio desde Jumpseller:** `docs/seo.md` § «El día del cambio de dominio» y `docs/despliegue.md` § Cloudflare. Ese día cambian `NEXT_PUBLIC_SITE_URL`, `SITIO_URL`, `ADMIN_URL`, `API_PUBLICA_URL` y `ORIGENES_PERMITIDOS` (y se hace *Redeploy*), y `PROXIES_DE_CONFIANZA` pasa a `2`.
- **Lista de lo que falta para abrir al público:** `docs/pendientes-produccion.md` y `docs/salida-produccion.md`.
