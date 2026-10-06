import { expect, test, type Page } from "./base";

/*
 * Catálogo (etapa 1), contra el catálogo de muestra:
 *   pnpm demo:stocker   (Stocker simulado)   +   worker + API + web levantados
 *   pnpm demo:fotos     (fotos de muestra)
 *
 * La prueba de "venta en el local" usa el simulador (STOCKER_SIMULADO_URL):
 * baja el stock en "Stocker" y espera ver el cambio en la tienda sin tocar nada.
 */
const SIM = process.env.STOCKER_SIMULADO_URL ?? "http://127.0.0.1:3900";

function vigilar(page: Page) {
  const errores: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" && !/status of 404/.test(m.text())) errores.push(m.text()); });
  page.on("requestfailed", (r) => { if (!/_rsc=|google/.test(r.url())) errores.push(`falló ${r.url()}: ${r.failure()?.errorText}`); });
  page.on("pageerror", (e) => errores.push(String(e)));
  return errores;
}
const sinScrollHorizontal = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test.describe("grilla", () => {
  test("una categoría muestra sus prendas con foto, precio y transferencia", async ({ page }) => {
    const errores = vigilar(page);
    await page.goto("/mujer");
    const tarjetas = page.locator("main article");
    await expect(tarjetas).toHaveCount(8);
    const primera = tarjetas.first();
    await expect(primera.locator("img").first()).toBeVisible();
    await expect.poll(() => primera.locator("img").first().evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
    await expect(primera.getByText(/con transferencia/)).toBeVisible();
    expect(await sinScrollHorizontal(page)).toBe(true);
    expect(errores).toEqual([]);
  });

  test("filtrar por talle y color, ordenar por precio; queda en la URL", async ({ page }) => {
    await page.goto("/hombre");
    const antes = await page.locator("main article").count();
    await page.getByRole("button", { name: /^Filtrar/ }).click();
    await page.getByRole("button", { name: "46", exact: true }).click();
    await expect(page.locator("main article")).toHaveCount(1);
    await expect(page).toHaveURL(/talle=46/);
    await page.getByRole("button", { name: "Limpiar filtros" }).click();
    await expect(page.locator("main article")).toHaveCount(antes);
    await page.getByLabel(/Ordenar/).selectOption("precio");
    const precios = await page.locator("main article h3 + div p:first-child").allInnerTexts();
    const n = precios.map((t) => Number(t.replace(/\D/g, "")));
    expect(n).toEqual([...n].sort((a, b) => a - b));
    await expect(page).toHaveURL(/orden=precio/);
    // Un enlace con filtros abre ya filtrado.
    await page.goto("/hombre?talle=46");
    await expect(page.locator("main article")).toHaveCount(1);
  });

  test("tocar un color en la tarjeta cambia la foto y lleva a la ficha con ese color", async ({ page }) => {
    await page.goto("/mujer/remeras-y-tops");
    const tarjeta = page.locator("main article", { hasText: "Remera Oversize" });
    const antes = await tarjeta.locator("img").first().getAttribute("src");
    await tarjeta.getByRole("button", { name: /^Blanco/ }).click();
    await expect.poll(() => tarjeta.locator("img").first().getAttribute("src")).not.toBe(antes);
    await tarjeta.getByRole("link", { name: "Remera Oversize Algodón Peinado" }).click();
    await expect(page).toHaveURL(/\/producto\/remera-oversize-algodon-peinado\?color=blanco/);
    await expect(page.getByText("Color: Blanco")).toBeVisible();
  });

  test("el inicio muestra lo nuevo", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Nuevos y en reposición" })).toBeVisible();
    expect(await page.locator("main article").count()).toBeGreaterThan(0);
  });
});

test.describe("ficha de producto", () => {
  test("elegir color y talle arma el mensaje de consulta por WhatsApp", async ({ page }) => {
    const errores = vigilar(page);
    await page.goto("/producto/buzo-canguro-frisa-premium");
    await expect(page.locator("h1")).toHaveText("Buzo Canguro Frisa Premium");
    await page.getByRole("button", { name: /^Gris Melange/ }).click();
    await expect(page.getByText("Color: Gris Melange")).toBeVisible();
    const talle = page.locator("fieldset", { hasText: "Talle" }).getByRole("button", { disabled: false }).first();
    const nombreTalle = (await talle.innerText()).trim();
    await talle.click();
    const boton = page.getByRole("link", { name: "Consultar por WhatsApp" });
    const href = decodeURIComponent((await boton.getAttribute("href")) ?? "");
    expect(href).toContain("wa.me/5491168515444");
    expect(href).toContain("Buzo Canguro Frisa Premium");
    expect(href).toContain("Color: Gris Melange");
    expect(href).toContain(`Talle: ${nombreTalle}`);
    expect(await sinScrollHorizontal(page)).toBe(true);
    expect(errores).toEqual([]);
  });

  test("talles sin stock deshabilitados; la foto cambia con el color", async ({ page }) => {
    await page.goto("/producto/remera-oversize-algodon-peinado");
    const deshabilitados = page.locator("fieldset", { hasText: "Talle" }).locator("button[disabled]");
    expect(await deshabilitados.count()).toBeGreaterThan(0);
    const primera = () => page.locator('section[aria-label="Fotos"] img').first().getAttribute("src");
    const antes = await primera();
    await page.getByRole("button", { name: /^Verde Militar/ }).click();
    await expect.poll(primera).not.toBe(antes);
  });

  test("datos estructurados de producto válidos", async ({ page }) => {
    await page.goto("/producto/jogger-rustico-puno");
    const bloques = await page.locator('script[type="application/ld+json"]').allTextContents();
    // Etapa 7: un ProductGroup con una variante por talle y color, cada una con su oferta.
    const producto = bloques.map((b) => JSON.parse(b)).find((d) => d["@type"] === "ProductGroup");
    expect(producto).toMatchObject({ name: "Jogger Rústico Puño", productGroupID: "ISU-3001", brand: { name: "Isuwaya" } });
    expect(producto.hasVariant.length).toBeGreaterThan(1);
    expect(producto.hasVariant[0].offers).toMatchObject({ priceCurrency: "ARS", itemCondition: "https://schema.org/NewCondition" });
    expect(Number(producto.hasVariant[0].offers.price)).toBeGreaterThan(0);
    expect(producto.image.length).toBeGreaterThan(0);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/producto\/jogger-rustico-puno$/);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /-1200\.webp$/);
  });
});

test.describe("búsqueda", () => {
  test("desde el header, sin tildes, y sin resultados sugiere categorías", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("banner").getByRole("link", { name: "Buscar" }).click();
    await page.getByRole("searchbox").fill("pantalon cargo");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/buscar\?q=pantalon\+cargo/);
    await expect(page.locator("main article")).toHaveCount(1);
    await expect(page.locator("main article")).toContainText("Pantalón Cargo");
    await page.goto("/buscar?q=zzzzz");
    await expect(page.getByText(/No encontramos prendas/)).toBeVisible();
    await expect(page.locator("main").getByRole("link", { name: "Mujer" })).toBeVisible();
  });
  test("lo que se escribe no se ejecuta", async ({ page }) => {
    let alerta = false;
    page.on("dialog", async (d) => { alerta = true; await d.dismiss(); });
    await page.goto(`/buscar?q=${encodeURIComponent('"><img src=x onerror=alert(1)>')}`);
    await expect(page.locator("h1")).toContainText('"><img src=x onerror=alert(1)>');
    expect(alerta).toBe(false);
  });
});

test.describe("404", () => {
  for (const ruta of ["/esto-no-existe", "/mujer/no-existe", "/producto/no-existe", "/a/b/c/d", "/producto/Mal_Slug"]) {
    test(`${ruta} → 404 con salida`, async ({ page }) => {
      const r = await page.goto(ruta);
      expect(r?.status()).toBe(404);
      await expect(page.getByRole("heading", { name: "No encontramos esta página" })).toBeVisible();
      await expect(page.getByRole("searchbox")).toBeVisible();
      const robots = await page.locator('meta[name="robots"]').evaluateAll((ms) => ms.map((m) => m.getAttribute("content")));
      expect(robots.some((r) => /noindex/.test(r ?? ""))).toBe(true);
    });
  }
});

test.describe("tiempo real", () => {
  test("una venta en el local agota la prenda en la tienda sin intervención", async ({ page, request }, info) => {
    test.skip(info.project.name !== "escritorio", "una sola vez: modifica el stock");
    test.setTimeout(60_000);
    // Buscar una variante con stock en la ficha, y venderla toda en "Stocker".
    const detalle = await (await request.get(`${process.env.API_URL ?? "http://127.0.0.1:4000"}/v1/productos/short-biker-lycra`)).json();
    const v = detalle.variantes.find((x: { stock: number }) => x.stock > 0);
    test.skip(!v, "sin stock para vender");
    await page.goto("/producto/short-biker-lycra");
    const r = await request.post(`${SIM}/__vender`, { data: { sku: v.sku, cantidad: 1000 } });
    expect(r.ok()).toBe(true);
    // Stocker avisa → worker pide el stock → API y página se regeneran.
    await expect.poll(async () => {
      await page.reload();
      const nombreColor = detalle.colores.find((c: { clave: string }) => c.clave === v.color).nombre;
      const colorBtn = page.locator("fieldset", { hasText: "Color" }).getByRole("button", { name: nombreColor });
      await colorBtn.click();
      return page.locator("fieldset", { hasText: "Talle" }).getByRole("button", { name: v.talle, exact: true }).isDisabled();
    }, { timeout: 30_000, intervals: [1000] }).toBe(true);
  });
});
