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

  La tienda son cuatro servicios, cada uno con su configuración:
    tienda-api     → Settings → Config-as-code → infra/railway/api.json
    tienda-worker  → infra/railway/worker.json
    tienda-web     → infra/railway/web.json
    tienda-admin   → infra/railway/admin.json
  (Root directory: la raíz del repo. Variables: docs/despliegue.md.)
  Guía corta: SUBIR-A-PRODUCCION.md.
`);
  process.exit(1);
}
