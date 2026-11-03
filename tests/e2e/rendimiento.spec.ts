import { formatearPesos } from "@isu/shared";
import { expect, test } from "./base";

/* Lo que cuida la velocidad de la tienda (desde v1.23). */
const API = process.env.API_URL ?? "http://127.0.0.1:4000";

test("prioridad de fotos: en el inicio, ninguna grilla; en una categoría, la primera fila", async ({ page }) => {
  await page.goto("/");
  // Con productos en las grillas (si no, la prueba pasaría sin probar nada).
  expect(await page.locator("main ul li img").count()).toBeGreaterThan(8);
  // Sólo el banner (el LCP) puede pedir prioridad; las grillas están abajo del pliegue.
  expect(await page.locator('main img[fetchpriority="high"]:not(.banner-foto)').count()).toBe(0);
  await page.goto("/mujer");
  expect(await page.locator('main ul li img[fetchpriority="high"]').count()).toBe(2);
});

test("carrito: con +/- seguidos gana la última cotización pedida, aunque llegue antes", async ({ page, request }) => {
  const ficha = await (await request.get(`${API}/v1/productos/remera-oversize-algodon-peinado`)).json() as {
    slug: string; nombre: string; variantes: Array<{ sku: string; stock: number; precio: number }>;
  };
  const v = ficha.variantes.find((x) => x.stock >= 3);
  test.skip(!v, "sin una variante con 3 unidades");
  await page.addInitScript((l) => { if (!localStorage.getItem("isu:carrito")) localStorage.setItem("isu:carrito", JSON.stringify([l])); },
    { sku: v!.sku, cantidad: 1, nombre: ficha.nombre, slug: ficha.slug, color: null, talle: null, precio: v!.precio, foto: null });

  // La cotización de 2 unidades tarda; la de 3 vuelve enseguida.
  let subtotal3 = 0;
  await page.route("**/api/t/carrito", async (ruta) => {
    const cantidad = (ruta.request().postDataJSON() as { items: Array<{ cantidad: number }> }).items[0]?.cantidad;
    const r = await ruta.fetch();
    const c = await r.json() as { subtotal: number };
    if (cantidad === 2) await new Promise((ok) => setTimeout(ok, 2000));
    if (cantidad === 3) subtotal3 = c.subtotal;
    await ruta.fulfill({ response: r, json: c });
  });
  await page.goto("/carrito");
  await expect(page.getByText("Subtotal")).toBeVisible();
  const mas = page.getByRole("button", { name: "Uno más" });
  await mas.click();
  await mas.click();
  await expect.poll(() => subtotal3).toBeGreaterThan(0);
  await page.waitForTimeout(2500); // que llegue también la de 2
  await expect(page.locator("div.flex.justify-between", { hasText: "Subtotal" }).locator("b")).toHaveText(formatearPesos(subtotal3));
});

test("/api/vitals: anota una medida válida y rechaza cualquier otra cosa", async ({ request }) => {
  const ok = await request.post("/api/vitals", { data: JSON.stringify({ nombre: "LCP", valor: 1834.2, nota: "good", ruta: "/mujer" }), headers: { "content-type": "text/plain" } });
  expect(ok.status()).toBe(204);
  for (const malo of [{ nombre: "FID", valor: 1, nota: "good", ruta: "/" }, { nombre: "CLS", valor: -1, nota: "good", ruta: "/" }, { nombre: "INP", valor: 10, nota: "good", ruta: "https://otro.sitio" }, { nombre: "LCP", valor: 1, nota: "<script>", ruta: "/" }]) {
    expect((await request.post("/api/vitals", { data: JSON.stringify(malo) })).status()).toBe(400);
  }
  expect((await request.post("/api/vitals", { data: "x".repeat(2000) })).status()).toBe(413);
});
