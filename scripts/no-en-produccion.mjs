/*
 * `pnpm dev` (y `pnpm start` en la raíz) son para la compu de desarrollo.
 * En Railway, cada servicio arranca con su propio archivo de configuración
 * (infra/railway/<servicio>.json). Si algo intenta levantar el modo
 * desarrollo ahí, mejor fallar con un mensaje claro que servir una tienda
 * rota (lenta, sin API y con pantallas en blanco).
 */
const enRailway = !!(process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID);
const raiz = process.argv[2] === "raiz";
if (enRailway || raiz) {
  console.error(`
✗ ${raiz ? "La raíz del repo no se arranca como un servicio." : "Esto es el modo desarrollo (pnpm dev): no va en Railway."}

  Todo en un solo servicio (lo más simple): no configures nada, usa railway.json
  de la raíz (o Settings → Config-as-code → infra/railway/todo.json).
  O cuatro servicios separados (para más tráfico):
    tienda-api → infra/railway/api.json · tienda-worker → worker.json
    tienda-web → web.json · tienda-admin → admin.json
  (Root directory: la raíz del repo. Variables: docs/despliegue.md.)
  Guía corta: SUBIR-A-PRODUCCION.md.
`);
  process.exit(1);
}
