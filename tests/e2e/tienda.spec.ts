import { expect, test, type Page } from "./base";

/* Junta los errores de consola y de página de cada prueba: ninguna pantalla puede tener. */
function vigilar(page: Page) {
  const errores: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); });
  page.on("pageerror", (e) => errores.push(String(e)));
  return errores;
}
const sinScrollHorizontal = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test.describe("inicio", () => {
  test("carga completa, sin errores y sin scroll de costado", async ({ page }) => {
    const errores = vigilar(page);
    const r = await page.goto("/");
    expect(r?.status()).toBe(200);
    await expect(page).toHaveTitle(/Isuwaya/);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("html")).toHaveAttribute("lang", "es-AR");
    await expect(page.getByText(/OFF con transferencia/).first()).toBeVisible();
    for (const c of ["Hombre", "Mujer", "Niños"]) await expect(page.getByRole("link", { name: c }).first()).toBeVisible();
    expect(await sinScrollHorizontal(page)).toBe(true);
    expect(errores).toEqual([]);
  });

  test("botón flotante de WhatsApp al número de trabajo", async ({ page }) => {
    await page.goto("/");
    const wa = page.getByRole("link", { name: "Escribinos por WhatsApp" });
    await expect(wa).toBeVisible();
    await expect(wa).toHaveAttribute("href", /^https:\/\/wa\.me\/5491168515444\?text=/);
    await expect(wa).toHaveAttribute("rel", /noopener/);
  });

  test("botón de arrepentimiento a la vista desde el inicio (Res. 424/2020)", async ({ page }) => {
    await page.goto("/");
    const link = page.getByRole("link", { name: "Botón de arrepentimiento" });
    await link.scrollIntoViewIfNeeded();
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/arrepentimiento$/);
    await expect(page.getByText("10 días corridos").first()).toBeVisible();
  });

  test("todas las imágenes tienen alt y el salto al contenido funciona", async ({ page }) => {
    await page.goto("/");
    expect(await page.locator("img:not([alt])").count()).toBe(0);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Saltar al contenido" })).toBeFocused();
  });
});

test.describe("navegación", () => {
  test("escritorio: el menú despliega subcategorías y lleva a la página", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "sólo escritorio");
    await page.goto("/");
    await page.getByRole("navigation", { name: "Categorías" }).getByRole("link", { name: "Mujer", exact: true }).hover();
    await page.getByRole("link", { name: "Remeras y tops" }).first().click();
    await expect(page).toHaveURL(/\/mujer\/remeras-y-tops$/);
    await expect(page.locator("h1")).toContainText("Remeras y tops");
    await expect(page.getByRole("navigation", { name: "Estás en" })).toContainText("Mujer");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/mujer\/remeras-y-tops$/);
  });

  test("celular: el menú lateral ocupa la pantalla, navega y se cierra con Escape", async ({ page, isMobile }) => {
    test.skip(!isMobile, "sólo celular");
    await page.goto("/");
    const abrir = page.getByRole("button", { name: "Abrir menú" });
    await abrir.click();
    const menu = page.getByRole("dialog", { name: "Menú" });
    await expect(menu).toBeVisible();
    const caja = await menu.boundingBox();
    expect(caja!.height).toBeGreaterThan(600); // no queda atrapado dentro del header
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(abrir).toBeFocused();
    await abrir.click();
    await menu.getByRole("link", { name: "Pantalones", exact: true }).first().click();
    await expect(page).toHaveURL(/\/hombre\/pantalones$/);
  });

  test("404 con página propia", async ({ page }) => {
    const r = await page.goto("/esto-no-existe/tampoco");
    expect(r?.status()).toBe(404);
    await expect(page.getByText("No encontramos esta página")).toBeVisible();
  });
});

test.describe("legales", () => {
  for (const [ruta, titulo, texto] of [
    ["/terminos", "Términos y condiciones", "Ley 24.240"],
    ["/devoluciones", "Cambios y devoluciones", "30 días corridos"],
    ["/privacidad", "Política de privacidad", "AGENCIA DE ACCESO A LA INFORMACIÓN PÚBLICA"],
    ["/arrepentimiento", "Botón de arrepentimiento", "código de trámite"],
  ] as const) {
    test(titulo, async ({ page }) => {
      const errores = vigilar(page);
      await page.goto(ruta);
      await expect(page.locator("h1")).toHaveText(titulo);
      await expect(page.getByText(texto).first()).toBeVisible();
      await expect(page.locator("body")).not.toContainText(/ruthtintaya|Isuwaya Mayorista|se encuentra en , \./);
      expect(errores).toEqual([]);
    });
  }
});

test.describe("SEO", () => {
  test("robots y sitemap", async ({ request }) => {
    const robots = await (await request.get("/robots.txt")).text();
    expect(robots).toMatch(/Sitemap: .*\/sitemap\.xml/);
    expect(robots).toMatch(/Disallow: \/checkout/);
    const sitemap = await (await request.get("/sitemap.xml")).text();
    expect(sitemap).toContain("/mujer/remeras-y-tops</loc>");
    expect(sitemap).toContain("/devoluciones</loc>");
  });

  test("metadatos, Open Graph y datos estructurados válidos", async ({ page }) => {
    await page.goto("/mujer");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /.{50,}/);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /opengraph-image/);
    const bloques = await page.locator('script[type="application/ld+json"]').allTextContents();
    const tipos = bloques.map((b) => JSON.parse(b)["@type"]);
    expect(tipos).toContain("ClothingStore");
    expect(tipos).toContain("BreadcrumbList");
  });
});

test.describe("cabeceras de seguridad", () => {
  test("en la página", async ({ request }) => {
    const r = await request.get("/");
    const h = r.headers();
    expect(h["content-security-policy"]).toMatch(/frame-ancestors 'none'/);
    expect(h["content-security-policy"]).toMatch(/object-src 'none'/);
    // Next en modo desarrollo necesita eval; en producción no puede estar.
    test.skip(/unsafe-eval/.test(h["content-security-policy"] ?? "") && !process.env.CI, "modo desarrollo (pnpm dev): esta prueba es para el build de producción");
    expect(h["content-security-policy"]).not.toMatch(/unsafe-eval/);
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-powered-by"]).toBeUndefined();
  });
});
