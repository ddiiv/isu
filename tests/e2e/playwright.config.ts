import { defineConfig, devices } from "@playwright/test";

/*
 * Pruebas de la tienda en un navegador real, en escritorio y en celular.
 * Se corren contra los servicios levantados (local o el deploy de staging):
 *   WEB_URL=http://127.0.0.1:3000 pnpm e2e
 */
const ejecutable = process.env.CHROMIUM_PATH;
export default defineConfig({
  testDir: ".",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.WEB_URL ?? "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    launchOptions: ejecutable ? { executablePath: ejecutable } : {},
  },
  projects: [
    { name: "escritorio", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "celular", use: { ...devices["Pixel 7"] } },
  ],
});
