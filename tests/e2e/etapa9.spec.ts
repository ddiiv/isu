import { expect, test, type Page } from "./base";

/*
 * Etapa 9 en un navegador real:
 *
 *   · packs de 2 a 10 armados sobre la prenda padre: nunca más de lo que hay
 *     en stock, ni de una variante más de las que quedan;
 *   · Packs y Liquidación en el menú, divididas por Hombre, Mujer y Niños;
 *   · el menú del celular: al tocar una categoría, sus subcategorías y 1 o 2
 *     fotos de prendas que la representan;
 *   · la barra de envío gratis en la ficha.
 *
 * Usa los datos de muestra de pnpm demo:backoffice (packs y liquidación de invierno).
 */
const API = process.env.API_URL ?? "http://127.0.0.1:4000";
const PACK = "remera-basica-cuello-redondo";

function vigilar(page: Page) {
  const errores: string[] = [];
  page.on("pageerror", (e) => errores.push(e.message));
  return errores;
}
const escapar = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// "$ 80.000" (el espacio de Intl puede ser uno duro).
const pesos = (c: number) => new RegExp(`\\$\\s?${escapar(Math.round(c / 100).toLocaleString("es-AR"))}`);

test.describe("packs de 2 a 10 con el stock de la prenda", () => {
  test("no ofrece más de lo que hay, y una variante deja de ofrecerse cuando las otras prendas se llevaron todas", async ({ page, request }, info) => {
    test.skip(info.project.name === "celular", "el mismo flujo; alcanza en escritorio");
    const errores = vigilar(page);
    const ficha = await (await request.get(`${API}/v1/productos/${PACK}`)).json() as {
      variantes: Array<{ sku: string; color: string | null; talle: string | null; stock: number }>; colores: Array<{ clave: string; nombre: string }>;
    };
    const total = ficha.variantes.reduce((a, v) => a + v.stock, 0);
    const tope = Math.min(10, total);
    // Pedir 10: queda la cantidad que hay (o 10).
    await page.goto(`/producto/pack-x10-${PACK}`);
    await expect(page).toHaveURL(new RegExp(`/producto/pack-x${tope}-${PACK}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(new RegExp(`^Pack x${tope} `));
    for (let k = 2; k <= 10; k++) {
      const b = page.getByRole("button", { name: new RegExp(`^${k} unidades`) });
      if (k > tope) await expect(b).toBeDisabled(); else await expect(b).toBeEnabled();
    }
    // Una dirección fuera del rango va a la más cercana.
    await page.goto(`/producto/pack-x15-${PACK}`);
    await expect(page).toHaveURL(new RegExp(`/producto/pack-x${tope}-${PACK}$`));

    // La variante con menos stock: con una prenda más que su stock, "copiar a todas" no alcanza.
    const v = ficha.variantes.filter((x) => x.stock > 0).sort((a, b) => a.stock - b.stock)[0]!;
    const n = v.stock + 1;
    test.skip(n > tope || n < 2, `la variante con menos stock tiene ${v.stock}: no sirve para esta prueba`);
    await page.getByRole("button", { name: new RegExp(`^${n} unidades`) }).click();
    await expect(page).toHaveURL(new RegExp(`/producto/pack-x${n}-${PACK}$`));
    const p1 = page.locator("#prenda-1");
    if (v.talle) await p1.getByRole("group", { name: /Talle/ }).getByRole("button", { name: new RegExp(`^${escapar(v.talle)}$`) }).click();
    const color = ficha.colores.find((c) => c.clave === v.color);
    if (color && ficha.colores.length > 1) await p1.getByRole("group", { name: /Color/ }).getByRole("button", { name: color.nombre, exact: true }).click();
    await expect(p1.getByText(/^✓/)).toBeVisible();
    await page.getByRole("button", { name: "Copiar la prenda 1 a todas" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "No alcanzan para todas" })).toBeVisible();
    // La última quedó sin elegir y esa variante ya no se ofrece ahí.
    const ultima = page.locator(`#prenda-${n}`);
    await expect(ultima.getByText(/^✓/)).toHaveCount(0);
    await expect(ultima.getByText("No quedan más iguales a la anterior")).toBeVisible();
    if (v.talle) {
      const talle = ultima.getByRole("group", { name: /Talle/ }).getByRole("button", { name: new RegExp(`^${escapar(v.talle)}( \\(no quedan más\\))?$`) });
      // Si ese talle no tiene otro color con stock, se apaga entero; si tiene, se apaga el color.
      if (ficha.variantes.some((x) => x.talle === v.talle && x.sku !== v.sku && x.stock > 0)) {
        await talle.click();
        if (color && ficha.colores.length > 1) await expect(ultima.getByRole("button", { name: `${color.nombre} (no quedan más)` })).toBeDisabled();
      } else await expect(talle).toBeDisabled();
    }
    expect(errores).toEqual([]);
  });
});

test.describe("Packs y Liquidación por categoría", () => {
  test("Packs: en el menú y en su página, divididos en Hombre, Mujer y Niños", async ({ page }, info) => {
    const errores = vigilar(page);
    if (info.project.name === "escritorio") {
      await page.goto("/");
      await page.getByRole("navigation", { name: "Categorías" }).getByRole("link", { name: "Packs", exact: true }).hover();
      await expect(page.getByRole("link", { name: "Packs Niños", exact: true })).toBeVisible();
    }
    await page.goto("/packs");
    for (const c of ["Hombre", "Mujer", "Niños"]) await expect(page.getByRole("heading", { name: `Packs ${c}` })).toBeVisible();
    await page.getByRole("navigation", { name: /Packs por categoría/ }).getByRole("link", { name: "Niños" }).click();
    await expect(page).toHaveURL(/\/packs\/ninos$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Packs Niños");
    await expect(page.locator('a[href="/producto/pack-x2-remera-estampada-ninos"]').first()).toBeAttached();
    await expect(page.locator(`a[href="/producto/pack-x2-${PACK}"]`)).toHaveCount(0);
    expect(errores).toEqual([]);
  });

  test("Liquidación: sección propia, por categoría, con la etiqueta y el precio rebajado", async ({ page }, info) => {
    const errores = vigilar(page);
    await page.goto("/liquidacion");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Liquidación");
    await expect(page.getByRole("heading", { name: "Liquidación Niños" })).toBeVisible();
    const tarjeta = page.locator("article", { has: page.getByRole("link", { name: "Campera Inflable Niños" }) }).first();
    await expect(tarjeta.getByText("Liquidación", { exact: true })).toBeVisible();
    await expect(tarjeta.getByText("-35%").first()).toBeVisible();
    await page.goto("/liquidacion/ninos");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Liquidación Niños");
    await expect(page.getByRole("link", { name: "Buzo Crop Friza" })).toHaveCount(0);
    // La ficha lo dice.
    await page.getByRole("link", { name: "Campera Inflable Niños" }).first().click();
    await expect(page).toHaveURL(/\/producto\/campera-inflable-ninos/);
    await expect(page.getByRole("main").getByRole("link", { name: "Liquidación", exact: true })).toBeVisible();
    // En el menú de la compu.
    if (info.project.name === "escritorio") await expect(page.getByRole("navigation", { name: "Categorías" }).getByRole("link", { name: "Liquidación", exact: true })).toBeVisible();
    expect(errores).toEqual([]);
  });
});

test.describe("menú del celular", () => {
  test("al tocar una categoría: sus subcategorías y 1 o 2 fotos; Packs por categoría; Escape vuelve y cierra", async ({ page }, info) => {
    test.skip(info.project.name !== "celular", "el menú por niveles es del celular");
    const errores = vigilar(page);
    await page.goto("/");
    await page.getByRole("navigation", { name: "Accesos" }).getByRole("button", { name: "Mujer" }).click();
    const menu = page.getByRole("dialog", { name: "Menú" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("link", { name: "Ver todo Mujer" })).toBeVisible();
    await expect(menu.getByRole("link", { name: "Remeras y tops" })).toBeVisible();
    await expect(menu.getByRole("link", { name: "📦 Packs Mujer" })).toBeVisible();
    const fotos = menu.getByRole("list", { name: "Prendas de Mujer" }).getByRole("listitem");
    expect(await fotos.count()).toBeGreaterThanOrEqual(1);
    expect(await fotos.count()).toBeLessThanOrEqual(2);
    await expect(fotos.first().getByRole("img")).toBeVisible();
    // Volver al menú y entrar a Packs.
    await menu.getByRole("button", { name: /Menú/ }).click();
    await menu.getByRole("button", { name: /^Packs/ }).click();
    await expect(menu.getByRole("link", { name: "Packs Hombre" })).toBeVisible();
    // Escape: primero vuelve, después cierra.
    await page.keyboard.press("Escape");
    await expect(menu.getByRole("link", { name: "Nuevos" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    // Una subcategoría lleva a su página.
    await page.getByRole("navigation", { name: "Accesos" }).getByRole("button", { name: "Hombre" }).click();
    await menu.getByRole("link", { name: "Remeras", exact: true }).click();
    await expect(page).toHaveURL(/\/hombre\/remeras$/);
    expect(errores).toEqual([]);
  });
});

test.describe("envío gratis en la ficha", () => {
  test("dice cuánto falta y se acorta al agregar", async ({ page, request }, info) => {
    test.skip(info.project.name === "celular", "el mismo flujo; alcanza en escritorio");
    const errores = vigilar(page);
    const config = await (await request.get(`${API}/v1/config`)).json() as { envioGratisDesde: number | null };
    test.skip(!config.envioGratisDesde, "sin envío gratis configurado");
    await page.goto("/producto/buzo-canguro-frisa-premium");
    await page.locator("html[data-hidratado]").waitFor({ state: "attached" });
    const barra = page.getByRole("progressbar", { name: "Para el envío gratis" });
    const caja = page.locator("div", { has: barra }).last();
    await expect(caja).toContainText(new RegExp(`Te faltan ${pesos(config.envioGratisDesde!).source} para el envío gratis`));
    await expect(caja).toContainText(new RegExp(`Envío gratis desde ${pesos(config.envioGratisDesde!).source}`));
    await expect(barra).toHaveAttribute("aria-valuenow", "0");
    await page.locator("fieldset", { hasText: "Talle" }).getByRole("button", { disabled: false }).first().click();
    await page.getByRole("button", { name: "Agregar al carrito" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    // Con la prenda en el carrito falta menos: la barra avanza.
    await expect.poll(async () => Number(await barra.getAttribute("aria-valuenow")), { timeout: 15_000 }).toBeGreaterThan(0);
    expect(errores).toEqual([]);
  });
});
