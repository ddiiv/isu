import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, type Page } from "./base";

/*
 * Etapa 3 en un navegador real.
 *
 *   Tienda: botón Mayorista, Nuevos/Destacados, descuento tachado, guía de
 *   talles con "¿Cuál es mi talle?" y "Armá tu outfit" hasta el carrito.
 *   Backoffice: ingreso con doble factor, casillas Destacado/Nuevo que se
 *   ven en la tienda y el editor de guías de talles.
 *
 * Necesita los servicios levantados, los datos de muestra
 * (scripts/demo/backoffice-demo.mjs) y el backoffice en ADMIN_URL.
 */
// `pnpm e2e` corre desde la raíz del monorepo.
const RAIZ = process.env.RAIZ ?? process.cwd();
const ADMIN = process.env.ADMIN_URL ?? "http://127.0.0.1:3001";

function vigilar(page: Page) {
  const errores: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errores.push(m.text()); });
  page.on("pageerror", (e) => errores.push(String(e)));
  return errores;
}

test.describe("tienda", () => {
  test("Armá tu outfit y Pedido mayorista siempre a la vista en la barra; Mayorista lleva a MAYORISTA_URL", async ({ page, request }) => {
    await page.goto("/");
    const barra = page.getByRole("banner");
    await expect(barra.getByRole("link", { name: "Armá tu outfit" })).toBeVisible();
    await expect(barra.getByRole("link", { name: "Pedido mayorista" })).toBeVisible();
    await expect(barra.getByRole("link", { name: "Pedido mayorista" })).toHaveAttribute("href", "/mayorista");
    await barra.getByRole("link", { name: "Armá tu outfit" }).click();
    await expect(page).toHaveURL(/\/outfits$/);
    const r = await request.get("/mayorista", { maxRedirects: 0 });
    expect(r.status()).toBe(302);
    expect(r.headers().location).toMatch(/^https?:\/\//);
    expect(r.headers()["cache-control"]).toContain("no-store");
  });

  test("Nuevos en la barra y en su página; Destacados en el inicio", async ({ page, isMobile }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Destacados" })).toBeVisible();
    if (isMobile) {
      await page.getByRole("button", { name: "Abrir menú" }).click();
      await page.getByRole("dialog", { name: "Menú" }).getByRole("link", { name: "Nuevos", exact: true }).click();
    } else {
      await page.getByRole("navigation", { name: "Categorías" }).getByRole("link", { name: "Nuevos" }).click();
    }
    await expect(page).toHaveURL(/\/nuevos$/);
    await expect(page.getByRole("heading", { level: 1, name: "Nuevos" })).toBeVisible();
    await expect(page.locator("article").first().getByText("Nuevo", { exact: true })).toBeVisible();
  });

  test("un descuento se ve tachado, con el porcentaje", async ({ page }) => {
    await page.goto("/producto/calza-deportiva-tiro-alto");
    const precio = page.getByRole("region", { name: "Comprar" });
    await expect(precio.locator("s").first()).toBeVisible();
    await expect(precio.getByText("-20%")).toBeVisible();
  });

  test("guía de talles: tabla y ¿cuál es mi talle?", async ({ page }) => {
    const errores = vigilar(page);
    await page.goto("/producto/remera-oversize-algodon-peinado");
    await page.getByRole("button", { name: "Guía de talles" }).click();
    const guia = page.getByRole("dialog", { name: "Guía de talles" });
    await expect(guia.getByRole("rowheader", { name: "M", exact: true })).toBeVisible();
    await expect(guia.getByRole("columnheader", { name: /Contorno de pecho/ })).toBeVisible();
    await guia.getByRole("tab", { name: "¿Cuál es mi talle?" }).click();
    await guia.getByLabel("Contorno de pecho").fill("93");
    await expect(guia.getByText("Talle M", { exact: true })).toBeVisible();
    const elegir = guia.getByRole("button", { name: "Elegir talle M" });
    if (await elegir.isVisible()) {
      await elegir.click();
      await expect(guia).toBeHidden();
      await expect(page.getByRole("button", { name: /^M/, pressed: true })).toBeVisible();
    } else {
      await expect(guia.getByText(/No hay talle M en este color/)).toBeVisible();
      await guia.getByLabel("Contorno de cintura").focus();
      await page.keyboard.press("Escape");
    }
    // Las medidas quedan en el navegador: al volver, la ficha ya marca su talle.
    await page.reload();
    await expect(page.getByText(/Con tus medidas te recomendamos talle/)).toBeVisible();
    expect(errores).toEqual([]);
  });

  test("armá tu outfit: talle y presupuesto → outfits → al carrito", async ({ page }) => {
    const errores = vigilar(page);
    await page.goto("/outfits");
    await page.getByRole("button", { name: "Mujer", exact: true }).click();
    await page.getByRole("button", { name: "M", exact: true }).click();
    await page.getByRole("button", { name: /100\.000/ }).click();
    await page.getByRole("button", { name: "Armar mis outfits" }).click();
    await expect(page.getByRole("heading", { name: /Te armamos \d+ outfits?/ })).toBeVisible();
    const primero = page.locator("li", { has: page.getByRole("button", { name: "Agregar todo al carrito" }) }).first();
    await expect(primero.getByText("Arriba", { exact: true })).toBeVisible();
    await expect(primero.getByText("Abajo", { exact: true })).toBeVisible();
    await primero.getByRole("button", { name: "Agregar todo al carrito" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    // Sin plata suficiente, dice desde cuánto hay.
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Abrigo", exact: true }).click();
    await page.getByLabel("Presupuesto en pesos").fill("1500");
    await page.getByRole("button", { name: "Armar mis outfits" }).click();
    await expect(page.getByText("Con ese presupuesto no llegamos")).toBeVisible();
    expect(errores).toEqual([]);
  });
});

test.describe("backoffice", () => {
  test.skip(({ isMobile }) => isMobile, "El backoffice se prueba en escritorio");
  test.describe.configure({ mode: "serial" });
  const EMAIL = "e2e-admin@isuwaya.test";
  let clave = "";
  let codigo: (s: string, paso: number) => string;
  /* El mismo comando que usa el dueño (pnpm admin:crear): usuario nuevo o restablecido, con clave provisoria. */
  const crear = () => {
    const salida = spawnSync("node", ["--env-file-if-exists=.env", "apps/api/dist/cli/crear-admin.js", EMAIL, "Admin E2E"], { cwd: RAIZ, encoding: "utf8" }).stderr;
    clave = /provisoria: (\S+)/.exec(salida)![1]!;
  };

  // Ojo: el beforeAll corre también en el proyecto "celular" (el skip es por prueba):
  // ahí no se toca el usuario, o le cambiaría la clave al de escritorio en plena prueba.
  // eslint-disable-next-line no-empty-pattern -- Playwright exige desestructurar el primer argumento
  test.beforeAll(async ({}, info) => {
    if (info.project.name !== "escritorio") return;
    ({ codigo } = await import(pathToFileURL(path.join(RAIZ, "apps/api/dist/lib/totp.js")).href));
  });

  async function ingresar(page: Page) {
    crear();
    await page.goto(`${ADMIN}/`);
    await expect(page).toHaveURL(/\/ingresar/);
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Contraseña").fill(clave);
    await page.getByRole("button", { name: "Continuar" }).click();
    await page.getByText("No puedo escanear").click();
    const secreto = (await page.locator("code").innerText()).replace(/\s/g, "");
    await page.getByLabel("Código de 6 números").fill(codigo(secreto, Math.floor(Date.now() / 30_000)));
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page).toHaveURL(/cambiar-clave/);
    await page.getByLabel("Contraseña provisoria").fill(clave);
    await page.getByRole("textbox", { name: /^Contraseña nueva/ }).fill("frase larga para la prueba e2e");
    await page.getByLabel("Repetí la contraseña nueva").fill("frase larga para la prueba e2e");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText("Para atender")).toBeVisible();
  }

  test("sin sesión no se ve nada; la clave provisoria no sirve para operar", async ({ request }) => {
    const r = await request.get(`${ADMIN}/api/a/productos`);
    expect(r.status()).toBe(401);
    // CSRF: sin cabecera ni origen propio, ni llega a la API.
    const p = await request.post(`${ADMIN}/api/a/ingresar`, { data: { email: EMAIL, contrasena: clave } });
    expect(p.status()).toBe(403);
  });

  test("ingreso con doble factor, casilla Destacado → se ve en la tienda", async ({ page }) => {
    test.setTimeout(90_000);
    const errores = vigilar(page);
    await ingresar(page);
    await page.goto(`${ADMIN}/productos?q=Short%20Biker`);
    const casilla = page.getByRole("checkbox", { name: "destacado Short Biker Lycra" });
    await expect(casilla).toBeVisible();
    // Si una corrida anterior se cortó a la mitad, se arranca de cero.
    if (await casilla.isChecked()) { await casilla.uncheck(); await expect(casilla).not.toBeChecked(); await page.waitForTimeout(1500); }
    await casilla.check();
    // Se guarda al instante y la tienda regenera /destacados.
    await expect(async () => {
      await page.goto("/destacados");
      await expect(page.getByRole("link", { name: "Short Biker Lycra" })).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 20_000 });
    await page.goto(`${ADMIN}/productos?q=Short%20Biker`);
    await casilla.uncheck();
    await expect(casilla).not.toBeChecked();
    expect(errores).toEqual([]);
  });

  test("editor de guías: crear una de niños, ver qué productos coinciden, borrarla", async ({ page }) => {
    test.setTimeout(90_000);
    await ingresar(page);
    await page.goto(`${ADMIN}/guias-talles/nueva`);
    await page.getByRole("button", { name: "Crear guía" }).click();
    await expect(page.getByText(/Poné un nombre/)).toBeVisible();
    await page.getByLabel("Nombre").fill(`E2E niños ${Date.now()}`);
    await page.getByRole("button", { name: "Niños (4 a 16)" }).click();
    for (const [t, desde] of [["4", "98"], ["6", "110"], ["8", "122"], ["10", "134"], ["12", "146"], ["14", "152"]]) {
      await page.getByLabel(`${t} Altura desde`, { exact: true }).fill(desde!);
      await page.getByLabel(`${t} Altura hasta`, { exact: true }).fill(String(Number(desde) + 6));
    }
    await page.getByRole("button", { name: "Crear guía" }).click();
    await expect(page.getByRole("heading", { name: "Asociar productos" })).toBeVisible();
    // Los de niños (talles 4 a 14) coinciden; los de adulto no aparecen.
    const lista = page.locator("section", { has: page.getByRole("heading", { name: "Asociar productos" }) });
    await expect(lista.getByText("Remera Estampada Niños")).toBeVisible();
    await expect(lista.getByText("Remera Oversize Algodón Peinado")).toHaveCount(0);
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Borrar" }).click();
    await expect(page).toHaveURL(/\/guias-talles$/);
  });
});
