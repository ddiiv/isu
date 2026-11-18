-- PROPUESTA DE CUPONES (no es una migración: no se ejecuta sola).
--
-- Cinco cupones con código, todos INACTIVOS (activo = false) para que el dueño los revise y los active
-- desde el backoffice (Cupones → editar → «Activo»). Los montos van en centavos, como en toda la tabla
-- (tienda.cupones, migraciones 0011, 0029 y 0030).
--
-- Cómo leer el tope: el descuento de un porcentaje nunca pasa del tope. Un 25% con tope $12.500 equivale a
-- un 25% sobre una compra de hasta $50.000; lo que se compre de más ya no descuenta más.
-- Todos respetan además el piso: ninguna prenda baja de su precio mayorista (si una prenda no tiene el
-- mayorista cargado, no recibe descuento del cupón).
--
-- Para cargarlos: psql "$DATABASE_URL" -f docs/cupones-propuesta.sql   (o por el backoffice, ver cupones-propuesta.md).
-- Si se corre dos veces falla por el índice único del código: no duplica.

BEGIN;

-- PRIMERA10: 10% de descuento, hasta $10.000 (equivale a 10% sobre compras de hasta $100.000). Una vez por cliente.
INSERT INTO tienda.cupones (codigo, nombre, automatico, tipo, valor, alcance, sobre_rebajas, minimo, tope, usos_por_cliente, activo, creado_por)
VALUES ('PRIMERA10', '10% OFF, hasta $10.000 de descuento', false, 'porcentaje', 10, 'todo', true, 0, 1000000, 1, false, 'propuesta');

-- MEDIO15: 15% de descuento, hasta $11.250 (15% sobre compras de hasta $75.000). Una vez por cliente.
INSERT INTO tienda.cupones (codigo, nombre, automatico, tipo, valor, alcance, sobre_rebajas, minimo, tope, usos_por_cliente, activo, creado_por)
VALUES ('MEDIO15', '15% OFF, hasta $11.250 de descuento', false, 'porcentaje', 15, 'todo', true, 0, 1125000, 1, false, 'propuesta');

-- FUERTE20: 20% de descuento, hasta $12.000 (20% sobre compras de hasta $60.000). Una vez por cliente.
INSERT INTO tienda.cupones (codigo, nombre, automatico, tipo, valor, alcance, sobre_rebajas, minimo, tope, usos_por_cliente, activo, creado_por)
VALUES ('FUERTE20', '20% OFF, hasta $12.000 de descuento', false, 'porcentaje', 20, 'todo', true, 0, 1200000, 1, false, 'propuesta');

-- SUPER25: 25% de descuento, hasta $12.500 (25% sobre compras de hasta $50.000). Una vez por cliente.
INSERT INTO tienda.cupones (codigo, nombre, automatico, tipo, valor, alcance, sobre_rebajas, minimo, tope, usos_por_cliente, activo, creado_por)
VALUES ('SUPER25', '25% OFF, hasta $12.500 de descuento', false, 'porcentaje', 25, 'todo', true, 0, 1250000, 1, false, 'propuesta');

-- MEZCLA: algunas prendas a precio mayorista según cuántas lleve el cliente (se cuentan las prendas elegibles):
--   3 o 4 prendas  -> la más barata va a mayorista
--   5 a 7 prendas  -> las 2 más baratas
--   8 o más        -> las 4 más baratas
-- Máximo 5 prendas a mayorista por compra (max_mayorista), sin tope en pesos, sin límite por cliente.
-- valor = 0 y tope = NULL: así lo pide el check de la tabla para este tipo.
INSERT INTO tienda.cupones (codigo, nombre, automatico, tipo, valor, alcance, sobre_rebajas, minimo, tope, escala, max_mayorista, usos_por_cliente, activo, creado_por)
VALUES ('MEZCLA', 'Mezclá prendas: algunas a precio mayorista', false, 'mezcla', 0, 'todo', true, 0, NULL,
        '[{"desde":3,"mayorista":1},{"desde":5,"mayorista":2},{"desde":8,"mayorista":4}]'::jsonb, 5, NULL, false, 'propuesta');

COMMIT;
