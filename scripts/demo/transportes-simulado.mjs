/*
 * Transportes y WhatsApp simulados (Correo Argentino, Andreani, OCA,
 * Mercado Envíos, Cabify): pnpm demo:transportes
 *
 * La tienda los usa con TRANSPORTES_SIMULADOR=http://127.0.0.1:3920 en el
 * .env. En http://127.0.0.1:3920/ se ven los envíos creados (con un botón
 * para avanzar su estado) y los WhatsApp que se mandaron.
 */
import { levantarSimulador } from "../../packages/envios/dist/simulador.js";

const puerto = Number(process.env.PUERTO_TRANSPORTES ?? 3920);
const s = await levantarSimulador(puerto, "127.0.0.1");
console.warn(`Transportes simulados en ${s.url} (Correo Argentino, Andreani, OCA, Mercado Envíos, Cabify y WhatsApp)`);
