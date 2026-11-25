-- Banners de la edición Navidad: atados al evento «navidad» (0032), así que aparecen al prenderlo y se van al apagarlo.
-- Usan los fondos de siempre (oferta = rojo, ahorro = verde, tinta, crema): sin colores nuevos. Los textos admiten las
-- variables {descuento}, {cuotas}, {envioGratis}: salen de Ajustes y, si una no tiene valor, el banner no sale.
-- Quedan primeros del carrusel (orden bajo). Se editan desde Portada como cualquier banner. No son «sugeridos»: esos son
-- los de la tienda de siempre y se restauran aparte.
-- Los botones llevan a Mujer y Hombre; la Parte 4 (sección Navidad) los puede apuntar a la página nueva.
INSERT INTO tienda.banners (orden, activo, alt, titulo, texto, etiqueta, botones, fondo, alineacion, producto_auto, ocultar_sin_producto, evento_id)
SELECT s.orden, true, s.alt, s.titulo, s.texto, s.etiqueta, s.botones::jsonb, s.fondo, 'izquierda', s.producto_auto, s.ocultar, e.id
  FROM tienda.eventos e,
  (VALUES
    (-40, 'Navidad en Isuwaya: ropa para regalar y para regalarte',
     'Navidad en Isuwaya', 'Ropa para regalar y para regalarte, con descuentos en prendas seleccionadas.', 'Edición Navidad',
     '[{"texto": "Comprar Mujer", "enlace": "/mujer", "estilo": "lleno"}, {"texto": "Comprar Hombre", "enlace": "/hombre", "estilo": "borde"}]',
     'oferta', 'destacado', false),
    (-39, '2da unidad al 50% OFF en Navidad',
     '2da unidad al 50% OFF', 'Llevá dos prendas, las que quieras, y la más barata sale a mitad de precio.', 'Amigo invisible',
     '[{"texto": "Ver Mujer", "enlace": "/mujer", "estilo": "lleno"}, {"texto": "Ver Hombre", "enlace": "/hombre", "estilo": "borde"}]',
     'ahorro', NULL, false),
    (-38, '10% OFF extra en compras de más de $120.000',
     '10% OFF en compras de más de $120.000', 'Armá tu regalo grande: el descuento se aplica solo en el carrito.', 'Navidad',
     '[{"texto": "Armar mi compra", "enlace": "/nuevos", "estilo": "lleno"}]',
     'tinta', NULL, false),
    (-37, '{cuotas} cuotas sin interés y {descuento}% OFF por transferencia',
     '{cuotas} cuotas sin interés', 'Y {descuento}% OFF pagando con transferencia. Envíos a todo el país.', 'Pagá como quieras',
     '[{"texto": "Ver novedades", "enlace": "/nuevos", "estilo": "lleno"}]',
     'crema', NULL, false)
  ) AS s(orden, alt, titulo, texto, etiqueta, botones, fondo, producto_auto, ocultar)
 WHERE e.clave = 'navidad';
