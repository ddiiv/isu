import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, verResumen, type Page } from "./base";

/*
 * Etapa 6: cupones en un navegador real (escritorio y celular).
 *
 *   Tienda: el cupón se escribe en el carrito, sigue en el checkout, baja el
 *   total y queda en el pedido; uno que no existe avisa por qué.
 *   Backoffice: se crea un cupón, se usa en la tienda y al pausarlo deja de
 *   servir.
 *
 * Necesita los datos de muestra (scripts/demo/backoffice-demo.mjs: cupones
 * BIENVENIDA10 y ENVIOGRATIS).
 */
const RAIZ = process.env.RAIZ ?? process.cwd();
const ADMIN = process.env.ADMIN_URL ?? "http://127.0.0.1:3001";

function vigilar(page: Page) {
  const errores: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errores.push(m.text()); });
  page.on("pageerror", (e) => errores.push(String(e)));
  return errores;
}
async function agregar(page: Page, slug: string) {
  await page.goto(`/producto/${slug}`);
  const colores = page.locator("fieldset", { hasText: "Color" }).getByRole("button");
  for (let c = 0; c < Math.max(1, await colores.count()); c++) {
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
  throw new Error(`${slug}: sin talles con stock de sobra (reiniciá el Stocker simulado)`);
}
async function aplicar(zona: ReturnType<Page["getByRole"]> | Page, codigo: string) {
  const abrir = zona.getByRole("button", { name: "¿Tenés un cupón de descuento?" });
  if (await abrir.isVisible()) await abrir.click();
  await zona.getByLabel("Código del cupón").fill(codigo);
  await zona.getByRole("button", { name: "Aplicar" }).click();
}
const pesos = (t: string) => Number(t.replace(/[^\d]/g, ""));

test.describe("cupones en la tienda", () => {
  test("en el carrito: uno que no existe avisa; uno bueno descuenta y se puede quitar", async ({ page }) => {
    const errores = vigilar(page);
    await agregar(page, "remera-oversize-algodon-peinado");
    const cajon = page.getByRole("dialog");
    await aplicar(cajon, "NOEXISTE99");
    await expect(cajon.getByRole("alert")).toHaveText("Ese cupón no existe. Revisá que esté bien escrito.");
    await aplicar(cajon, "bienvenida10");
    await expect(cajon.getByText(/Cupón BIENVENIDA10 aplicado/)).toBeVisible();
    await expect(cajon.getByText(/^−\$/)).toBeVisible();
    await cajon.getByRole("button", { name: "Quitar el cupón BIENVENIDA10" }).click();
    await expect(cajon.getByText(/Cupón BIENVENIDA10 aplicado/)).toBeHidden();
    await expect(cajon.getByLabel("Código del cupón")).toHaveValue("");
    expect(errores).toEqual([]);
  });

  test("sigue en el checkout, baja el total y queda en el pedido", async ({ page }, info) => {
    await agregar(page, "buzo-canguro-frisa-premium");
    await aplicar(page.getByRole("dialog"), "BIENVENIDA10");
    await expect(page.getByRole("dialog").getByText(/Cupón BIENVENIDA10 aplicado/)).toBeVisible();
    await page.getByRole("link", { name: /^Pagar con transferencia/ }).click();
    await page.getByLabel("Email").fill(`e2e-cupon-${info.project.name}-${Date.now()}@test.com`);
    await page.getByLabel("Nombre", { exact: true }).fill("Ana");
    await page.getByLabel("Apellido").fill("Cupón");
    await page.getByLabel("Celular").fill("11 5555 1234");
    await page.getByLabel("DNI o CUIT").fill("30111222");
    await page.getByText("Retiro en el local").click();
    await page.getByText("Pagar al retirar en el local").click();
    await verResumen(page);
    const resumen = page.getByRole("complementary");
    await expect(resumen.getByText("Cupón BIENVENIDA10", { exact: false }).first()).toBeVisible();
    const valor = async (dt: string) => pesos(await resumen.locator("dt").getByText(dt, { exact: true }).locator("xpath=ancestor-or-self::dt/following-sibling::dd").innerText());
    const subtotal = await valor("Subtotal");
    const total = await valor("Total");
    expect(total).toBeLessThan(subtotal);
    expect(total).toBeGreaterThanOrEqual(Math.floor(subtotal * 0.9) - 1);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Confirmar compra" }).click();
    await page.waitForURL(/\/pedido\/ISU-\d+/);
    await expect(page.getByRole("complementary").getByText("Cupón")).toBeVisible();
    await expect(page.getByRole("complementary").getByText("BIENVENIDA10")).toBeVisible();
    // El carrito quedó vacío y el cupón también (es de una vez por cliente).
    await expect(page.getByRole("button", { name: "Carrito, vacío" })).toBeVisible();
  });

  test("envío gratis pide compra mínima", async ({ page }) => {
    await agregar(page, "remera-basica-cuello-redondo");
    const cajon = page.getByRole("dialog");
    await aplicar(cajon, "ENVIOGRATIS");
    await expect(cajon.getByRole("alert")).toContainText("es para compras desde");
  });
});

test.describe("cupones en el backoffice", () => {
  test.skip(({ isMobile }) => isMobile, "El backoffice se prueba en escritorio");
  test.describe.configure({ mode: "serial" });
  const EMAIL = "e2e-cupones@isuwaya.test";
  const CODIGO = `E2E${Date.now().toString(36).toUpperCase()}`;

  async function ingresar(page: Page) {
    const salida = spawnSync("node", ["--env-file-if-exists=.env", "apps/api/dist/cli/crear-admin.js", EMAIL, "Cupones E2E"], { cwd: RAIZ, encoding: "utf8" }).stderr;
    const clave = /provisoria: (\S+)/.exec(salida)![1]!;
    const { codigo } = await import(pathToFileURL(path.join(RAIZ, "apps/api/dist/lib/totp.js")).href) as { codigo: (s: string, p: number) => string };
    await page.goto(`${ADMIN}/`);
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Contraseña").fill(clave);
    await page.getByRole("button", { name: "Continuar" }).click();
    await page.getByText("No puedo escanear").click();
    const secreto = (await page.locator("code").innerText()).replace(/\s/g, "");
    await page.getByLabel("Código de 6 números").fill(codigo(secreto, Math.floor(Date.now() / 30_000)));
    await page.getByRole("button", { name: "Ingresar" }).click();
    await page.getByLabel("Contraseña provisoria").fill(clave);
    await page.getByRole("textbox", { name: /^Contraseña nueva/ }).fill("frase larga para cupones e2e");
    await page.getByLabel("Repetí la contraseña nueva").fill("frase larga para cupones e2e");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText("Para atender")).toBeVisible();
  }

  test("se crea un cupón, se usa en la tienda y al pausarlo deja de servir", async ({ page, context }) => {
    const errores = vigilar(page);
    await ingresar(page);
    await page.getByRole("link", { name: "Cupones" }).first().click();
    await page.getByRole("button", { name: "Nuevo cupón" }).click();
    // Los errores se ven al lado del campo, sin ir a la API.
    await page.getByLabel(/^Nombre/).fill("");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText("Poné un nombre (lo ve el cliente)")).toBeVisible();
    await page.getByLabel(/^Código/).fill(CODIGO.toLowerCase());
    await page.getByLabel(/^Nombre/).fill("25% prueba e2e");
    await page.getByRole("spinbutton", { name: "Porcentaje" }).fill("25");
    await page.getByLabel(/^Usos en total/).fill("50");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText("Cupón guardado")).toBeVisible();
    const fila = page.getByRole("listitem").filter({ hasText: CODIGO });
    await expect(fila.getByText("25% OFF")).toBeVisible();
    await expect(fila.getByText("Vigente")).toBeVisible();
    await expect(fila.getByText(/Usos: 0 de 50/)).toBeVisible();

    const tienda = await context.newPage();
    await agregar(tienda, "remera-oversize-algodon-peinado");
    await aplicar(tienda.getByRole("dialog"), CODIGO);
    await expect(tienda.getByRole("dialog").getByText(`Cupón ${CODIGO} aplicado`)).toBeVisible();
    await tienda.getByRole("dialog").getByRole("button", { name: `Quitar el cupón ${CODIGO}` }).click();

    await fila.getByRole("button", { name: "Pausar" }).click();
    await expect(fila.getByText("Pausado")).toBeVisible();
    await aplicar(tienda.getByRole("dialog"), CODIGO);
    await expect(tienda.getByRole("dialog").getByRole("alert")).toHaveText("Ese cupón ya no está vigente.");
    expect(errores).toEqual([]);
  });
});
