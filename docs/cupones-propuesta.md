# Cupones propuestos

Todos con código, sin vigencia, para toda la tienda y **inactivos**: se revisan y se activan desde el backoffice
(Cupones → editar → «Activo»). Los scripts están en `docs/cupones-propuesta.sql` (no es una migración; no se corre solo).

| Código | Qué hace | Tope del descuento | Equivale a | Por cliente |
|---|---|---|---|---|
| PRIMERA10 | 10% | $10.000 | 10% sobre compras de hasta $100.000 | 1 vez |
| MEDIO15 | 15% | $11.250 | 15% sobre compras de hasta $75.000 | 1 vez |
| FUERTE20 | 20% | $12.000 | 20% sobre compras de hasta $60.000 | 1 vez |
| SUPER25 | 25% | $12.500 | 25% sobre compras de hasta $50.000 | 1 vez |
| MEZCLA | Prendas a precio mayorista: 3 prendas → 1, 5 → 2, 8 → 4 (máx. 5 por compra) | sin tope | la más barata primero | sin límite |

Regla de fondo: **el precio mayorista es el piso**. Ningún cupón deja una prenda por debajo de su mayorista; si una prenda
no tiene el mayorista cargado (todavía no vino de Stocker), no recibe descuento del cupón.

## Cargarlos por el backoffice

1. Cupones → «Nuevo cupón». Escribir el código (en mayúsculas) y el nombre que verá el cliente.
2. Porcentajes: «Descuento» = Porcentaje, poner el %, en «Tope del descuento ($)» el monto de la tabla, «Se aplica a» = Toda la tienda.
   En «Usos por cliente» poner 1.
3. MEZCLA: «Descuento» = Mezcla; en «Escala» agregar los tramos (desde 3 → 1, desde 5 → 2, desde 8 → 4) y «Máximo de prendas a mayorista» = 5.
4. Dejar «Activo» apagado hasta revisarlo; para publicarlo, activarlo.

Por SQL: `psql "$DATABASE_URL" -f docs/cupones-propuesta.sql` (falla, sin duplicar, si el código ya existe).
