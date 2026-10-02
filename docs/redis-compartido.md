# Redis compartido: reglas para todas las plataformas de ISUWAYA

> **Para el agente (o la persona) que trabaja en Stocker, la integración con Mercado Libre, la de Jumpseller, Pedidos Mayoristas o cualquier servicio nuevo del proyecto de Railway.**
>
> En el proyecto hay **un solo Redis** para todas las plataformas. Su función principal es la cola de movimientos hacia Stocker: ventas, compras, devoluciones y cobros. Este documento dice para qué es, qué parte usa cada plataforma y cómo usarla sin romper a las demás. Seguilo tal cual. Si algo no encaja con tu plataforma, frená y avisale al dueño antes de improvisar.

## Para qué es: la cola de movimientos hacia Stocker

La función de este Redis es ser **la cola de movimientos hacia Stocker**. Cada venta, cancelación, devolución, compra o cobro que pase en cualquier plataforma entra a la cola como un mensaje, y Stocker los procesa para descontar o sumar stock y registrar el dinero recibido.

### Quién hace qué
- **Stocker es el único que mueve stock y registra cobros.** Las demás plataformas sólo publican movimientos en la cola; nunca tocan el stock directamente.
- **La cola común vive en la base 0 del Redis (la de Stocker).** Para publicar ahí, cada plataforma abre una conexión a `${{Redis.REDIS_URL}}/0` y sólo escribe en esa cola.
- **Lo interno de cada plataforma va en su propia base** (§ 1): caché, límites y colas propias.
- **Redis es el mensajero, no el registro.** La venta y el cobro quedan guardados en la base de datos de cada plataforma y en Stocker. Si un mensaje se pierde, se tiene que poder reenviar desde ahí.

### Reglas de cada movimiento
1. **Id único y fijo**, armado con la plataforma y su número de pedido (`ml:2000123456`, `isu:ISU-1042`, `may:P-311`).
   - Si llega dos veces, Stocker lo procesa una sola vez.
   - Los reintentos usan siempre el mismo id: **nunca se descuenta dos veces**.
2. **La plataforma manda cantidades; Stocker calcula el stock.** La plataforma no manda stock ya calculado.
3. **Una cancelación o devolución nombra el id de la venta original.** Stocker la aplica después de esa venta, aunque llegue antes.
4. **Los cobros van como movimiento propio**, con el id del pedido, el importe, el medio de pago y el número de operación.
5. **La cola no reemplaza la reserva al vender.** El canal que puede consultar o reservar stock en el momento de la venta, lo sigue haciendo. La cola registra lo que ya pasó. Así dos canales no venden la misma última prenda.

### Antes de programar: el contrato (lo define Stocker)
Stocker publica un documento con:
- el nombre exacto de la cola;
- el formato del mensaje (JSON con número de versión) y los tipos (venta, cancelación, devolución, compra, cobro);
- qué pasa si no hay stock o el SKU no existe;
- cómo se entera cada plataforma del resultado.

**Hasta que ese contrato esté publicado, ninguna plataforma cambia cómo se integra hoy con Stocker.** Por ahora cada agente aplica sólo lo de este documento: su base, sus prefijos y las reglas.

**Cómo está hoy la tienda minorista (`isu`).**
- Ya manda sus ventas a Stocker con una cola: la cola vive en su base 1, su worker la toma y la pasa a la API de Stocker.
- Al cobrar, reserva el stock en Stocker en el momento (regla 5).
- Cuando exista el contrato, la tienda se adapta para publicar en la cola común.

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
   - `DEBUG`, `SHUTDOWN`, `SWAPDB`, `MOVE`, `SELECT` a otra base que no sea la tuya. La única excepción es la conexión aparte que publica en la cola común de la base 0, y sólo para escribir en esa cola.
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

Como este Redis lleva movimientos de stock y de dinero, esto **no es opcional**: si borra datos al llenarse o no guarda en disco, se pueden perder ventas o cobros en camino a Stocker.

En Railway → servicio **Redis** → *Data* (o la consola con `redis-cli`):

```
CONFIG GET maxmemory-policy        → tiene que decir noeviction
CONFIG SET appendonly yes          → guarda cada cambio en disco (no se pierden trabajos al reiniciar)
CONFIG GET appendonly              → yes
INFO keyspace                      → qué bases se están usando y cuántas claves tiene cada una
```

- **Que no se pierda al reiniciar.** `CONFIG SET` dura hasta que el Redis se reinicia. Para que quede fijo: Redis → *Settings → Deploy → Custom Start Command*. Si ahí hay un comando que empieza con `redis-server`, **agregale al final** `--appendonly yes --maxmemory-policy noeviction` (no borres nada de lo que ya tiene, como la contraseña o la carpeta de datos). Si no hay comando, dejalo como está y repetí el `CONFIG SET` después de cada reinicio del Redis.
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
¿Qué movimientos genera hacia Stocker? (ventas, cancelaciones, devoluciones, compras, cobros) y cómo los manda hoy: …
¿Ya publica en la cola común?: no (hasta que Stocker publique el contrato)
Cambios hechos en el código: …
Verificado en Railway: conecta a *.railway.internal, base …, sin errores en el log (sí/no)
Pendiente o dudas: …
```

## 6. Si tu plataforma ya tenía un Redis propio

No lo cambies hasta revisar:
- **Política de borrado.** Si ese Redis usaba algo distinto de `noeviction` (`allkeys-lru`, por ejemplo) y tu plataforma depende de que Redis borre solo lo viejo, primero agregá vencimientos a esas claves (regla 4).
- **Persistencia.** Si tiene trabajos pendientes en colas, pasalos o esperá a que la cola quede vacía antes del cambio. Si no, esos trabajos se pierden.
- **Al terminar,** avisale al dueño. El Redis viejo se puede borrar recién cuando ninguna plataforma lo use (`INFO clients` en el viejo: 0 conexiones), y así se libera un servicio.
