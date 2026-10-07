import { expect, test, type Page } from "./base";

/*
 * Etapa 11 en un navegador real:
 *
 *   · la calle del checkout con sugerencias (Google, simulado): elegir una
 *     completa número, código postal, localidad y provincia;
 *   · la revisión con Georef (simulado): «¿Tu dirección es …?», altura que no
 *     existe; nunca frena la compra;
 *   · la clave de Google no llega al navegador ni el navegador habla con Google;
 *   · el aviso del carrito: si las que quedan de una variante ya están dentro
 *     de un pack del carrito, sumarla suelta no la agrega y explica por qué
 *     (ventana al centro en la compu y la notebook, hoja desde abajo en el celular).
 */
const API = process.env.API_URL ?? "http://127.0.0.1:4000";
const PACK = "remera-basica-cuello-redondo";
const escapar = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function vigilar(page: Page) {
  const errores: string[] = [];
  page.on("pageerror", (e) => errores.push(e.message));
  return errores;
}

async function alCheckout(page: Page) {
  await page.goto("/producto/remera-oversize-algodon-peinado");
  await page.locator("fieldset", { hasText: "Talle" }).getByRole("button", { disabled: false }).first().click();
  await page.getByRole("button", { name: "Agregar al carrito" }).click();
  await page.getByRole("dialog").getByRole("link", { name: /^Pagar con transferencia/ }).click();
  await page.waitForURL(/\/checkout/);
  await page.locator("html[data-hidratado]").waitFor({ state: "attached" });
}

test.describe("dirección del checkout", () => {
  test("sugerencias de Google: elegir una completa la dirección y Georef la confirma", async ({ page }) => {
    const errores = vigilar(page);
    // El navegador sólo habla con la tienda: nunca con Google ni Georef (ni con su simulador).
    const afuera: string[] = [];
    page.on("request", (r) => { if (/googleapis|datos\.gob\.ar|:3940\//.test(r.url())) afuera.push(r.url()); });
    await alCheckout(page);

    const calle = page.getByRole("combobox", { name: "Calle" });
    await calle.fill("Thames 1500");
    const lista = page.getByRole("listbox", { name: "Direcciones sugeridas" });
    await expect(lista.getByRole("option", { name: /Thames 1500/ })).toBeVisible({ timeout: 10_000 });
    await expect(lista.getByText("Google Maps")).toBeVisible();
    // Con el teclado: flecha abajo y Enter.
    await calle.press("ArrowDown");
    await expect(lista.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
    await calle.press("Enter");
    await expect(lista).toBeHidden();
    await expect(calle).toHaveValue("Thames");
    await expect(page.getByLabel("Número", { exact: true })).toHaveValue("1500");
    await expect(page.getByLabel("Código postal")).toHaveValue("1414");
    await expect(page.getByLabel("Localidad")).toHaveValue("Palermo");
    await expect(page.getByLabel("Provincia")).toHaveValue("CABA");
    await expect(page.getByText("✓ Encontramos tu dirección.")).toBeVisible({ timeout: 10_000 });

    expect(afuera).toEqual([]);
    expect(await page.content()).not.toContain("simulado-google-places");
    expect(errores).toEqual([]);
  });

  test("Georef: propone la calle bien escrita, avisa una altura que no existe y no frena la compra", async ({ page }) => {
    const errores = vigilar(page);
    await alCheckout(page);
    await page.getByRole("combobox", { name: "Calle" }).fill("Corientes");
    await page.getByLabel("Número", { exact: true }).fill("1234");
    await page.getByLabel("Código postal").fill("1043");
    const propuesta = page.getByRole("status").filter({ hasText: "¿Tu dirección es" });
    await expect(propuesta).toContainText("Av. Corrientes 1234, CABA", { timeout: 10_000 });
    await propuesta.getByRole("button", { name: "Sí, usar esta" }).click();
    await expect(page.getByRole("combobox", { name: "Calle" })).toHaveValue("Av. Corrientes");
    await expect(page.getByText("✓ Encontramos tu dirección.")).toBeVisible({ timeout: 10_000 });

    // Una altura que no existe: avisa, pero se puede seguir.
    await page.getByLabel("Número", { exact: true }).fill("99999");
    await expect(page.getByText(/No encontramos la altura 99999 en esa calle/)).toBeVisible({ timeout: 10_000 });
    // «Santa Fe» y «Av. Santa Fe» son la misma calle: no hay nada que proponer.
    await page.getByRole("combobox", { name: "Calle" }).fill("Santa Fe");
    await page.getByLabel("Número", { exact: true }).fill("1200");
    await expect(page.getByText("✓ Encontramos tu dirección.")).toBeVisible({ timeout: 10_000 });
    // «No, está bien como la escribí» descarta la propuesta y deja lo escrito.
    await page.getByRole("combobox", { name: "Calle" }).fill("Santafe");
    const otra = page.getByRole("status").filter({ hasText: "¿Tu dirección es" });
    await expect(otra).toContainText("Av. Santa Fe 1200", { timeout: 10_000 });
    await otra.getByRole("button", { name: "No, está bien como la escribí" }).click();
    await expect(otra).toBeHidden();
    await expect(page.getByRole("combobox", { name: "Calle" })).toHaveValue("Santafe");
    await expect(page.getByRole("button", { name: /Confirmar compra/ })).toBeEnabled();
    expect(errores).toEqual([]);
  });
});

test.describe("aviso del carrito: la variante ya está en un pack", () => {
  test("sumarla suelta no la agrega y explica qué pasa (compu, notebook y celular)", async ({ page, request }, info) => {
    const errores = vigilar(page);
    const ficha = await (await request.get(`${API}/v1/productos/${PACK}`)).json() as {
      variantes: Array<{ sku: string; color: string | null; talle: string | null; stock: number }>; colores: Array<{ clave: string; nombre: string }>;
    };
    const config = await (await request.get(`${API}/v1/config`)).json() as { packs: { minimo: number; maximo: number } };
    // Una variante con stock para un pack entero de ella sola (el pack se lleva todas), con el stock exacto a la vista (menos de 10).
    const v = ficha.variantes.filter((x) => x.stock >= config.packs.minimo && x.stock <= config.packs.maximo && x.stock < 10).sort((a, b) => a.stock - b.stock)[0];
    test.skip(!v, "no hay una variante con stock entre el mínimo y el máximo del pack");
    const n = v!.stock;
    const color = ficha.colores.find((c) => c.clave === v!.color);

    // 1) El pack con todas las que quedan de esa variante.
    await page.goto(`/producto/pack-x${n}-${PACK}`);
    const p1 = page.locator("#prenda-1");
    if (v!.talle) await p1.getByRole("group", { name: /Talle/ }).getByRole("button", { name: new RegExp(`^${escapar(v!.talle)}$`) }).click();
    if (color && ficha.colores.length > 1) await p1.getByRole("group", { name: /Color/ }).getByRole("button", { name: color.nombre, exact: true }).click();
    if (n > 1) await page.getByRole("button", { name: "Copiar la prenda 1 a todas" }).click();
    await page.getByRole("button", { name: `Agregar pack x${n} al carrito` }).click();
    const cajon = page.getByRole("dialog");
    await expect(cajon.getByText(/📦 Pack/)).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("Escape");

    // 2) La misma variante suelta, desde su ficha.
    await page.goto(`/producto/${PACK}`);
    if (color && ficha.colores.length > 1) await page.getByRole("button", { name: new RegExp(`^${escapar(color.nombre)}`) }).first().click();
    if (v!.talle) await page.locator("fieldset", { hasText: "Talle" }).getByRole("button", { name: new RegExp(`^${escapar(v!.talle)}`) }).first().click();
    await page.getByRole("button", { name: "Agregar al carrito" }).click();
    const aviso = page.getByRole("alertdialog", { name: "Esa prenda ya está en un pack de tu carrito" });
    await expect(aviso).toBeVisible();
    await expect(aviso).toContainText(`Quedan ${n} de esta prenda`);
    await expect(aviso.getByRole("listitem").filter({ hasText: `En tu Pack x${n}` })).toContainText(String(n));
    await expect(aviso).toContainText("Mientras esté dentro del pack, no la podés sumar suelta");
    // El foco va al botón principal.
    await expect(aviso.getByRole("button", { name: "Ver mi carrito" })).toBeFocused();

    // Responsive: en el celular sube desde abajo; en la compu y la notebook, al centro y entero en pantalla.
    const comoSeVe = async () => {
      const caja = (await aviso.boundingBox())!;
      const vp = page.viewportSize()!;
      expect(caja.y).toBeGreaterThanOrEqual(0);
      expect(caja.y + caja.height).toBeLessThanOrEqual(vp.height + 1);
      if (vp.width < 640) {
        expect(Math.abs(caja.y + caja.height - vp.height)).toBeLessThanOrEqual(2);
        expect(caja.width).toBeGreaterThan(vp.width - 2);
      } else {
        expect(Math.abs(caja.x + caja.width / 2 - vp.width / 2)).toBeLessThanOrEqual(2);
        expect(Math.abs(caja.y + caja.height / 2 - vp.height / 2)).toBeLessThanOrEqual(30);
      }
    };
    await comoSeVe();
    if (info.project.name === "escritorio") {
      await page.setViewportSize({ width: 1366, height: 768 }); // notebook
      await comoSeVe();
      await page.setViewportSize({ width: 1440, height: 900 });
    }

    // Escape cierra; no se agregó nada (el carrito sigue con el pack solo).
    await page.keyboard.press("Escape");
    await expect(aviso).toBeHidden();
    await expect(page.getByRole("button", { name: new RegExp(`Carrito, ${n} prendas`) })).toBeVisible();
    // «Comprar ahora» tampoco la agrega ni se va al checkout.
    await page.getByRole("button", { name: "Comprar ahora" }).click();
    await expect(aviso).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/producto/${PACK}$`));
    // «Ver mi carrito»: el carrito con el pack, sin la suelta.
    await aviso.getByRole("button", { name: "Ver mi carrito" }).click();
    await expect(aviso).toBeHidden();
    await expect(cajon.locator("ul.divide-y > li")).toHaveCount(1);
    await expect(cajon.getByText(/📦 Pack/)).toBeVisible();
    expect(errores).toEqual([]);
  });
});
