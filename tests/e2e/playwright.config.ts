import { defineConfig, devices } from "@playwright/test";

/*
 * Pruebas de la tienda en un navegador real, en escritorio y en celular.
 * Se corren contra los servicios levantados (local o el deploy de staging):
 *   WEB_URL=http://localhost:3000 pnpm e2e
 */
const ejecutable = process.env.CHROMIUM_PATH;
export default defineConfig({
  testDir: ".",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    // El mismo origen que SITIO_URL: Mercado Pago vuelve ahí, y el acceso al pedido queda guardado en ese origen.
    baseURL: process.env.WEB_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    launchOptions: ejecutable ? { executablePath: ejecutable } : {},
  },
  projects: [
    { name: "escritorio", testIgnore: /transferencias\.spec/, use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "celular", testIgnore: /transferencias\.spec/, use: { ...devices["Pixel 7"] } },
    // Cambia un ajuste de toda la tienda (transferencias que se confirman solas): corre cuando terminaron las demás.
    { name: "transferencias", testMatch: /transferencias\.spec/, dependencies: ["escritorio", "celular"], use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
});
