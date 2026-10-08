import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, type Page } from "./base";

/*
 * Etapa 12 en un navegador real:
 *
 *   · el inicio con banners interactivos: texto sobre la foto o sobre un
 *     color, botones que llevan a una página de la tienda, la tarjeta de un
 *     producto y los datos de Ajustes ({descuento}…) ya puestos;
 *   · el backoffice arma un banner (título, variable, botón, producto
 *     automático, color) con la vista previa en compu y celular, y se ve en
 *     la tienda;
 *   · las direcciones del backoffice llevan el nombre, no el id: productos y
 *     guías de talles (un número viejo lleva al nombre).
 *
 * Usa los datos de muestra (pnpm demo:fotos y demo:backoffice) y los banners
 * sugeridos que carga la migración 0019.
 */
const RAIZ = process.env.RAIZ ?? process.cwd();
const ADMIN = process.env.ADMIN_URL ?? "http://127.0.0.1:3001";

function vigilar(page: Page) {
  const errores: string[] = [];
  page.on("pageerror", (e) => errores.push(e.message));
  return errores;
}
/** Un texto armado por la prueba (sólo letras, números y espacios), como expresión regular. */
// eslint-disable-next-line security/detect-non-literal-regexp -- texto propio de la prueba
const exacta = (t: string) => new RegExp(t);
const carrusel = (page: Page) => page.locator('section[aria-roledescription="carrusel"]');
const diapositiva = (page: Page, titulo: string | RegExp) => carrusel(page).getByRole("listitem").filter({ has: page.getByRole("heading", { name: titulo }) });

test.describe("inicio", () => {
  test.beforeEach(async ({ page }) => {
    // Sin el pase automático: la prueba mira cada banner con calma.
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("banner con foto, texto y botones; los datos de Ajustes ya puestos", async ({ page }) => {
    const errores = vigilar(page);
    await page.goto("/");
    const nueva = diapositiva(page, "Nueva temporada");
    await expect(nueva.getByText("Recién llegado")).toBeVisible();
    // La foto es de fondo (el texto ya lo dice todo).
    await expect(nueva.locator("img").first()).toHaveAttribute("alt", "");
    await expect(nueva.getByRole("link", { name: "Comprar Mujer" })).toHaveAttribute("href", "/mujer");
    // Las variables vienen reemplazadas: «20% OFF pagando con transferencia».
    await expect(diapositiva(page, /^\d+% OFF pagando con transferencia$/)).toHaveCount(1);
    await expect(carrusel(page)).not.toContainText("{");
    // Los botones llevan a su página.
    await nueva.getByRole("link", { name: "Ver lo nuevo" }).click();
    await expect(page).toHaveURL(/\/nuevos$/);
    await expect(page.getByRole("heading", { level: 1, name: "Nuevos" })).toBeVisible();
    expect(errores).toEqual([]);
  });

  test("banner con la tarjeta de un producto: lleva a su ficha", async ({ page }) => {
    const errores = vigilar(page);
    await page.goto("/");
    const conProducto = diapositiva(page, "Lo último que salió del taller");
    const tarjeta = conProducto.locator('a[href^="/producto/"]');
    await expect(tarjeta).toHaveCount(1);
    await expect(tarjeta).toHaveAttribute("aria-label", /^Ver .+/);
    await expect(tarjeta.getByText("Ver producto")).toBeAttached();
    await expect(tarjeta.getByText(/^\$\s?[\d.]+$/).last()).toBeAttached();
    const href = (await tarjeta.getAttribute("href"))!;
    await tarjeta.click();
    await expect(page).toHaveURL(exacta(`${href.replace(/[^a-z0-9/-]/g, "")}$`));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(errores).toEqual([]);
  });

  test("en el celular y en la compu, cada banner entra en la pantalla (nada se corta de costado)", async ({ page }) => {
    await page.goto("/");
    const diapositivas = carrusel(page).getByRole("listitem");
    await expect(diapositivas.first()).toBeVisible();
    const desbordes = await diapositivas.evaluateAll((lis) => lis
      .map((li) => ({ li, caja: li.firstElementChild as HTMLElement }))
      .filter(({ caja }) => caja.scrollWidth > caja.clientWidth + 1)
      .map(({ li }) => li.textContent?.slice(0, 40)));
    expect(desbordes).toEqual([]);
    // Las tarjetas de producto y los botones, dentro de su banner.
    const ancho = page.viewportSize()!.width;
    for (const a of await carrusel(page).locator("a").all()) {
      const caja = await a.boundingBox();
      if (caja) expect(caja.width, await a.innerText()).toBeLessThanOrEqual(ancho);
    }
  });
});

test.describe("backoffice", () => {
  test("Portada: armar un banner con variable, botón y producto, verlo en la vista previa y en la tienda", async ({ page }, info) => {
    test.skip(info.project.name === "celular", "el editor se prueba en la compu");
    test.setTimeout(120_000);
    const errores = vigilar(page);
    await ingresar(page, `e2e-banners-${Date.now()}@test.com`);
    await page.goto(`${ADMIN}/portada`);
    // Los sugeridos ya están (la migración los carga), con su estado.
    await expect(page.getByText("Lo último que salió del taller").first()).toBeVisible();
    await expect(page.getByText("Se ve en el inicio").first()).toBeVisible();

    await page.getByRole("button", { name: "Nuevo banner" }).click();
    const editor = page.locator("section", { has: page.getByRole("heading", { name: "Banner nuevo" }) });
    const vista = editor.locator("[inert]");
    const titulo = `Outfit e2e ${Date.now() % 100000}`;
    // (el nombre del campo incluye su ayuda: «Título Lo grande del banner.»)
    const campoTitulo = editor.getByRole("textbox", { name: /^Título/ });
    await campoTitulo.fill(`${titulo} con `);
    // Una variable de Ajustes, donde está el cursor.
    await editor.getByRole("button", { name: /^\{descuento\}/ }).click();
    await expect(campoTitulo).toHaveValue(`${titulo} con {descuento}`);
    await campoTitulo.press("End");
    await campoTitulo.pressSequentially("% OFF");
    await expect(vista.locator("h2")).toHaveText(exacta(`^${titulo} con \\d+% OFF$`));
    // Un botón a una página de la tienda.
    await editor.getByRole("button", { name: "+ Agregar botón" }).click();
    await editor.getByLabel("Texto del botón 1").fill("Armar mi outfit");
    await editor.getByRole("combobox", { name: /^Lleva a/ }).selectOption({ label: "Armá tu outfit" });
    await expect(vista.getByText("Armar mi outfit")).toBeVisible();
    // El producto: el más nuevo, solo.
    await editor.getByRole("radio", { name: "Automático" }).check();
    await expect(vista.getByText("Ver producto")).toBeVisible();
    // Color y celular.
    // (la opción está oculta: se toca la muestra de color, como una persona)
    await editor.locator("label", { has: page.getByRole("radio", { name: "Verde" }) }).click();
    await expect(editor.getByRole("radio", { name: "Verde" })).toBeChecked();
    await expect(vista.locator(".bg-ahorro").first()).toBeVisible();
    await editor.getByRole("button", { name: "Celular" }).click();
    await expect(editor.getByRole("button", { name: "Celular" })).toHaveAttribute("aria-pressed", "true");
    await expect(vista).toHaveCSS("width", "390px");

    await editor.getByRole("button", { name: "Crear banner" }).click();
    await expect(page.getByText("Banner creado. Si querés, ahora subile una foto.")).toBeVisible();
    await expect(page.getByRole("heading", { name: exacta(`^Editar banner: ${titulo}`) })).toBeVisible();

    // En la tienda (se regenera sola): es el primero del carrusel.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect.poll(async () => {
      await page.goto("/");
      return carrusel(page).getByRole("listitem").first().locator("h2").innerText().catch(() => "");
    }, { timeout: 40_000 }).toMatch(exacta(`^${titulo} con \\d+% OFF$`));
    const primero = carrusel(page).getByRole("listitem").first();
    await expect(primero.locator('a[href^="/producto/"]')).toHaveCount(1);
    await primero.getByRole("link", { name: "Armar mi outfit" }).click();
    await expect(page).toHaveURL(/\/outfits$/);

    // Se borra (y se va de la tienda).
    await page.goto(`${ADMIN}/portada`);
    const fila = page.getByRole("listitem").filter({ hasText: titulo });
    page.once("dialog", (d) => void d.accept());
    await fila.getByRole("button", { name: "Borrar" }).click();
    await expect(page.getByText("Banner borrado.")).toBeVisible();
    await expect(fila).toHaveCount(0);
    expect(errores).toEqual([]);
  });

  test("productos y guías de talles con su nombre en la dirección; un número viejo lleva al nombre", async ({ page }, info) => {
    test.skip(info.project.name === "celular", "lo mismo en el celular");
    test.setTimeout(90_000);
    const errores = vigilar(page);
    await ingresar(page, `e2e-rutas-${Date.now()}@test.com`);
    await page.goto(`${ADMIN}/productos?q=Remera%20b%C3%A1sica%20cuello%20redondo`);
    await page.getByRole("link", { name: /Remera básica cuello redondo/i }).first().click();
    await expect(page).toHaveURL(/\/productos\/remera-basica-cuello-redondo$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Remera básica cuello redondo/i);
    // Un link viejo con el número: termina en la dirección con el nombre.
    const id = await page.evaluate(async () => {
      const r = await fetch("/api/a/productos?q=Remera%20b%C3%A1sica%20cuello%20redondo", { headers: { "x-isu": "1" } });
      return ((await r.json()) as { productos: Array<{ id: number; slug: string }> }).productos.find((p) => p.slug === "remera-basica-cuello-redondo")!.id;
    });
    await page.goto(`${ADMIN}/productos/${id}`);
    await expect(page).toHaveURL(/\/productos\/remera-basica-cuello-redondo$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Remera básica cuello redondo/i);

    await page.goto(`${ADMIN}/guias-talles`);
    await page.getByRole("link", { name: "Remera y top adulto", exact: true }).click();
    await expect(page).toHaveURL(/\/guias-talles\/remera-y-top-adulto$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Remera y top adulto");
    expect(errores).toEqual([]);
  });
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
