-- Etapa 10: eliminar productos desde el backoffice, y guías de talles con talles propios.
--
-- Es una baja suave: el producto sale de la tienda y de las listas del
-- backoffice, pero la fila queda (los pedidos viejos la nombran, y si se
-- borrara, la próxima sincronización con Stocker lo volvería a crear como
-- nuevo y publicado). La sincronización no toca `visible` de un producto que
-- ya existe, así que uno eliminado no vuelve solo. Se puede restaurar desde
-- Productos → filtro «Eliminados».
ALTER TABLE tienda.productos ADD COLUMN IF NOT EXISTS eliminado_en timestamptz;
ALTER TABLE tienda.productos ADD COLUMN IF NOT EXISTS eliminado_por text;
-- Eliminado = oculto, siempre (ningún camino lo puede volver a publicar sin restaurarlo antes).
ALTER TABLE tienda.productos DROP CONSTRAINT IF EXISTS productos_eliminado_oculto;
ALTER TABLE tienda.productos ADD CONSTRAINT productos_eliminado_oculto CHECK (eliminado_en IS NULL OR NOT visible);
CREATE INDEX IF NOT EXISTS productos_eliminados ON tienda.productos (eliminado_en) WHERE eliminado_en IS NOT NULL;

-- Etapa 10: guías de talles con talles propios ("otro": 1 a 8 de pantalón,
-- "3 (L)"…) para traer las de la fábrica desde Excel tal como están.
ALTER TABLE tienda.guias_talles DROP CONSTRAINT IF EXISTS guias_talles_tipo_check;
ALTER TABLE tienda.guias_talles ADD CONSTRAINT guias_talles_tipo_check CHECK (tipo IN ('nino', 'adulto', 'otro'));
