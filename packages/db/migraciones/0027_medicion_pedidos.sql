-- Para la API de conversiones de Meta: lo que el navegador dejó al comprar, sólo si la persona aceptó las cookies
-- (cookies _fbp y _fbc del Pixel y su user agent). Sin esto no se manda la compra a Meta.
ALTER TABLE tienda.pedidos ADD COLUMN medicion jsonb;
