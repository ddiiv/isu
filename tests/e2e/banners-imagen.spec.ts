import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { expect, test, type Page } from "./base";

/*
 * Banners de imagen en un navegador real:
 *
 *   · el backoffice arma un banner que es sólo la foto, con link a otro sitio
 *     y una etiqueta de producto que se ubica tocando la foto;
 *   · en la tienda, la foto lleva al otro sitio (en otra pestaña) y la
 *     etiqueta es un punto: al tocarlo se ve la tarjeta del producto, que
 *     lleva a su ficha; tocar la foto con la tarjeta abierta sólo la cierra;
 *   · en el celular (sin foto vertical) la etiqueta queda en el mismo lugar
 *     y la tarjeta entra en el banner.
 *
 * Usa los datos de muestra (pnpm demo:fotos y demo:backoffice).
 */
const RAIZ = process.env.RAIZ ?? process.cwd();
const ADMIN = process.env.ADMIN_URL ?? "http://127.0.0.1:3001";
const SITIO = "https://www.instagram.com/isuwaya";

const carrusel = (page: Page) => page.locator('section[aria-roledescription="carrusel"]');

test("banner de imagen: link a otro sitio y etiqueta de producto, del backoffice a la tienda", async ({ page }, info) => {
  test.skip(info.project.name === "celular", "el editor se prueba en la compu (el celular se mira adentro de la prueba)");
  test.setTimeout(150_000);
  const errores: string[] = [];
  page.on("pageerror", (e) => errores.push(e.message));
  const alt = `Campaña e2e ${Date.now() % 100000}`;

  await ingresar(page, `e2e-banner-imagen-${Date.now()}@test.com`);
  await page.goto(`${ADMIN}/portada`);
  await page.getByRole("button", { name: "Nuevo banner" }).click();
  const editor = page.locator("section", { has: page.getByRole("heading", { name: "Banner nuevo" }) });
  // (la opción está oculta: se toca la tarjeta del tipo, como una persona)
  await editor.locator("label", { has: page.getByRole("radio", { name: /^Imagen con link/ }) }).click();
  await expect(editor.getByRole("textbox", { name: /^Título/ })).toHaveCount(0);
  await editor.getByRole("textbox", { name: /^Qué se ve en el banner/ }).fill(alt);
  await editor.getByRole("combobox", { name: /^Al tocar el banner, lleva a/ }).selectOption({ label: "Otro sitio (https://…)" });
  const sitio = editor.getByRole("textbox", { name: /^Dirección del otro sitio/ });
  await sitio.fill("https://isuwaya.com@evil.com");
  await expect(editor.getByText("Revisá la dirección")).toBeVisible();
  await sitio.fill(SITIO);
  await expect(editor.getByText("Revisá la dirección")).toHaveCount(0);
  const foto = await sharp({ create: { width: 1800, height: 700, channels: 3, background: "#c9b79c" } }).jpeg().toBuffer();
  await editor.getByLabel(/^Foto para compu/).setInputFiles({ name: "campana.jpg", mimeType: "image/jpeg", buffer: foto });
  await editor.getByRole("button", { name: "Crear banner" }).click();
  await expect(page.getByText("Banner creado. Ahora podés ponerle etiquetas de productos.")).toBeVisible();

  // Una etiqueta: se toca la foto donde está la prenda y se elige el producto.
  const editando = page.locator("section", { has: page.getByRole("heading", { name: /^Editar banner/ }) });
  const lienzo = editando.locator("img.cursor-crosshair");
  await expect(lienzo).toBeVisible();
  const caja = (await lienzo.boundingBox())!;
  await lienzo.click({ position: { x: caja.width * 0.3, y: caja.height * 0.5 } });
  await expect(editando.getByRole("button", { name: /^Etiqueta 1/ })).toBeVisible();
  await editando.getByRole("searchbox", { name: "Producto de la etiqueta 1" }).fill("Remera");
  const elegido = editando.locator("ul button").first();
  const nombre = (await elegido.locator("span.font-bold").innerText()).trim();
  await elegido.click();
  await expect(editando.getByText(nombre, { exact: true })).toBeVisible();
  // En la vista previa se ve el punto.
  await expect(editando.locator("[inert]").getByRole("button", { name: `Ver ${nombre}` })).toBeAttached();
  await editando.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Banner guardado.")).toBeVisible();

  // En la tienda (se regenera sola): es el primero del carrusel.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const primero = carrusel(page).getByRole("listitem").first();
  await expect.poll(async () => {
    await page.goto("/");
    return primero.locator(`a[href="${SITIO}"]`).count();
  }, { timeout: 40_000 }).toBe(1);
  const link = primero.locator(`a[href="${SITIO}"]`);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await expect(link).toHaveAttribute("aria-label", `${alt} (se abre en otra pestaña)`);

  const punto = primero.getByRole("button", { name: `Ver ${nombre}` });
  await expect(punto).toHaveAttribute("aria-expanded", "false");
  // El nombre no está a la vista: sólo el punto.
  await expect(primero.getByText(nombre)).toHaveCount(0);
  await punto.click();
  await expect(punto).toHaveAttribute("aria-expanded", "true");
  const tarjeta = primero.locator('a[href^="/producto/"]');
  await expect(tarjeta).toContainText(nombre);
  await expect(tarjeta).toContainText("Ver producto");
  await page.screenshot({ path: test.info().outputPath("etiqueta-abierta-compu.png") });
  // Tocar la foto con la tarjeta abierta sólo la cierra: no va al otro sitio.
  const foto1 = (await link.boundingBox())!;
  await page.mouse.click(foto1.x + foto1.width * 0.85, foto1.y + foto1.height * 0.2);
  await expect(punto).toHaveAttribute("aria-expanded", "false");
  await expect(page).toHaveURL(/localhost:3000\/$|127\.0\.0\.1:3000\/$/);
  // Con el teclado: Enter abre, Escape cierra y vuelve al punto.
  await punto.focus();
  await page.keyboard.press("Enter");
  await expect(tarjeta).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tarjeta).toHaveCount(0);
  await expect(punto).toBeFocused();

  // En el celular (sin foto vertical): el mismo lugar, y la tarjeta entra en el banner.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(punto).toBeVisible();
  await punto.click();
  await expect(tarjeta).toBeVisible();
  const banner = (await link.boundingBox())!;
  const t = (await tarjeta.boundingBox())!;
  expect(t.x).toBeGreaterThanOrEqual(banner.x - 1);
  expect(t.x + t.width).toBeLessThanOrEqual(banner.x + banner.width + 1);
  await page.screenshot({ path: test.info().outputPath("etiqueta-abierta-celular.png") });
  // La tarjeta lleva a la ficha.
  await tarjeta.click();
  await expect(page).toHaveURL(/\/producto\/[a-z0-9-]+$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(nombre);

  // Se borra (y se va de la tienda).
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${ADMIN}/portada`);
  const fila = page.getByRole("listitem").filter({ hasText: alt });
  page.once("dialog", (d) => void d.accept());
  await fila.getByRole("button", { name: "Borrar" }).click();
  await expect(page.getByText("Banner borrado.")).toBeVisible();
  expect(errores).toEqual([]);
});

async function ingresar(page: Page, email: string) {
  const salida = spawnSync("node", ["--env-file-if-exists=.env", "apps/api/dist/cli/crear-admin.js", email, "Banners E2E"], { cwd: RAIZ, encoding: "utf8" }).stderr;
  const clave = /provisoria: (\S+)/.exec(salida)![1]!;
  const { codigo } = await import(pathToFileURL(path.join(RAIZ, "apps/api/dist/lib/totp.js")).href) as { codigo: (s: string, paso: number) => string };
  await page.goto(`${ADMIN}/`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña").fill(clave);
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByText("No puedo escanear").click();
  const secreto = (await page.locator("code").innerText()).replace(/\s/g, "");
  await page.getByLabel("Código de 6 números").fill(codigo(secreto, Math.floor(Date.now() / 30_000)));
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(/cambiar-clave/);
  await page.getByLabel("Contraseña provisoria").fill(clave);
  await page.getByRole("textbox", { name: /^Contraseña nueva/ }).fill("frase larga para la prueba de banners");
  await page.getByLabel("Repetí la contraseña nueva").fill("frase larga para la prueba de banners");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Para atender")).toBeVisible();
}
