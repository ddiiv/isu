-- Catálogo en PDF (backoffice → Catálogo PDF): qué productos entran. Por defecto ninguno; se eligen desde la pantalla y quedan guardados
-- para la próxima descarga.
ALTER TABLE tienda.productos ADD COLUMN en_catalogo boolean NOT NULL DEFAULT false;
