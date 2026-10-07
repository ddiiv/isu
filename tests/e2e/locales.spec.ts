import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "./base";

/*
 * Los links de los locales (Ajustes → Locales → «Link del local»): en la
 * tienda, el nombre del local y «Cómo llegar» llevan ahí, en otra pestaña.
 * Los datos de muestra (pnpm demo:fotos) le ponen link al local de Flores; los
 * de La Salada quedan sin link.
 */
const RAIZ = process.env.RAIZ ?? process.cwd();
// eslint-disable-next-line security/detect-non-literal-fs-filename -- el .env del propio repo
const ENV = readFileSync(path.join(RAIZ, ".env"), "utf8");
const delEnv = (k: string) => process.env[k] ?? ENV.split("\n").find((l) => l.startsWith(`${k}=`))?.slice(k.length + 1).trim() ?? "";
const FLORES = "Vía Flores · Local 21";
const LINK = /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=Bacacay/;

function vigilar(page: Page) {
  const errores: string[] = [];
  page.on("pageerror", (e) => errores.push(e.message));
  return errores;
}

test.beforeAll(async ({ request }) => {
  // La configuración (y con ella los locales) se regenera en la tienda.
  await request.post("/api/revalidar", { headers: { authorization: `Bearer ${delEnv("REVALIDAR_TOKEN")}`, "content-type": "application/json" }, data: { etiquetas: ["catalogo"] } });
});

test("Locales: el nombre, la dirección y «Cómo llegar» llevan al link, en otra pestaña", async ({ page }) => {
  const errores = vigilar(page);
  await page.goto("/locales");
  const flores = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: FLORES }) });
  const nombre = flores.getByRole("link", { name: FLORES, exact: true });
  await expect(nombre).toHaveAttribute("href", LINK);
  await expect(nombre).toHaveAttribute("target", "_blank");
  await expect(nombre).toHaveAttribute("rel", /noopener/);
  await expect(flores.getByRole("link", { name: /Bacacay 3231/ })).toHaveAttribute("href", LINK);
  const comoLlegar = flores.getByRole("link", { name: `Cómo llegar a ${FLORES} (se abre en otra pestaña)` });
  await expect(comoLlegar).toBeVisible();
  await expect(comoLlegar).toHaveAttribute("href", LINK);
  await expect(comoLlegar).toHaveAttribute("target", "_blank");
  // Un local sin link: sin «Cómo llegar» y el nombre no es un link.
  const salada = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "La Salada · Galería Mogote" }) });
  await expect(salada.getByRole("link")).toHaveCount(0);
  expect(errores).toEqual([]);
});

test("checkout y pedido: «Cómo llegar» en el local de retiro", async ({ page }, info) => {
  test.skip(info.project.name === "celular", "el mismo flujo; alcanza en escritorio");
  const errores = vigilar(page);
  await page.goto("/producto/remera-basica-cuello-redondo");
  await page.locator("fieldset", { hasText: "Talle" }).getByRole("button", { disabled: false }).first().click();
  await page.getByRole("button", { name: "Agregar al carrito" }).click();
  await page.getByRole("dialog").getByRole("link", { name: /^Pagar con transferencia/ }).click();
  await page.waitForURL(/\/checkout/);
  await page.getByLabel("Email").fill(`e2e-local-${Date.now()}@test.com`);
  await page.getByLabel("Nombre", { exact: true }).fill("Ana");
  await page.getByLabel("Apellido").fill("Local");
  await page.getByLabel("Celular").fill("11 5555 1234");
  await page.getByLabel("DNI o CUIT").fill("30111222");
  await page.getByText("Retiro en el local").click();
  const retiro = page.getByRole("radiogroup", { name: "Local de retiro" });
  await expect(retiro.getByRole("link", { name: `Cómo llegar a ${FLORES} (se abre en otra pestaña)` })).toHaveAttribute("href", LINK);
  // Sólo el que tiene link.
  await expect(retiro.getByRole("link")).toHaveCount(1);
  await page.getByText("Pagar al retirar en el local").click();
  await page.getByRole("checkbox", { name: /Acepto los/ }).check();
  await page.getByRole("button", { name: /Confirmar compra/ }).click();
  await page.waitForURL(/\/pedido\/ISU-\d+/);
  await expect(page.getByText(/Retirás en/)).toContainText(FLORES);
  await expect(page.getByRole("link", { name: "Cómo llegar ↗" })).toHaveAttribute("href", LINK);
  expect(errores).toEqual([]);
});
