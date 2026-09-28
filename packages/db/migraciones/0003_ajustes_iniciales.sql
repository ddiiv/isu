-- Valores iniciales. Salen de lo que hoy publica www.isuwaya.com; se cambian
-- desde el backoffice. ON CONFLICT: nunca pisa algo ya editado.
INSERT INTO tienda.ajustes (clave, valor, actualizado_por) VALUES
  ('montoMinimoCarrito',    '0'::jsonb,        'migracion'),
  ('envioGratisDesde',      'null'::jsonb,     'migracion'),
  ('descuentoTransferencia','20'::jsonb,       'migracion'),
  ('cuotasSinInteres',      '3'::jsonb,        'migracion'),
  ('whatsapp',              '"5491168515444"'::jsonb, 'migracion'),
  ('email',                 '"isu.isuwaya@gmail.com"'::jsonb, 'migracion'),
  ('anuncio',               '"Envíos a toda la Argentina · 3 cuotas sin interés · 20% OFF con transferencia"'::jsonb, 'migracion'),
  ('locales', '[
     {"nombre":"Vía Flores · Local 21","direccion":"Bacacay 3231, Galería Vía Flores","localidad":"Flores, CABA","horario":"Lunes a viernes de 8 a 14 h","mapa":null,"retiro":true},
     {"nombre":"La Salada · Galería Mogote","direccion":"Isaac Newton 5002, Pasillo 8, puesto 174","localidad":"Ingeniero Budge, Lomas de Zamora","horario":"Días de feria","mapa":null,"retiro":true},
     {"nombre":"La Salada · Galería Ocean","direccion":"Isaac Newton 5002, Pasillo 3, puesto 123","localidad":"Ingeniero Budge, Lomas de Zamora","horario":"Días de feria","mapa":null,"retiro":true}
   ]'::jsonb, 'migracion')
ON CONFLICT (clave) DO NOTHING;

-- Categorías de arranque (las mismas que el sitio mayorista). Se editan en el backoffice.
INSERT INTO tienda.categorias (nombre, slug, orden) VALUES
  ('Hombre', 'hombre', 1), ('Mujer', 'mujer', 2), ('Niños', 'ninos', 3)
ON CONFLICT DO NOTHING;

INSERT INTO tienda.categorias (padre_id, nombre, slug, orden)
SELECT p.id, s.nombre, s.slug, s.orden
FROM tienda.categorias p
JOIN (VALUES
  ('hombre', 'Remeras', 'remeras', 1), ('hombre', 'Pantalones', 'pantalones', 2),
  ('hombre', 'Buzos y camperas', 'buzos-y-camperas', 3), ('hombre', 'Shorts y bermudas', 'shorts-y-bermudas', 4),
  ('mujer', 'Remeras y tops', 'remeras-y-tops', 1), ('mujer', 'Pantalones y calzas', 'pantalones-y-calzas', 2),
  ('mujer', 'Buzos y camperas', 'buzos-y-camperas', 3), ('mujer', 'Shorts y bermudas', 'shorts-y-bermudas', 4),
  ('ninos', 'Remeras', 'remeras', 1), ('ninos', 'Pantalones', 'pantalones', 2),
  ('ninos', 'Camperas', 'camperas', 3), ('ninos', 'Shorts', 'shorts', 4)
) AS s(padre, nombre, slug, orden) ON s.padre = p.slug AND p.padre_id IS NULL
ON CONFLICT DO NOTHING;
