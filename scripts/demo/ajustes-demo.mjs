/*
 * Ajustes de muestra para probar la tienda en local: datos para transferir
 * (inventados), envío gratis desde $80.000 y el link del local de Flores. En producción se cargan desde el
 * backoffice (etapa 3).
 */
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
await pool.query(`UPDATE tienda.ajustes SET valor = $1, actualizado_por = 'demo' WHERE clave = 'datosTransferencia'`,
  [JSON.stringify({ titular: "ISUWAYA (DATOS DE PRUEBA)", cuit: "30-00000000-0", banco: "Banco de Prueba", cbu: "0000000000000000000000", alias: "ISUWAYA.PRUEBA" })]);
await pool.query(`UPDATE tienda.ajustes SET valor = '8000000', actualizado_por = 'demo' WHERE clave = 'envioGratisDesde'`);
// El link del local de Flores (Google Maps): en la tienda, su nombre y «Cómo llegar» llevan ahí. Los otros, sin link.
const { rows } = await pool.query("SELECT valor FROM tienda.ajustes WHERE clave = 'locales'");
if (Array.isArray(rows[0]?.valor)) {
  const locales = rows[0].valor.map((l) => (l.nombre === "Vía Flores · Local 21" && !l.mapa ? { ...l, mapa: "https://www.google.com/maps/search/?api=1&query=Bacacay+3231+Flores+CABA" } : l));
  await pool.query("UPDATE tienda.ajustes SET valor = $1, actualizado_por = 'demo' WHERE clave = 'locales'", [JSON.stringify(locales)]);
}
await pool.end();
console.warn("Ajustes de muestra cargados (transferencia de prueba, envío gratis desde $80.000, link del local de Flores).");
