-- Envío en moto (logística propia, como el Flex): sólo CABA y GBA, por zonas con precio fijo.
-- No tiene transporte integrado (igual que `estandar`): se despacha a mano desde el backoffice,
-- así que `tienda.envios` no cambia. Acá: el pedido puede viajar con `moto` y el ajuste de fábrica.
ALTER TABLE tienda.pedidos DROP CONSTRAINT pedidos_transporte_check;
ALTER TABLE tienda.pedidos
  ADD CONSTRAINT pedidos_transporte_check CHECK (transporte IN ('correo_argentino', 'andreani', 'oca', 'mercado_envios', 'cabify', 'estandar', 'moto'));

-- Apagado de fábrica: se prende en Ajustes después de revisar zonas, días y hora de corte.
-- Días (1 = lunes), hora de corte y zonas con el precio en centavos y sus códigos postales.
INSERT INTO tienda.ajustes (clave, valor, actualizado_por) VALUES
  ('envioMoto', '{
     "activo": false, "dias": [1, 2, 3, 4, 5], "horaCorte": "14:00",
     "zonas": [
       {"nombre": "CABA", "precio": 450000, "cps": "1000-1499"},
       {"nombre": "Primer cordón", "precio": 750000, "cps": "1602-1607,1609,1636-1638,1640-1643,1650-1657,1672-1678,1682-1685,1687,1702-1708,1753-1754,1766,1768,1770,1778"},
       {"nombre": "Segundo cordón", "precio": 1000000, "cps": "1608,1610-1618,1621,1624,1644-1648,1659,1661-1663,1665,1670,1686,1688,1712-1716,1718,1721-1723,1742-1746,1761,1773,1802-1807,1812-1813,1822-1836,1838-1843,1846-1856,1868-1891"},
       {"nombre": "Tercer cordón", "precio": 1200000, "cps": "1619,1623,1625,1627,1727,1748,1862,1864-1865"},
       {"nombre": "Pilar, Luján y La Plata", "precio": 2590000, "cps": "1620,1629-1635,1664,1667,1669,1893-1910,6700-6708,6712"}
     ]
   }'::jsonb, 'migracion')
ON CONFLICT (clave) DO NOTHING;
