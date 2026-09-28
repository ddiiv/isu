import "server-only";
import { ConfigPublica, CategoriaNodo } from "@isu/shared";
import { z } from "zod";

/*
 * Lectura de la API desde el servidor de Next (nunca desde el navegador para
 * estos datos: van incrustados en el HTML estático).
 *
 * API_URL es la dirección interna de Railway (red privada). Si la API no
 * responde —en el build o en producción— la página se arma igual con los
 * valores de respaldo: una tienda que no carga porque se cayó la API es peor
 * que una con un dato viejo por un minuto.
 */
const API = (process.env.API_URL ?? "http://127.0.0.1:4000").replace(/\/+$/, "");
const REVALIDAR = 60;

async function pedir<T>(ruta: string, esquema: z.ZodType<T>, respaldo: T): Promise<T> {
  try {
    const r = await fetch(`${API}${ruta}`, {
      next: { revalidate: REVALIDAR, tags: [ruta] },
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return esquema.parse(await r.json());
  } catch (err) {
    console.warn(`[api] ${ruta}: ${(err as Error).message} — se usan valores de respaldo`);
    return respaldo;
  }
}

export const CONFIG_RESPALDO: ConfigPublica = {
  montoMinimoCarrito: 0,
  envioGratisDesde: null,
  descuentoTransferencia: 20,
  cuotasSinInteres: 3,
  whatsapp: "5491168515444",
  email: "isu.isuwaya@gmail.com",
  anuncio: "Envíos a toda la Argentina · 3 cuotas sin interés · 20% OFF con transferencia",
  locales: [
    { nombre: "Vía Flores · Local 21", direccion: "Bacacay 3231, Galería Vía Flores", localidad: "Flores, CABA", horario: "Lunes a viernes de 8 a 14 h", mapa: null, retiro: true },
  ],
};

export const CATEGORIAS_RESPALDO: CategoriaNodo[] = [
  { id: -1, nombre: "Hombre", slug: "hombre", hijas: [] },
  { id: -2, nombre: "Mujer", slug: "mujer", hijas: [] },
  { id: -3, nombre: "Niños", slug: "ninos", hijas: [] },
];

export const obtenerConfig = () => pedir("/v1/config", ConfigPublica, CONFIG_RESPALDO);
export const obtenerCategorias = () => pedir("/v1/categorias", z.array(CategoriaNodo), CATEGORIAS_RESPALDO);
