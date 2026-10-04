# Redis compartido: reglas para todas las plataformas de ISUWAYA

> **Para el agente (o la persona) que trabaja en Stocker, la integración con Mercado Libre, la de Jumpseller, Pedidos Mayoristas o cualquier servicio nuevo del proyecto de Railway.**
>
> En el proyecto hay **un solo Redis** para todas las plataformas. Cada una tiene su propia cola de reintentos hacia Stocker (ventas, cancelaciones, cobros), que después entran a Stocker por HTTP según su contrato. Este documento dice para qué es, qué parte usa cada plataforma y cómo usarla sin romper a las demás. Seguilo tal cual. Si algo no encaja con tu plataforma, frená y avisale al dueño antes de improvisar.

## Para qué es (actualizado con el contrato de Stocker v1)

Stocker publicó el contrato de movimientos (`contrato-movimientos-stocker-v1.md`) y **descartó la cola común**. Los movimientos (ventas, cancelaciones, cobros) le llegan **por HTTP**, cada plataforma con **su credencial**. El negocio sale de la credencial: una cola compartida, con una sola contraseña para todos, no podría garantizar quién manda qué.

El Redis queda para lo que ya hacía:
- **la cola propia de cada plataforma**, en su base y con su prefijo, que es el **reintento**: el worker toma el trabajo y llama a Stocker hasta que contesta 2xx;
- caché, límites y avisos internos, con vencimiento.

**Lo que sigue valiendo de antes, y lo dice el contrato:**
- **Stocker es el único que mueve stock y registra dinero.** Ninguna plataforma lo calcula, lo guarda como dato propio ni lo corrige.
- **El id del movimiento es fijo** (`isu:ISU-1042`, `ml:2000123456`, `may:P-311`): un reintento nunca descuenta dos veces.
- **El movimiento vive en la base de la plataforma** hasta que Stocker contesta 2xx. Redis es el mensajero, no el registro.
- **Ante un `429` de Stocker, se espera cada vez más** (1 s, 2 s, 4 s… hasta 60 s), sin pasar de unos 10 por segundo.

**Cómo está la tienda minorista (`isu`).** Su cliente todavía no habla el contrato v1. La respuesta, con lo que la tienda cambia y lo que necesita de Stocker, está en `respuesta-contrato-stocker.md`.

## 1. Qué base usa cada plataforma

Redis tiene bases numeradas (0 a 15) dentro del mismo servidor. **Cada plataforma usa la suya, y sólo la suya.** Se elige con el número al final de la dirección.

| Base | Plataforma | `REDIS_URL` en Railway |
|---|---|---|
| 0 | Stocker (backend) | `${{Redis.REDIS_URL}}/0` |
| 1 | Tienda minorista (`isu`, este repo) | `${{Redis.REDIS_URL}}/1` |
| 2 | Pedidos Mayoristas | `${{Redis.REDIS_URL}}/2` |
| 3 | Integración Mercado Libre | `${{Redis.REDIS_URL}}/3` |
| 4 | Integración Jumpseller | `${{Redis.REDIS_URL}}/4` |
| 5 a 15 | Libres (anotalas acá antes de usarlas) | — |

- Si tu integración **corre dentro del backend de Stocker** (mismo servicio, mismo proceso), usa la base de Stocker (0). En ese caso, ponele a sus claves y colas un prefijo propio (`ml:`, `js:`).
- `Redis` es el nombre del servicio en Railway. Si se llama distinto, usá ese nombre en la referencia.
- **Nunca** la variable sin número, ni la dirección pública (`REDIS_PUBLIC_URL`). Se entra sólo por la red interna.

## 2. Reglas

1. **Prefijo propio en todo.**
   - Claves: `isu:…`, `stk:…`, `may:…`, `ml:…`, `js:…`.
   - Colas de BullMQ con la opción `prefix` (la tienda usa `prefix: "isu"`).
   - Aunque la base ya separa, el prefijo es la segunda llave: alguien puede equivocarse de número.
2. **Canales de Pub/Sub con prefijo, siempre.** Pub/Sub de Redis **no se separa por base**: un `PUBLISH` en la base 2 lo reciben los suscriptos de todas las bases. La tienda usa el canal `isu:invalidar`. No uses nombres genéricos como `invalidar`, `cache` o `eventos`.
3. **Prohibido:**
   - `FLUSHALL` (borra las bases de todos);
   - `FLUSHDB` en producción;
   - `CONFIG SET` / `CONFIG REWRITE`, que sólo los hace el dueño (§ 4);
   - `KEYS *` (frena el Redis de todos; usá `SCAN`);
   - `DEBUG`, `SHUTDOWN`, `SWAPDB`, `MOVE`, `SELECT` a otra base que no sea la tuya.
4. **Este Redis no borra datos solo** (`maxmemory-policy noeviction`): las colas no pueden perder trabajos. Por eso:
   - toda clave de caché, sesión o límite va con vencimiento (`SET … EX`, `EXPIRE`);
   - las colas limpian lo terminado (en BullMQ, `removeOnComplete` y `removeOnFail` con un tope, p. ej. `{ count: 1000 }` o `{ age: 7 * 24 * 3600 }`);
   - nada de guardar archivos, fotos o respuestas enormes: Redis es memoria, y si se llena, **fallan las escrituras de todas las plataformas**.
5. **Conexión por la red interna de Railway**, que puede resolver sólo por IPv6.
   - Con **ioredis**: `new Redis(process.env.REDIS_URL, { family: 0 })`. Para BullMQ, además `maxRetriesPerRequest: null`.
   - Con **node-redis**: `createClient({ url: process.env.REDIS_URL, socket: { family: 0 } })`.
   - En otro lenguaje, que el cliente acepte IPv6.
6. **Pocas conexiones.**
   - Una por proceso, más las que exija BullMQ (una por `Worker` o `QueueEvents`).
   - Nada de una conexión por pedido HTTP.
7. **Si Redis no está, la plataforma no se cae.**
   - Lo que es caché sigue sin caché.
   - Lo que es cola reintenta con espera.
   - Nunca se pierde un pedido: el pedido vive en la base Postgres, y la cola es sólo el aviso.

## 3. Checklist para aplicar en tu plataforma

1. Buscá dónde se conecta a Redis: `grep -rnE "ioredis|bullmq|redis\.createClient|createClient\(|REDIS_URL" --include=*.{js,ts,py} .` (sin `node_modules`).
   - **Si no usa Redis:** no hay nada que hacer. Anotalo en el informe (§ 5).
2. En Railway, en el servicio de tu plataforma, poné `REDIS_URL` con **tu** base (tabla § 1). Si tenía otro Redis propio, mirá § 6 antes de cambiar.
3. Revisá las reglas 1, 2, 4 y 5 en el código y corregí lo que falte:
   - prefijos;
   - canales de Pub/Sub;
   - vencimientos y limpieza de colas;
   - `family: 0`.
4. Desplegá y comprobá desde la consola del servicio (*Shell*):
   ```bash
   node -e 'const u=new URL(process.env.REDIS_URL);console.log(u.hostname, "base", u.pathname||"/0")'   # tiene que decir *.railway.internal y TU número
   ```
   y en los logs, que conecta sin `ECONNREFUSED` ni `ENOTFOUND`.
5. Informá (§ 5).

## 4. Configuración del Redis (una sola vez, la hace el dueño, **antes de conectar cualquier plataforma**)

Como este Redis tiene las colas de reintento de ventas y cobros, esto **no es opcional**: si borra datos al llenarse o no guarda en disco, se pierden reintentos. El movimiento sigue en la base de la plataforma, pero hay que reenviarlo a mano.

En Railway → servicio **Redis** → **Console**. Es una terminal del contenedor, no Redis: cada comando va con `redis-cli` y la contraseña que ya tiene el contenedor (si dice `NOAUTH`, `env | grep -i pass` muestra cómo se llama la variable):

```bash
redis-cli -a "${REDIS_PASSWORD:-$REDISPASSWORD}" --no-auth-warning CONFIG GET maxmemory-policy   # tiene que decir noeviction
redis-cli -a "${REDIS_PASSWORD:-$REDISPASSWORD}" --no-auth-warning CONFIG SET appendonly yes   # guarda cada cambio en disco (no se pierden trabajos al reiniciar)
redis-cli -a "${REDIS_PASSWORD:-$REDISPASSWORD}" --no-auth-warning CONFIG GET appendonly   # yes
redis-cli -a "${REDIS_PASSWORD:-$REDISPASSWORD}" --no-auth-warning INFO keyspace   # qué bases se están usando y cuántas claves tiene cada una
```

- **Que quede fijo aunque el Redis se reinicie:** en Redis → *Settings → Deploy → Custom Start Command* va **sólo** el arranque del Redis con las dos opciones al final (el comando exacto está en `subir-a-railway.md`, paso 2). **Los `redis-cli` de arriba van en la consola, nunca en el Start Command:** ahí reemplazarían al Redis y lo dejarían caído.
- **Aviso automático de la tienda.** Al arrancar, revisa estas dos opciones y avisa en su log (`[redis] …`) si alguna no está bien.
- **Mantenimiento:**
  - no le actives el *TCP Proxy* (acceso desde internet);
  - mirá *Metrics → Memory* las primeras semanas.

## 5. Informe que devuelve cada agente

Cuando termines, dejale al dueño estas líneas, completas:

```
Plataforma: …
¿Usa Redis?: sí / no
Base asignada: … (REDIS_URL=${{Redis.REDIS_URL}}/…)
Prefijo de claves y colas: …
Canales Pub/Sub: … (o ninguno)
¿Qué movimientos genera hacia Stocker? (ventas, cancelaciones, cobros) y por qué ruta los manda hoy: …
¿Se integra con Stocker según el contrato v1 (sobre, id fijo, manejo de 429)?: sí / no / qué falta
Cambios hechos en el código: …
Verificado en Railway: conecta a *.railway.internal, base …, sin errores en el log (sí/no)
Pendiente o dudas: …
```

## 6. Si tu plataforma ya tenía un Redis propio

No lo cambies hasta revisar:
- **Política de borrado.** Si ese Redis usaba algo distinto de `noeviction` (`allkeys-lru`, por ejemplo) y tu plataforma depende de que Redis borre solo lo viejo, primero agregá vencimientos a esas claves (regla 4).
- **Persistencia.** Si tiene trabajos pendientes en colas, pasalos o esperá a que la cola quede vacía antes del cambio. Si no, esos trabajos se pierden.
- **Al terminar,** avisale al dueño. El Redis viejo se puede borrar recién cuando ninguna plataforma lo use (`INFO clients` en el viejo: 0 conexiones), y así se libera un servicio.
