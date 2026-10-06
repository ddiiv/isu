# Transferencias que se confirman solas

Cuando un cliente paga por transferencia, el pedido pasa a **pagado** solo, sin esperar el comprobante y sin que nadie lo marque a mano. Stocker recibe el aviso y puede despachar.

Hay dos maneras. Se prenden en **Ajustes → Transferencias que se confirman solas**, y se pueden usar las dos juntas.

| | Talo: un CVU por pedido | Tu cuenta de Mercado Pago |
|---|---|---|
| Cómo reconoce el pago | Cada pedido tiene su propia cuenta (CVU y alias) por el monto exacto | El pedido pide un monto con **centavos únicos** ($ 45.000,37) |
| Qué tan rápido | Al instante (Talo avisa) | En minutos (la tienda mira lo que entró) |
| Costo | La comisión de Talo por transferencia (según Talo, cerca del 1%) | Ninguno: recibir transferencias en Mercado Pago no tiene costo |
| Si el cliente transfiere mal | Se ve en Transferencias como «monto distinto» | Si transfiere sin los centavos, queda «sin pedido» y se asigna a mano |
| Hace falta | Cuenta en Talo y sus credenciales en el servidor | Que los **Datos para transferir** de Ajustes sean los de tu cuenta de Mercado Pago |

Con las dos prendidas va Talo, y si Talo no responde en ese momento, el pedido usa la cuenta de Mercado Pago. Con ninguna, todo sigue como antes: el cliente sube el comprobante y se confirma a mano.

## Qué ve el cliente

- **En la página del pedido y en el mail:**
  - **Transferí $ 45.000,37**, con botón para copiar el monto, el CVU y el alias.
  - Con Talo: «Esta cuenta es sólo para tu pedido».
  - Con Mercado Pago: «Con los centavos, el monto exacto».
- **Cuando llega la plata**, la página pasa sola a **¡Pago confirmado!** y le llega el mail de pago confirmado.
- **El comprobante** queda guardado en «¿Pasaron más de 15 minutos y no se confirmó?», por si algo falla.

## Cómo se busca la plata

La tienda nunca cree un aviso. Siempre le pregunta a Talo o a Mercado Pago con su propia credencial. Lo hace por tres caminos, y da igual cuál llegue primero:

1. **El aviso de Talo o de Mercado Pago**, al instante.
2. **La página del pedido abierta:** como mucho cada 20 segundos.
3. **La vuelta del worker**, cada 2 minutos, por si se perdió un aviso. Además, antes de vencer un pedido sin pagar se mira una vez más.

Una misma transferencia nunca se cuenta dos veces.

## Talo: cómo se configura

1. Abrí la cuenta en [talo.com.ar](https://talo.com.ar) y completá la verificación que te pidan.
2. En el panel de Talo → **Usuario → Credenciales**, copiá el **ID de usuario**, el **client_id** y el **client_secret**.
3. En Railway, en el servicio de la tienda, agregá:
   ```
   TALO_USER_ID=…
   TALO_CLIENT_ID=…
   TALO_CLIENT_SECRET=…
   ```
   `TALO_API_URL` no hace falta: sin valor usa `https://api.talo.com.ar`. Para probar con el sandbox de Talo, poné `TALO_API_URL=https://sandbox-api.talo.com.ar`, con las credenciales del sandbox.
4. Hacé deploy. En backoffice → **Ajustes**, prendé **Un CVU por pedido (Talo)** y guardá.
5. **Probalo con una compra chica:**
   - Hacé un pedido por transferencia y transferí el monto exacto al CVU que te muestra.
   - En un par de minutos el pedido tiene que pasar a pagado solo.

Talo avisa a `https://<API_PUBLICA_URL>/v1/pagos/talo/aviso`. La tienda le pasa esa dirección en cada pedido, así que no hay que cargarla en el panel de Talo.

## Mercado Pago: cómo se configura

1. En **Ajustes → Datos para transferir** cargá los datos de **tu cuenta de Mercado Pago**:
   - **Titular** y **CUIT**;
   - **Banco:** «Mercado Pago»;
   - **CBU / CVU:** el CVU de la cuenta;
   - **Alias:** el de la cuenta.
2. Prendé **Mis datos para transferir son de mi cuenta de Mercado Pago** y guardá.
3. `MP_ACCESS_TOKEN` ya está, porque es el mismo del cobro con tarjeta. No hace falta nada más.
4. **Probalo con una compra chica:**
   - Hacé un pedido por transferencia y transferí **el monto exacto, con los centavos**, desde otro banco o billetera.
   - En unos minutos el pedido tiene que pasar a pagado.
   - Si no pasa, mirá backoffice → **Transferencias**:
     - **Si aparece ahí**, la tienda la vio pero no la pudo asignar: revisá que hayas transferido con los centavos.
     - **Si no aparece**, la cuenta de Mercado Pago no la está mostrando por su API. Avisame: lo resolvemos con los reportes de Mercado Pago.

### Por qué los centavos

Una transferencia a tu alias no dice de qué pedido es. Por eso cada pedido pide un monto que ningún otro pedido abierto tiene: el total más 1 a 99 centavos. Si dos clientes compran lo mismo, uno transfiere $ 45.000,12 y el otro $ 45.000,87.

El cliente paga como mucho 99 centavos de más.

## Backoffice → Transferencias

Lo que entró y no se pudo asignar solo:

- **Sin pedido.** Transfirieron sin los centavos, o es plata que no es de una compra.
  - **Asignar a un pedido:** escribís el número (ISU-1234) y el pedido queda pagado, con aviso a Stocker y mail al cliente.
  - **Descartar:** con una nota opcional (por ejemplo «no es de una compra»).
- **Monto distinto.** Con Talo, el cliente transfirió de menos.
  - El pedido sigue esperando y queda anotado cuánto falta.
  - Si completa la diferencia, se confirma solo.

No se puede asignar una transferencia a un pedido ya cobrado. Tampoco una que no alcanza para el total: ahí se avisa cuánto falta.

El panel muestra cuántas hay por resolver. Asignar y descartar piden rol operador y quedan en la auditoría.

## Precios: transferencia más barata, tarjeta al precio de lista

- La tienda muestra el **precio normal** y lo cobra así con tarjeta y Mercado Pago (ya incluye lo que cobra Mercado Pago).
- Con **transferencia** hace un **% OFF**: Ajustes → «% OFF con transferencia».
- **Recargo por pagar con tarjeta: no.** Lo prohíbe la [Ley 25.065, art. 37 inc. c)](https://servicios.infoleg.gob.ar/infolegInternet/anexos/55000-59999/55556/texact.htm): el comercio no puede hacer «diferencias de precio entre operaciones al contado y con tarjeta».
  - La [Res. 51-E/2017](https://www.argentina.gob.ar/normativa/nacional/resoluci%C3%B3n-51-2017-271185/texto) lo extiende a cualquier pago en una cuota con débito, crédito u otro medio electrónico.
  - Al pie de la letra, la misma regla alcanza al descuento por transferencia. Es muy común y casi no se controla, pero conviene confirmarlo con el contador.
- **Para que Mercado Pago cobre menos:** en tu cuenta de Mercado Pago elegí cobrar a 10, 18 o 35 días en vez de al instante. La comisión baja.

## Pruebas locales

- `pnpm demo:talo` levanta un Talo simulado en http://127.0.0.1:3930. Ahí se ven los cobros y hay botones para «transferir» el monto exacto o de menos.
- El Mercado Pago simulado acepta `POST /simular/transferencia { "monto": 45000.37 }`, que hace de una transferencia al alias.
- **Pruebas:**
  - `apps/api/test/transferencias.test.ts`: Talo, Mercado Pago, avisos, página abierta y vencimientos.
  - `admin.test.ts`: asignar y descartar.
  - `tests/e2e/transferencias.spec.ts`: de punta a punta en el navegador.
