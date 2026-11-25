-- La ruleta también para quien no tiene sesión (invitados). El navegador guarda un identificador al azar (localStorage) y manda su
-- hash; el sorteo y los límites siguen siendo del servidor:
--   · un giro por dispositivo cada `cada_dias` (mismo ritmo que las cuentas), y
--   · como localStorage se puede borrar, además un tope de giros por conexión (IP, guardada sólo como hash con sal) en esa ventana.
-- El cupón de un invitado no es personal de una cuenta: es un código de un solo uso que ve el dispositivo que lo ganó.
ALTER TABLE tienda.ruleta_giros ALTER COLUMN cliente_id DROP NOT NULL;
ALTER TABLE tienda.ruleta_giros
  ADD COLUMN dispositivo varchar(64),
  ADD COLUMN ip_hash varchar(64);
ALTER TABLE tienda.ruleta_giros ADD CONSTRAINT ruleta_giros_quien CHECK (cliente_id IS NOT NULL OR dispositivo IS NOT NULL);
CREATE INDEX ruleta_giros_dispositivo ON tienda.ruleta_giros (dispositivo, creado_en DESC) WHERE dispositivo IS NOT NULL;
CREATE INDEX ruleta_giros_ip ON tienda.ruleta_giros (ip_hash, creado_en DESC) WHERE ip_hash IS NOT NULL;
