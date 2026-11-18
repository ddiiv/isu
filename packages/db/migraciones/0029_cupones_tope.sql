-- Tope del descuento de un cupón de porcentaje, en centavos: el descuento nunca pasa de ese monto
-- (25% con tope $12.500 = 25% en compras de hasta $50.000). NULL = sin tope. Sólo lo usa el tipo porcentaje.
ALTER TABLE tienda.cupones ADD COLUMN tope bigint CHECK (tope IS NULL OR tope > 0);
