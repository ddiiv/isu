-- Un video vertical por producto (MP4). Entra como borrador: en la tienda se ve recién cuando alguien lo publica
-- desde el backoffice (los hechos con IA pueden cambiar la prenda y hay que mirarlos antes).
ALTER TABLE tienda.productos
  ADD COLUMN video_clave varchar(80) CHECK (video_clave ~ '^v/[a-f0-9]{12}/[a-f0-9]{16}\.mp4$'),
  ADD COLUMN video_publicado boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT productos_video_publicado CHECK (video_clave IS NOT NULL OR NOT video_publicado);
