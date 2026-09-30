import { expect, test, type Page } from "./base";

/*
 * Etapa 2 en un navegador real: carrito, checkout, pagos y cuenta.
 * Necesita: pnpm demo:stocker, pnpm demo:mercadopago, pnpm dev (o los
 * servicios compilados) y los ajustes de muestra (pnpm demo:fotos).
 * PAGOS_TOKEN tiene que ser el mismo que usa la API.
 */
const API = process.env.API_URL ?? "http://127.0.0.1:4000";
const PAGOS = process.env.PAGOS_TOKEN ?? "solo-desarrollo-pagos-cambiar-en-produccion";

function vigilar(page: Page) {
  const errores: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); });
  page.on("pageerror", (e) => errores.push(String(e)));
  return errores;
}
/*
 * Agrega una prenda con stock de sobra: recorre colores y talles hasta uno
 * que no diga "¡Últimas…!" (las corridas repetidas van gastando el stock de
 * muestra, y algunas pruebas necesitan poder sumar una unidad más).
 */
async function agregar(page: Page, slug: string) {
  await page.goto(`/producto/${slug}`);
  const colores = page.locator("fieldset", { hasText: "Color" }).getByRole("button");
  const nColores = Math.max(1, await colores.count());
  for (let c = 0; c < nColores; c++) {
    if (await colores.count()) await colores.nth(c).click();
    const talles = page.locator("fieldset", { hasText: "Talle" }).getByRole("button", { disabled: false });
    for (let t = 0; t < await talles.count(); t++) {
      await talles.nth(t).click();
      if (!(await page.getByText(/¡Últim/).isVisible())) {
        await page.getByRole("button", { name: "Agregar al carrito" }).click();
        await expect(page.getByRole("dialog")).toBeVisible();
        return;
      }
    }
  }
  throw new Error(`${slug}: no queda ningún talle con stock de sobra (reiniciá pnpm demo:stocker)`);
}
async function datos(page: Page, email: string) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Nombre", { exact: true }).fill("Ana");
  await page.getByLabel("Apellido").fill("Prueba");
  await page.getByLabel("Celular").fill("11 5555 1234");
  await page.getByLabel("DNI o CUIT").fill("30111222");
}
const email = (n: string, info: { project: { name: string } }) => `e2e-${n}-${info.project.name}-${Date.now()}@test.com`;

test.describe("carrito", () => {
  test("agregar abre el carrito lateral, suma y persiste al recargar", async ({ page }) => {
    const errores = vigilar(page);
    await agregar(page, "remera-oversize-algodon-peinado");
    await expect(page.getByRole("dialog")).toContainText("Remera Oversize Algodón Peinado");
    await expect(page.getByRole("dialog")).toContainText(/para el envío gratis|envío gratis/);
    await page.getByRole("button", { name: "Uno más" }).click();
    await expect(page.getByRole("button", { name: /Carrito, 2 prendas/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await page.reload();
    await expect(page.getByRole("button", { name: /Carrito, 2 prendas/ })).toBeVisible();
    await page.getByRole("button", { name: /Carrito, 2 prendas/ }).click();
    await page.getByRole("button", { name: "Quitar" }).click();
    await expect(page.getByRole("dialog")).toContainText("Tu carrito está vacío");
    expect(errores).toEqual([]);
  });

  test("sin elegir talle no agrega y avisa", async ({ page }) => {
    await page.goto("/producto/buzo-canguro-frisa-premium");
    await page.getByRole("button", { name: "Agregar al carrito" }).click();
    await expect(page.getByText("Elegí un talle para agregarlo.")).toBeVisible();
    await expect(page.getByRole("dialog")).toBeHidden();
  });
});

test.describe("checkout", () => {
  test("transferencia: 20% OFF, datos para transferir y pantalla que se actualiza sola al acreditarse", async ({ page, request }, info) => {
    const errores = vigilar(page);
    await agregar(page, "remera-oversize-algodon-peinado");
    await page.getByRole("link", { name: "Finalizar compra" }).click();
    await datos(page, email("transf", info));
    await page.getByText("Retiro en el local").click();
    await page.getByText("Transferencia bancaria").click();
    await expect(page.getByText("Descuento transferencia")).toBeVisible();
    await page.getByRole("button", { name: "Confirmar compra" }).click();
    // Sin aceptar términos no pasa.
    await expect(page.getByText(/Tenés que aceptar los términos/)).toBeVisible();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Confirmar compra" }).click();
    await page.waitForURL(/\/pedido\/ISU-\d+/);
    const numero = page.url().match(/ISU-\d+/)![0];
    await expect(page.getByRole("heading", { name: "Esperamos tu transferencia" })).toBeVisible();
    await expect(page.getByText("ISUWAYA.PRUEBA")).toBeVisible();
    // El carrito quedó vacío.
    await expect(page.getByRole("button", { name: "Carrito, vacío" })).toBeVisible();
    const r = await request.post(`${API}/v1/pagos/registrar`, {
      headers: { authorization: `Bearer ${PAGOS}` },
      data: { pedido: numero, medio: "transferencia", monto: 99_999_999, referencia: `E2E-${Date.now()}-${info.project.name}`, quien: "e2e" },
    });
    expect(r.ok()).toBe(true);
    await expect(page.getByRole("heading", { name: "¡Pago confirmado!" })).toBeVisible({ timeout: 20_000 });
    expect(errores).toEqual([]);
  });

  test("Mercado Pago: va a pagar, aprueba y vuelve con el pago confirmado", async ({ page }, info) => {
    await agregar(page, "jogger-rustico-puno");
    await page.getByRole("link", { name: "Finalizar compra" }).click();
    await datos(page, email("mp", info));
    await page.getByText("Retiro en el local").click();
    await page.getByText("Mercado Pago", { exact: true }).click();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Ir a pagar" }).click();
    await page.waitForURL(/:3910\/checkout/);
    await page.getByRole("button", { name: "Aprobar pago" }).click();
    await page.waitForURL(/\/pedido\/ISU-\d+/);
    await expect(page.getByRole("heading", { name: "¡Pago confirmado!" })).toBeVisible({ timeout: 20_000 });
  });

  test("Mercado Pago rechazado: el pedido sigue reservado y se puede reintentar", async ({ page }, info) => {
    await agregar(page, "jogger-rustico-puno");
    await page.getByRole("link", { name: "Finalizar compra" }).click();
    await datos(page, email("mprech", info));
    await page.getByText("Retiro en el local").click();
    await page.getByText("Mercado Pago", { exact: true }).click();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Ir a pagar" }).click();
    await page.waitForURL(/:3910\/checkout/);
    await page.getByRole("button", { name: "Rechazar" }).click();
    await page.waitForURL(/\/pedido\/ISU-\d+/);
    await expect(page.getByRole("button", { name: "Volver a intentar el pago" })).toBeVisible();
    await page.getByRole("button", { name: "Volver a intentar el pago" }).click();
    await page.waitForURL(/:3910\/checkout/);
  });

  test("pagar en el local sólo aparece con retiro; envío a domicilio pide la dirección", async ({ page }, info) => {
    await agregar(page, "calza-deportiva-tiro-alto");
    await page.getByRole("link", { name: "Finalizar compra" }).click();
    await expect(page.getByText("Pagar al retirar en el local")).toBeHidden();
    await page.getByText("Retiro en el local").click();
    await expect(page.getByText("Pagar al retirar en el local")).toBeVisible();
    await page.getByText("Envío a domicilio").click();
    await datos(page, email("envio", info));
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: /Confirmar compra|Ir a pagar/ }).click();
    await expect(page.locator("[aria-invalid=true]").first()).toBeFocused();
  });
});

test.describe("cuenta", () => {
  test("crear cuenta, ver pedidos, salir y volver a entrar", async ({ page, context }, info) => {
    const correo = email("cuenta", info);
    await page.goto("/cuenta");
    await page.getByRole("tab", { name: "Soy nuevo" }).click();
    await page.getByLabel("Nombre").fill("Ana");
    await page.getByLabel("Apellido").fill("Prueba");
    await page.getByLabel("Email").fill(correo);
    await page.getByLabel("Contraseña").fill("una-clave-larga-1");
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(page.getByRole("heading", { name: "Hola, Ana" })).toBeVisible();
    // La sesión es una cookie httpOnly: el JavaScript de la página no la ve.
    expect(await page.evaluate(() => document.cookie)).not.toMatch(/isu_s/);
    const c = (await context.cookies()).find((x) => /isu_s$/.test(x.name));
    expect(c).toMatchObject({ httpOnly: true, sameSite: "Lax" });
    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await expect(page.getByRole("heading", { name: "Ingresá" })).toBeVisible();
    await page.getByLabel("Email").fill(correo);
    await page.getByLabel("Contraseña").fill("mala");
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page.getByText("Email o contraseña incorrectos.")).toBeVisible();
    await page.getByLabel("Contraseña").fill("una-clave-larga-1");
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page.getByRole("heading", { name: "Hola, Ana" })).toBeVisible();
  });
});

test.describe("arrepentimiento", () => {
  test("con número y email del pedido: código de trámite y pedido cancelado", async ({ page }, info) => {
    const correo = email("arr", info);
    await agregar(page, "remera-basica-cuello-redondo");
    await page.getByRole("link", { name: "Finalizar compra" }).click();
    await datos(page, correo);
    await page.getByText("Retiro en el local").click();
    await page.getByText("Pagar al retirar en el local").click();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Confirmar compra" }).click();
    await page.waitForURL(/\/pedido\/ISU-\d+/);
    const numero = page.url().match(/ISU-\d+/)![0];
    await page.goto("/arrepentimiento");
    await page.getByLabel("Número de pedido").fill(numero);
    await page.getByLabel("Email de la compra").fill(correo);
    await page.getByLabel("Nombre y apellido").fill("Ana Prueba");
    await page.getByRole("button", { name: "Quiero arrepentirme de mi compra" }).click();
    await expect(page.getByRole("status")).toContainText(/Código de trámite: ARR-[A-Z0-9]{6}/);
    await expect(page.getByRole("status")).toContainText(/quedó cancelado/);
  });
});
