/*
 * El número de cliente de MiCorreo (customerId) para CORREO_AR_CLIENTE:
 *
 *   pnpm correo:cliente
 *
 * Usa las credenciales de la API (CORREO_AR_USUARIO y CORREO_AR_CLAVE, las
 * que da Correo) y pregunta el email y la contraseña de la cuenta de
 * MiCorreo de la tienda (POST /users/validate). La contraseña no se muestra
 * mientras se escribe ni se guarda en ningún lado.
 *
 * Para el ambiente de pruebas de Correo, CORREO_AR_URL=https://apitest.correoargentino.com.ar/micorreo/v1
 */
import { createInterface } from "node:readline";
import { correoArgentino } from "../packages/envios/dist/index.js";

const url = process.env.CORREO_AR_URL || "https://api.correoargentino.com.ar/micorreo/v1";
const usuario = process.env.CORREO_AR_USUARIO ?? "";
const clave = process.env.CORREO_AR_CLAVE ?? "";
if (!usuario || !clave) {
  console.error("Faltan CORREO_AR_USUARIO y CORREO_AR_CLAVE en el .env (las credenciales de la API que da Correo Argentino).");
  process.exit(1);
}

// Una sola interfaz para las dos preguntas; las líneas que llegan antes de tiempo (entrada redirigida) se guardan.
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY === true });
let oculto = false;
const escribir = rl._writeToOutput?.bind(rl);
// La contraseña no se muestra mientras se escribe.
if (escribir) rl._writeToOutput = (t) => { if (!oculto) escribir(t); };
const lineas = [];
let esperando = null;
rl.on("line", (l) => { if (esperando) { const r = esperando; esperando = null; r(l.trim()); } else lineas.push(l.trim()); });
const preguntar = (texto) => {
  process.stdout.write(texto);
  return lineas.length ? Promise.resolve(lineas.shift()) : new Promise((ok) => { esperando = ok; });
};

const email = await preguntar("Email de la cuenta de MiCorreo: ");
oculto = true;
const contrasena = await preguntar("Contraseña de MiCorreo (no se ve): ");
oculto = false;
process.stdout.write("\n");
rl.close();
try {
  const id = await correoArgentino({ url, usuario, clave, cliente: "" }).cliente(email, contrasena);
  if (!id) throw new Error("MiCorreo no devolvió el número de cliente");
  process.stdout.write(`\nCORREO_AR_CLIENTE=${id}\n\nCopialo en las variables del servicio (Railway).\n`);
} catch (e) {
  console.error(`\nNo se pudo: ${e.message}`);
  process.exit(1);
}
