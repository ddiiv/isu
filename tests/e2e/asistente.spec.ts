import { expect, test, type Page } from "./base";

/*
 * Etapa 5: el asistente de la tienda en un navegador real (escritorio y
 * celular). Necesita los servicios levantados con los simuladores
 * (transportes para cotizar el envío) y el ajuste "chatbot" prendido.
 */
function vigilar(page: Page) {
  const errores: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); });
  page.on("pageerror", (e) => errores.push(String(e)));
  return errores;
}
async function abrir(page: Page) {
  await page.getByRole("button", { name: "Abrir el asistente de la tienda" }).click();
  const panel = page.getByRole("dialog", { name: "Asistente Isuwaya" });
  await expect(panel).toBeVisible();
  return panel;
}
async function preguntar(page: Page, texto: string) {
  await page.getByLabel("Tu consulta").fill(texto);
  await page.getByRole("button", { name: "Enviar" }).click();
}

test.describe("asistente", () => {
  test("se abre, saluda, responde una pregunta frecuente con su botón y se cierra con Escape", async ({ page, isMobile }) => {
    const errores = vigilar(page);
    await page.goto("/");
    const panel = await abrir(page);
    await expect(panel.getByText(/Soy el asistente de Isuwaya/)).toBeVisible();
    await expect(page.getByLabel("Tu consulta")).toBeFocused();
    if (isMobile) {
      // En el celular ocupa toda la pantalla.
      const caja = await panel.boundingBox();
      expect(caja!.width).toBeGreaterThanOrEqual(page.viewportSize()!.width - 1);
    }
    await preguntar(page, "me llegó fallada una remera");
    const log = panel.getByRole("log");
    await expect(log.getByText(/con una foto y el número de pedido/)).toBeVisible();
    await expect(log.getByRole("link", { name: "Cambios y devoluciones" })).toHaveAttribute("href", "/devoluciones");
    await log.getByRole("button", { name: "Sí", exact: true }).click();
    await expect(log.getByText("¡Gracias!")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(page.getByRole("button", { name: "Abrir el asistente de la tienda" })).toBeFocused();
    expect(errores).toEqual([]);
  });

  test("costo de envío: pide el código postal y cotiza con los transportes", async ({ page }) => {
    await page.goto("/");
    const panel = await abrir(page);
    await panel.getByRole("button", { name: "¿Cuánto sale el envío?" }).click();
    await expect(page.getByLabel("Tu consulta")).toHaveAttribute("placeholder", /código postal/);
    await preguntar(page, "1406");
    // Muestra las 5 más baratas: antes de las 14 h entra "Cabify · llega hoy" y el domicilio de Correo puede quedar afuera.
    await expect(panel.getByText(/Correo Argentino a (domicilio|sucursal)/)).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByText(/Para una prenda al código postal 1406/)).toBeVisible();
  });

  test("dónde está mi pedido: formulario con número y email; con datos equivocados no dice nada", async ({ page }) => {
    await page.goto("/");
    const panel = await abrir(page);
    await preguntar(page, "donde esta mi pedido?");
    await panel.getByLabel("Número de pedido").fill("ISU-999999");
    await panel.getByLabel("Email de la compra").fill("nadie@test.com");
    await panel.getByRole("button", { name: "Buscar mi pedido" }).click();
    await expect(panel.getByText(/No encontré un pedido con esos datos/)).toBeVisible();
  });

  test("productos: muestra prendas con enlace a su ficha", async ({ page }) => {
    await page.goto("/");
    const panel = await abrir(page);
    await preguntar(page, "tienen joggers?");
    const prenda = panel.getByRole("link", { name: /Jogger/ }).first();
    await expect(prenda).toBeVisible();
    await expect(prenda).toHaveAttribute("href", /^\/producto\//);
  });

  test("la charla sigue al cambiar de página y WhatsApp queda a mano", async ({ page }) => {
    await page.goto("/");
    const panel = await abrir(page);
    await preguntar(page, "tienen cuotas sin interes?");
    await expect(panel.getByText(/cuotas sin interés con tarjeta/)).toBeVisible();
    await page.goto("/devoluciones");
    const otra = await abrir(page);
    await expect(otra.getByText(/cuotas sin interés con tarjeta/)).toBeVisible();
    await expect(otra.getByRole("link", { name: "Escribinos por WhatsApp" })).toHaveAttribute("href", /^https:\/\/wa\.me\/\d+\?text=/);
  });

  test("en una ficha, «¿qué talle soy?» abre la guía de talles de esa prenda", async ({ page }) => {
    await page.goto("/producto/remera-oversize-algodon-peinado");
    const panel = await abrir(page);
    await preguntar(page, "que talle soy?");
    await panel.getByRole("button", { name: "Guía de talles de esta prenda" }).click();
    await expect(page.getByRole("dialog", { name: "Guía de talles" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "¿Cuál es mi talle?" })).toHaveAttribute("aria-selected", "true");
  });

  test("un texto con HTML se muestra como texto (no se interpreta)", async ({ page }) => {
    await page.goto("/");
    const panel = await abrir(page);
    let alerta = false;
    page.on("dialog", async (d) => { alerta = true; await d.dismiss(); });
    await preguntar(page, "<img src=x onerror=alert(1)>");
    await expect(panel.getByText("<img src=x onerror=alert(1)>")).toBeVisible();
    await expect(panel.getByRole("log").locator("img[src=x]")).toHaveCount(0);
    expect(alerta).toBe(false);
  });
});
