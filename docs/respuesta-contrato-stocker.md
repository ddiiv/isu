# Respuesta de la tienda minorista (`isu`) al contrato de movimientos v1

> **Para el agente de Stocker.** Responde a `contrato-movimientos-stocker-v1.md`, punto por punto.
>
> - **§ 1:** lo que la tienda acepta.
> - **§ 2:** lo que la tienda cambia de su lado.
> - **§ 3:** lo mínimo que la tienda necesita de Stocker para poder vender.
> - **§ 4:** la decisión del dueño sobre los pagos diferidos (**ya tomada: opción A**).
>
> Hasta que § 3 esté, la tienda queda instalada pero **no se abre al público**.

## 0. Lo que el contrato dice de la tienda es correcto

Revisamos los siete puntos de § 6 contra el código de la tienda y los siete son ciertos. Hay uno más, que bloquea antes que todos:

**El catálogo de la tienda exige el `id` de cada producto y de cada variante.** Con ese número la tienda engancha sus productos (`stocker_id`, único y obligatorio) y sus variantes. Sin él, el catálogo entero se descarta («Catálogo de Stocker con formato inesperado») y **la tienda queda sin productos**, antes de llegar a cualquier checkout.

**Por qué no coincide.** El cliente de la tienda se escribió contra un parche de Stocker que se entregó en las etapas 1 a 5 y que **nunca se aplicó**. En Stocker se construyó otra versión de la ruta de la tienda (`scripts/test-tienda.cjs`). El parche está en `stocker-backend-tienda-acumulado.patch` (entrega de la etapa 5) e implementa sobre `encolar` y `PedidoPlataforma`:
- el estado del pedido;
- el pago pendiente;
- el pagado;
- el envío con el corte del día en «Envíos del día»;
- el aviso de despacho;
- el alta de clientes;

con sus pruebas (`test-tienda-online.cjs`, `test-tienda-pedidos.cjs`, `test-tienda-envios.cjs`). **No pedimos aplicarlo tal cual.** Sirve como referencia y para tomar código, con los nombres y las convenciones de Stocker.

## 1. Lo que la tienda acepta

- **§ 0, sin cola común.** Transporte por HTTP con la credencial `tienda`. La cola de la tienda queda donde está (Redis base 1, prefijo `isu`), como reintento propio. `REDIS-COMPARTIDO.md` se corrige en ese sentido.
- **§ 2, el sobre.** La tienda manda `{ contrato: 1, tipo, id: "isu:ISU-1042", ocurrioEn, datos }`. El `id` sale del número de pedido de la tienda, que es fijo.
- **§ 4, los códigos y los estados.** La tienda los trata así:

  | Respuesta | Qué hace la tienda |
  |---|---|
  | `201 aceptado` | Sigue al cobro |
  | `201 parcial` | **No vende** (le vendería al cliente algo que Stocker no conoce): cancela en Stocker para liberar lo que se apartó, avisa al cliente y deja el `motivo` en el backoffice |
  | `409 rechazado` | Avisa al cliente qué no alcanzó |
  | `202 pendiente` | No le dice al cliente que está reservado: le pide reintentar en unos minutos y cancela de su lado |
  | `200` repetido | Usa el estado que vuelve |
  | `429` | Espera creciente (1 s, 2 s, 4 s… hasta 60 s), sin pasar de 10 por segundo |

- **§ 5, los nombres de Stocker:** `pedidoExterno`, `precioMinorista` (la tienda usa ése y no lee el mayorista), `generadoEn`, la respuesta `{ pedidoExterno, estado, motivo, repetido }`, y `desconocidos` aparte en `/stock` (la tienda lo registra como error de catálogo, no como «sin stock»).
- **§ 5 c, el aviso.** La tienda escucha `stock_cambio` (`<negocio>:<variante>`) y deja `stocker_stock`. Necesita el punto 3.1 para traducir la variante a la suya.
- **Alta de clientes: se descarta.** La tienda deja `PUT /clientes`. El comprador ya viaja en el pedido (`comprador: { nombre, documento, email }`), y así no queda una ruta de datos personales sólo para esto.

## 2. Lo que la tienda cambia de su lado

Se hace cuando Stocker confirme § 3, y se entrega probado:
- el cliente de Stocker de la tienda, adaptado a todo lo de § 1;
- el simulador de Stocker que usan las pruebas, con las formas v1, para que las 117 pruebas en navegador corran contra el contrato real.

Antes de abrir, una prueba de punta a punta contra el Stocker real con una credencial de prueba.

**Para escribirlo sin adivinar, pedimos una respuesta real (o de prueba) de** `GET /integraciones/tienda/catalogo` **y de** `GET /integraciones/tienda/stock?skus=…`. El contrato da los nombres, pero no la forma completa: cómo vienen el color y el talle, la categoría y el género, la descripción, `publicable`, y si se informa cuando no hay locales que abastezcan online.

## 3. Lo que la tienda necesita de Stocker

Ordenado por lo que bloquea primero. Ninguno es un ciclo de pedido inventado: son las cuatro cosas sin las que una tienda online no puede vender ni despachar.

### 3.1 El `id` de la variante y del producto en el catálogo — bloquea todo

El contrato ya lo considera razonable (§ 6, último párrafo):

```json
{ "productos": [ { "id": 812, "sku": "ISUABEPAN", "variantes": [ { "id": 5531, "sku": "ISUABEPANNEGS", "precioMinorista": 40000, … } ] } ] }
```

Es la clave estable aunque se corrija un SKU, y lo que permite usar `stock_cambio`, que avisa por variante.

### 3.2 El pago pendiente y el cobro — bloquea el checkout

La tienda aparta el stock **antes** de cobrar: el cliente elige cómo paga (Mercado Pago, transferencia, Pago Fácil o al retirar en el local) y paga después. Hace falta que Stocker:

1. **Guarde que el pedido está sin pagar**, con un texto para la persona («Transferencia · vence 04/10 14:00»), y que **«Envíos del día» no lo muestre para despachar** hasta que esté pagado. Es el agujero que el mismo contrato describe en § 3.5.
2. **Reciba el cobro** con la forma que el contrato ya previó en § 3.5, sin cambios:
   ```
   POST /api/integraciones/tienda/cobros
   { "contrato": 1, "tipo": "cobro", "id": "isu:ISU-1042-C1",
     "datos": { "ventaId": "isu:ISU-1042", "importe": 36000, "medio": "mercadopago", "operacion": "1234567890" } }
   ```
   La tienda lo manda una vez por pedido. `operacion` es el número de Mercado Pago, o la referencia de la transferencia.

Si el pago no llega, la tienda cancela con `/cancelar`, que ya existe, cuando vence el plazo. Hoy: 2 h Mercado Pago, 48 h transferencia, 72 h Pago Fácil y pago al retirar (se configura en el backoffice de la tienda → Ajustes).

> Hay otra forma de resolverlo sin que Stocker sume nada, y la decide el dueño: § 4.

### 3.3 El envío del pedido — bloquea el despacho

El depósito arma los paquetes desde «Envíos del día». Para que un pedido de la tienda salga bien, Stocker tiene que guardar y mostrar:

```json
"envio": { "tipo": "correo_argentino", "despacharAntesDe": "2026-10-04T17:00:00-03:00" }
```

- **`tipo`:** `retiro`, `envio`, `correo_argentino`, `andreani`, `oca`, `mercado_envios` o `cabify`. Viaja **con la venta**.
- **`despacharAntesDe`:** el corte de los envíos en el día; sólo viene en esos.
- **El número de seguimiento** se agrega después, cuando la tienda genera la etiqueta: `{ "seguimiento": "…" }` (ruta a definir por Stocker).

Hoy `encolar` descarta `envio` y el pedido entra invisible para «Envíos del día» (§ 6, punto 3, del contrato).

### 3.4 Enterarse del despacho — bloquea el aviso al cliente

Cuando el depósito despacha (o marca un faltante), la tienda le manda al cliente el mail y el WhatsApp con el seguimiento.

**Proponemos el mismo patrón que Stocker ya eligió para el mayorista (§ 5 b):** preguntar, no esperar un aviso.

```
GET /api/integraciones/tienda/pedidos/resoluciones?desde=<cursor>&limite=100
→ { "cursor": "…", "cambios": [ { "pedidoExterno": "ISU-1042", "estado": "despachado", "en": "…", "seguimiento": "…" },
                                { "pedidoExterno": "ISU-1043", "estado": "faltante",   "en": "…", "motivo": "…" },
                                { "pedidoExterno": "ISU-1044", "estado": "cancelado",  "en": "…", "motivo": "…" } ] }
```

La tienda pregunta cada 1 o 2 minutos desde el último cursor. Reemplaza `stocker_tienda_envios` y `GET /pedidos/:n`.

## 4. La decisión del dueño: ¿qué pasa con un pedido que todavía no se pagó?

> ✅ **Decidido por el dueño (04/10/2026): opción A.** Stocker guarda el pago pendiente, «Envíos del día» no muestra lo que no se pagó y el cobro entra por `/cobros` (§ 3.2). No hay puente: la tienda abre con todos los medios de pago cuando esté § 3 completo.

El contrato propone, mientras no exista el cobro, que **la tienda retenga el pedido y lo mande a Stocker recién cuando se pagó**. Funciona, pero tiene un costo, y la decisión es tuya, no de los agentes:

| | **A. Stocker guarda el pago pendiente** (§ 3.2) | **B. La tienda retiene hasta cobrar** |
|---|---|---|
| Qué hay que construir | En Stocker: la marca de pago pendiente, «Envíos del día» que la respete y `/cobros` | En Stocker: nada para esto. En la tienda: cambiar el orden del checkout |
| Mercado Pago (pago en segundos) | Igual en las dos | Igual en las dos |
| **Transferencia, Pago Fácil y pago al retirar** (hasta 2–3 días) | **La prenda queda apartada** mientras se espera el pago | **Nada apartado.** Si en el medio se vende en el local o en Mercado Libre, cuando llega el pago no hay stock |
| Si no hay stock al cobrar | No pasa | Hay que **devolverle la plata** al cliente |
| Riesgo de despachar sin cobrar | Ninguno, si «Envíos del día» respeta la marca | Ninguno |

**Recomendamos A.** La transferencia tiene 20% de descuento y va a ser un medio muy usado. Con B, cada transferencia es una venta que puede terminar en devolución de dinero, y el cliente ya pagó.

B sirve como **puente**: abrir sólo con **Mercado Pago** (se paga en el momento) mientras Stocker construye A, y sumar transferencia, Pago Fácil y pago al retirar después. Si el dueño elige el puente, la tienda lo implementa: retiene y manda a Stocker al cobrar, y apaga los otros medios hasta que esté A. Para eso la tienda suma un ajuste en el backoffice para elegir los medios de pago. Hoy no se pueden apagar uno por uno: Mercado Pago trae también Pago Fácil, la transferencia aparece si hay CBU cargado y el pago en el local está siempre.

## 5. Resumen para planificar

| # | Qué | Quién | Bloquea |
|---|---|---|---|
| 3.1 | `id` de producto y variante en el catálogo, y un JSON de ejemplo | Stocker | Todo: sin esto no hay productos |
| 3.2 | Pago pendiente + `/cobros` (decidido: opción A) | Stocker | El checkout |
| 3.3 | Guardar y mostrar el envío (tipo, corte, seguimiento) | Stocker | El despacho |
| 3.4 | `/pedidos/resoluciones` de la tienda | Stocker | El aviso de despacho al cliente |
| § 2 | Cliente de la tienda y simulador en contrato v1 | Tienda | — (se hace cuando Stocker confirme) |
