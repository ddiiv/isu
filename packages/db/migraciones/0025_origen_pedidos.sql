-- De dónde llegó cada compra (UTM o sitio de referencia), sólo texto corto y sin datos personales. NULL: directo o no informado.
ALTER TABLE tienda.pedidos ADD COLUMN origen jsonb CHECK (origen IS NULL OR jsonb_typeof(origen) = 'object');
