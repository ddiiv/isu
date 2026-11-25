-- La sección «Amigo invisible» (Parte 4) ya existe: el banner principal de Navidad (0034) y el de la 2da unidad pasan a llevar a
-- ella. Sólo si todavía tienen los botones originales: si alguien los editó desde Portada, no se pisan.
UPDATE tienda.banners SET botones = '[{"texto": "Ver regalos", "enlace": "/amigo-invisible", "estilo": "lleno"}, {"texto": "Comprar Mujer", "enlace": "/mujer", "estilo": "borde"}]'::jsonb
 WHERE evento_id IS NOT NULL AND titulo = 'Navidad en Isuwaya'
   AND botones = '[{"texto": "Comprar Mujer", "enlace": "/mujer", "estilo": "lleno"}, {"texto": "Comprar Hombre", "enlace": "/hombre", "estilo": "borde"}]'::jsonb;
UPDATE tienda.banners SET botones = '[{"texto": "Ver regalos", "enlace": "/amigo-invisible", "estilo": "lleno"}]'::jsonb
 WHERE evento_id IS NOT NULL AND titulo = '2da unidad al 50% OFF'
   AND botones = '[{"texto": "Ver Mujer", "enlace": "/mujer", "estilo": "lleno"}, {"texto": "Ver Hombre", "enlace": "/hombre", "estilo": "borde"}]'::jsonb;
