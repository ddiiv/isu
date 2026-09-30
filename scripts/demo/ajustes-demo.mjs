/*
 * Ajustes de muestra para probar la tienda en local: datos para transferir
 * (inventados) y envío gratis desde $80.000. En producción se cargan desde el
 * backoffice (etapa 3).
 */
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
await pool.query(`UPDATE tienda.ajustes SET valor = $1, actualizado_por = 'demo' WHERE clave = 'datosTransferencia'`,
  [JSON.stringify({ titular: "ISUWAYA (DATOS DE PRUEBA)", cuit: "30-00000000-0", banco: "Banco de Prueba", cbu: "0000000000000000000000", alias: "ISUWAYA.PRUEBA" })]);
await pool.query(`UPDATE tienda.ajustes SET valor = '8000000', actualizado_por = 'demo' WHERE clave = 'envioGratisDesde'`);
await pool.end();
console.warn("Ajustes de muestra cargados (transferencia de prueba, envío gratis desde $80.000).");
