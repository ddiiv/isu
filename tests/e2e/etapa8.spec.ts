import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, type Page } from "./base";

/*
 * Etapa 8 en un navegador real:
 *
 *   · el inicio completo: carrusel de la portada, packs, pestañas por
 *     categoría y lo que dicen quienes compraron;
 *   · el pack: elegir la cantidad cambia la dirección (pack-x3-…), cada
 *     prenda con su talle y color, y el carrito cobra el % del pack;
 *   · la ficha con su descripción y sus opiniones;
 *   · una opinión de punta a punta: pedido entregado → enlace del mail →
 *     opinar → el backoffice la publica → se ve en la ficha.
 *
 * Usa los datos de muestra de pnpm demo:backoffice (packs, opiniones y banners).
 */
const RAIZ = process.env.RAIZ ?? process.cwd();
const ADMIN = process.env.ADMIN_URL ?? "http://127.0.0.1:3001";
const API = process.env.API_URL ?? "http://127.0.0.1:4000";
// eslint-disable-next-line security/detect-non-literal-fs-filename -- el .env del propio repo
const ENV = readFileSync(path.join(RAIZ, ".env"), "utf8");
const delEnv = (k: string) => process.env[k] ?? ENV.split("\n").find((l) => l.startsWith(`${k}=`))?.slice(k.length + 1).trim() ?? "";
const INTERNO = delEnv("INTERNO_TOKEN");
const PACK = "remera-basica-cuello-redondo";

function vigilar(page: Page) {
  const errores: string[] = [];
  page.on("pageerror", (e) => errores.push(e.message));
  return errores;
}

test.describe("inicio", () => {
  test("carrusel, packs, pestañas y opiniones al final", async ({ page }) => {
    const errores = vigilar(page);
    await page.goto("/");
    const carrusel = page.locator('section[aria-roledescription="carrusel"]');
    await expect(carrusel).toBeVisible();
    // Etapa 12: el banner de foto sola (con su descripción) y los de texto conviven.
    await expect(carrusel.getByRole("img", { name: /\(demo\)/ }).first()).toBeAttached();
    const packs = page.locator("section", { has: page.getByRole("heading", { name: "Llevá más, pagá menos" }) });
    await expect(packs.getByText(/Elegí de 2 a 10 unidades/).first()).toBeVisible();
    // Las tarjetas de la sección llevan a la página del pack.
    await expect(packs.locator(`a[href="/producto/pack-x2-${PACK}"]`).first()).toBeAttached();
    // Pestañas: Mujer muestra prendas de mujer.
    await page.getByRole("tab", { name: "Mujer" }).click();
    await expect(page.getByRole("tabpanel")).toBeVisible();
    await expect(page.getByRole("link", { name: /Ver todo Mujer/ })).toBeVisible();
    // Al final, lo que dicen quienes compraron (con el promedio de todas).
    const opiniones = page.locator("section", { has: page.getByRole("heading", { name: "Lo que dicen quienes compraron" }) });
    await expect(opiniones).toContainText("compras verificadas");
    await expect(opiniones.getByText(/Compra verificada/).first()).toBeVisible();
    expect(errores).toEqual([]);
  });
});

test.describe("packs", () => {
  test("la cantidad cambia la dirección, cada prenda con su talle y color, y el carrito cobra el pack", async ({ page }, info) => {
    test.skip(info.project.name === "celular", "el mismo flujo; alcanza en escritorio");
    const errores = vigilar(page);
    await page.goto("/packs");
    await page.locator(`a[href="/producto/pack-x2-${PACK}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`/producto/pack-x2-${PACK}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Pack x2 /);
    await page.getByRole("button", { name: /^3 unidades/ }).click();
    await expect(page).toHaveURL(new RegExp(`/producto/pack-x3-${PACK}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Pack x3 /);
    // Sin elegir todo, avisa qué falta.
    await page.getByRole("button", { name: "Agregar pack x3 al carrito" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "prenda 1" })).toBeVisible();
    for (let i = 1; i <= 3; i++) {
      const prenda = page.locator(`#prenda-${i}`);
      if (i === 3) await prenda.getByRole("button", { name: "Igual a la anterior" }).click();
      else {
        await prenda.getByRole("group", { name: /Talle/ }).getByRole("button").first().click();
        await prenda.getByRole("group", { name: /Color/ }).getByRole("button").nth(i - 1).click();
      }
      await expect(prenda.getByText(/^✓/)).toBeVisible();
    }
    await page.getByRole("button", { name: "Agregar pack x3 al carrito" }).click();
    const cajon = page.getByRole("dialog");
    // Etapa 10: el pack es UNA línea, con lo que lleva y su %.
    const linea = cajon.locator("li", { has: page.getByRole("list", { name: /Qué lleva el pack Pack x3/ }) });
    await expect(linea.getByText("📦 Pack · −15%")).toBeVisible({ timeout: 15_000 });
    await expect(linea.getByRole("list", { name: /Qué lleva el pack/ }).getByRole("listitem")).not.toHaveCount(0);
    // El total del carrito es el de la página del pack.
    const total = (await page.getByText("Total del pack").locator("..").locator("p").nth(1).innerText()).trim();
    await expect(linea.getByText(total).first()).toBeVisible();
    // La misma prenda suelta va aparte, a su precio: no suma para el pack.
    await page.keyboard.press("Escape");
    await page.goto(`/producto/${PACK}`);
    await page.locator("html[data-hidratado]").waitFor({ state: "attached" });
    await page.locator("fieldset", { hasText: "Talle" }).getByRole("button", { disabled: false }).first().click();
    await page.getByRole("button", { name: "Agregar al carrito" }).click();
    // Dos líneas: el pack (con su −15%) y la suelta (sin descuento de pack).
    await expect(cajon.locator("ul.divide-y > li")).toHaveCount(2, { timeout: 15_000 });
    await expect(cajon.getByText("📦 Pack · −15%")).toHaveCount(1);
    await expect(cajon.locator("ul.divide-y > li").filter({ hasNotText: "Pack x3" }).getByRole("link", { name: /^Remera Básica/ }).first()).toBeVisible();
    expect(errores).toEqual([]);
  });

  test("una prenda que no se vende en pack manda a su ficha", async ({ page }) => {
    await page.goto("/producto/pack-x3-jogger-rustico-puno");
    await expect(page).toHaveURL(/\/producto\/jogger-rustico-puno$/);
  });
});

test.describe("ficha", () => {
  test("descripción, composición y opiniones (y las estrellas para Google)", async ({ page }) => {
    await page.goto("/producto/remera-oversize-algodon-peinado");
    await expect(page.locator("details[open]").getByText(/Remera Oversize Algodón Peinado/).first()).toBeVisible();
    await page.getByText("Composición y cuidados").click();
    await expect(page.getByText(/100% algodón jersey/)).toBeVisible();
    const opiniones = page.locator("#opiniones");
    await expect(opiniones.getByRole("heading", { name: "Opiniones" })).toBeVisible();
    await expect(opiniones.getByText("Compra verificada").first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Ver las \d+ opiniones/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Armar pack/ })).toHaveAttribute("href", "/producto/pack-x2-remera-oversize-algodon-peinado");
    const ld = await page.locator('script[type="application/ld+json"]').allInnerTexts();
    expect(ld.join("")).toContain("AggregateRating");
  });
});

test.describe("opinar de una compra", () => {
  test("enlace del mail → opinar → el backoffice la publica → se ve en la ficha", async ({ page, request }, info) => {
    test.skip(info.project.name === "celular", "el mismo flujo; alcanza en escritorio");
    test.setTimeout(120_000);
    const errores = vigilar(page);
    // Un pedido para retirar en el local, cobrado y retirado.
    const config = await (await request.get(`${API}/v1/config`)).json() as { locales: Array<{ nombre: string; retiro: boolean }> };
    const local = config.locales.find((l) => l.retiro)!.nombre;
    const ficha = await (await request.get(`${API}/v1/productos/top-deportivo-ribb`)).json() as { variantes: Array<{ sku: string; stock: number }> };
    const sku = ficha.variantes.find((v) => v.stock > 0)!.sku;
    const nuevo = await request.post(`${API}/v1/pedidos`, {
      data: {
        items: [{ sku, cantidad: 1 }], medioPago: "local", aceptaTerminos: true,
        contacto: { email: `e2e-opinar-${Date.now()}@test.com`, nombre: "Carla", apellido: "Opina", telefono: "11 5555 1234", dni: "30111222" },
        entrega: { tipo: "retiro", local },
      },
    });
    expect(nuevo.status(), await nuevo.text()).toBe(201);
    const { numero } = await nuevo.json() as { numero: string };
    const { firmaOpinar } = await import(pathToFileURL(path.join(RAIZ, "packages/envios/dist/firma.js")).href) as { firmaOpinar: (n: string, s: string) => string };
    const enlace = `/opinar/${numero}?t=${firmaOpinar(numero, INTERNO)}&e=5`;

    // Todavía no lo retiró: no puede opinar.
    await page.goto(enlace);
    await expect(page.getByRole("alert").filter({ hasText: "cuando te llegue el pedido" })).toBeVisible();
    // Una firma inventada no abre nada.
    await page.goto(`/opinar/${numero}?t=${"x".repeat(24)}`);
    await expect(page.getByRole("alert").filter({ hasText: "no es válido" })).toBeVisible();

    sql(`UPDATE tienda.pedidos SET estado = 'retirado' WHERE numero = '${numero}'`);
    await page.goto(enlace);
    await expect(page.getByRole("heading", { name: "¿Qué te pareció, Carla?" })).toBeVisible();
    // Las estrellas tocadas en el mail ya vienen marcadas.
    await expect(page.getByRole("radio", { name: /5 de 5/ }).first()).toHaveAttribute("aria-checked", "true");
    const texto = `Re cómodo para entrenar, prueba ${Date.now()}`;
    await page.getByRole("button", { name: "Justo" }).click();
    await page.getByPlaceholder("¿Cómo es la tela? ¿Para qué la usás?").fill(texto);
    await page.getByRole("radiogroup", { name: "Puntaje de la compra" }).getByRole("radio", { name: /4 de 5/ }).click();
    await page.getByRole("button", { name: "Enviar mi opinión" }).click();
    await expect(page.getByRole("heading", { name: "¡Gracias por contarnos!" })).toBeVisible();
    // Otra vez el mismo enlace: ya opinó de todo.
    await page.goto(enlace);
    await expect(page.getByRole("heading", { name: /Ya nos contaste todo/ })).toBeVisible();

    // Backoffice: la publica.
    await ingresar(page, `e2e-resenas-${Date.now()}@test.com`);
    await page.goto(`${ADMIN}/resenas`);
    const tarjeta = page.locator("li", { hasText: texto });
    await expect(tarjeta).toBeVisible();
    await tarjeta.getByRole("button", { name: "Publicar" }).click();
    await expect(page.getByText("Publicada: ya se ve en la tienda")).toBeVisible();

    // En la ficha (se regenera sola al publicar).
    await expect.poll(async () => {
      await page.goto("/producto/top-deportivo-ribb");
      return page.locator("#opiniones").innerText();
    }, { timeout: 30_000 }).toContain(texto);
    expect(errores).toEqual([]);
  });
});

/** SQL directo a la base de la prueba (lo que en la vida real hace el seguimiento del transporte). */
function sql(q: string) {
  const r = spawnSync("node", ["--env-file=../../.env", "-e", `const pg=require("pg");const c=new pg.Client(process.env.DATABASE_URL);c.connect().then(()=>c.query(${JSON.stringify(q)})).then(()=>c.end()).catch((e)=>{console.error(e.message);process.exit(1)})`], { cwd: path.join(RAIZ, "apps/api"), encoding: "utf8" });
  if (r.status !== 0) throw new Error(`sql: ${r.stderr}`);
}

async function ingresar(page: Page, email: string) {
  const salida = spawnSync("node", ["--env-file-if-exists=.env", "apps/api/dist/cli/crear-admin.js", email, "Reseñas E2E"], { cwd: RAIZ, encoding: "utf8" }).stderr;
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
  await page.getByRole("textbox", { name: /^Contraseña nueva/ }).fill("frase larga para la prueba de reseñas");
  await page.getByLabel("Repetí la contraseña nueva").fill("frase larga para la prueba de reseñas");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Para atender")).toBeVisible();
}
