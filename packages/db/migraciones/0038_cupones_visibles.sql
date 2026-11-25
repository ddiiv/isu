-- Cupones visibles en la tienda. Hay tres clases de cupón:
--   · con código secreto: el cliente lo escribe en el carrito (como siempre; `visible = false`);
--   · visibles: la tienda los muestra en /cupones y en el carrito, con un botón para aplicarlos (`visible = true`);
--   · personales: los gana una cuenta en la ruleta (`cliente_id`) y sólo los ve y usa esa cuenta.
-- Sólo un cupón con código y que no sea personal puede ser visible: lo que se muestra al público es lo que el dueño eligió mostrar.
ALTER TABLE tienda.cupones
  ADD COLUMN visible boolean NOT NULL DEFAULT false,
  ADD COLUMN descripcion varchar(160);
ALTER TABLE tienda.cupones ADD CONSTRAINT cupones_visible CHECK (NOT visible OR (codigo IS NOT NULL AND cliente_id IS NULL));
