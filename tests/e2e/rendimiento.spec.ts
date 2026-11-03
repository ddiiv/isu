import { expect, test } from "./base";

/* Lo que cuida la velocidad de la tienda (desde v1.23). */

test("prioridad de fotos: en el inicio, ninguna grilla; en una categoría, la primera fila", async ({ page }) => {
  await page.goto("/");
  // Con productos en las grillas (si no, la prueba pasaría sin probar nada).
  expect(await page.locator("main ul li img").count()).toBeGreaterThan(8);
  // Sólo el banner (el LCP) puede pedir prioridad; las grillas están abajo del pliegue.
  expect(await page.locator('main img[fetchpriority="high"]:not(.banner-foto)').count()).toBe(0);
  await page.goto("/mujer");
  expect(await page.locator('main ul li img[fetchpriority="high"]').count()).toBe(2);
});
