import { expect, test, type Page } from "./base";

/*
 * Etapa 14: movimiento liviano.
 *
 *   · el carrusel pasa solo con su barrita de progreso y se puede pausar;
 *     quien pidió menos animaciones no lo ve pasar solo (ni el botón);
 *   · el menú del celular y el carrito entran y salen animados, y al cerrarse
 *     desaparecen del todo (no quedan tapando la página);
 *   · las fuentes llegan en WOFF2 (livianas), nunca los TTF.
 */
function vigilar(page: Page) {
  const errores: string[] = [];
  page.on("pageerror", (e) => errores.push(e.message));
  return errores;
}
const carrusel = (page: Page) => page.locator('section[aria-roledescription="carrusel"]');

test("carrusel: pasa solo con su barrita y se puede pausar", async ({ page }) => {
  const errores = vigilar(page);
  await page.goto("/");
  const c = carrusel(page);
  await expect(c.locator(".progreso-banner")).toHaveCount(1);
  const pausa = c.getByRole("button", { name: "Pausar los banners" });
  await expect(pausa).toHaveAttribute("aria-pressed", "false");
  await pausa.click();
  const seguir = c.getByRole("button", { name: "Seguir pasando los banners" });
  await expect(seguir).toHaveAttribute("aria-pressed", "true");
  await expect(c.locator("[data-pausado]")).toHaveAttribute("data-pausado", "true");
  // Pausado no cambia de banner.
  const antes = await c.getByRole("button", { name: /^Ir al / }).evaluateAll((bs) => bs.findIndex((b) => b.getAttribute("aria-current") === "true"));
  await page.mouse.move(0, 0);
  await page.waitForTimeout(6800);
  const despues = await c.getByRole("button", { name: /^Ir al / }).evaluateAll((bs) => bs.findIndex((b) => b.getAttribute("aria-current") === "true"));
  expect(despues).toBe(antes);
  await seguir.click();
  await expect(c.getByRole("button", { name: "Pausar los banners" })).toBeVisible();
  expect(errores).toEqual([]);
});

test("con menos animaciones pedidas, el carrusel no pasa solo ni muestra la pausa", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const c = carrusel(page);
  await expect(c).toBeVisible();
  await expect(c.getByRole("button", { name: "Pausar los banners" })).toHaveCount(0);
  await expect(c.locator(".progreso-banner")).toHaveCount(0);
});

test("el menú del celular y el carrito entran y salen, y al cerrarse no quedan tapando nada", async ({ page, isMobile }) => {
  const errores = vigilar(page);
  if (isMobile) {
    await page.goto("/");
    await page.getByRole("button", { name: "Abrir menú" }).click();
    const menu = page.getByRole("dialog", { name: "Menú" });
    await expect(menu).toBeVisible();
    await menu.getByRole("button", { name: "Cerrar menú" }).click();
    await expect(menu).toHaveCount(0);
    // La página se puede usar de nuevo enseguida.
    await page.getByRole("button", { name: "Abrir menú" }).click();
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
  }
  await page.goto("/producto/remera-basica-cuello-redondo");
  await page.locator("fieldset", { hasText: "Talle" }).getByRole("button", { disabled: false }).first().click();
  await page.getByRole("button", { name: "Agregar al carrito" }).click();
  const cajon = page.getByRole("dialog", { name: /Tu carrito/ });
  await expect(cajon).toBeVisible();
  await cajon.getByRole("button", { name: "Cerrar", exact: true }).click();
  await expect(cajon).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Agregar al carrito" })).toBeEnabled();
  expect(errores).toEqual([]);
});

test("las fuentes llegan en WOFF2 (livianas), no en TTF", async ({ page }) => {
  const fuentes: string[] = [];
  page.on("response", (r) => { if (/\.(woff2?|ttf|otf)(\?|$)/.test(r.url())) fuentes.push(r.url()); });
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  expect(fuentes.length).toBeGreaterThan(0);
  expect(fuentes.every((u) => /\.woff2(\?|$)/.test(u)), fuentes.join("\n")).toBe(true);
});
