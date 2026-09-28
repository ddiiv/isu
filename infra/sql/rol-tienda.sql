-- ─────────────────────────────────────────────────────────────────────
-- Usuario propio para la tienda en la base de Stocker.
--
-- Se corre UNA vez, con el usuario administrador de Postgres de Railway.
-- Resultado: la tienda puede todo dentro de su esquema `tienda` y NADA
-- sobre las tablas de Stocker (esquema public). Si alguien lograra una
-- inyección SQL en la tienda, no podría leer ni tocar ventas, clientes ni
-- facturas de Stocker.
-- ─────────────────────────────────────────────────────────────────────

CREATE ROLE tienda_app LOGIN PASSWORD 'CAMBIAR-por-una-clave-larga'
  CONNECTION LIMIT 30;                    -- techo: nunca le come las conexiones a Stocker

CREATE SCHEMA IF NOT EXISTS tienda AUTHORIZATION tienda_app;

REVOKE ALL ON SCHEMA public FROM tienda_app;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM tienda_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;  -- (Postgres 15+ ya viene así)

-- Tiempo máximo por consulta y por transacción abierta, a nivel de rol.
ALTER ROLE tienda_app SET statement_timeout = '10s';
ALTER ROLE tienda_app SET idle_in_transaction_session_timeout = '15s';

-- Después: DATABASE_URL de la tienda = postgres://tienda_app:…@<host>:<puerto>/<base de Stocker>
