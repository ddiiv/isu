import { expect, test, type Page } from "./base";

/*
 * Etapa 13: cómo se ve Isuwaya al buscarla en Google.
 *
 *   · el inicio con su título y la frase de debajo (qué es, para quién, condiciones);
 *   · las páginas que Google puede mostrar como accesos debajo del resultado
 *     (Mujer, Hombre, Contacto, Quiénes somos, Venta por mayor, Locales): cada
 *     una con su título, su descripción, su canónica y un h1, sin noindex;
 *   · Venta por mayor: el botón lleva a la tienda mayorista;
 *   · el pie y el menú del celular llegan a esas páginas, y están en el sitemap.
 */
const API = process.env.API_URL ?? "http://127.0.0.1:4000";

function vigilar(page: Page) {
  const errores: string[] = [];
  page.on("pageerror", (e) => errores.push(e.message));
  return errores;
}
const descripcion = (page: Page) => page.locator('meta[name="description"]').getAttribute("content");
const canonica = (page: Page) => page.locator('link[rel="canonical"]').getAttribute("href");

test("inicio: el título y la frase que muestra Google, y los datos de la marca", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Isuwaya · Ropa urbana y casual para todos tus días");
  const d = (await descripcion(page))!;
  expect(d).toMatch(/^Isuwaya — Tienda online de ropa .+ para .*mujer.* — Envíos a todo el país/);
  expect(d.length).toBeLessThanOrEqual(160);
  const datos = await page.locator('script[type="application/ld+json"]').allTextContents();
  const tienda = datos.flatMap((t) => [JSON.parse(t)].flat()).find((x) => x["@type"] === "OnlineStore");
  expect(tienda).toMatchObject({ name: "Isuwaya", slogan: "Prenditas para todos tus días", department: { "@type": "OnlineStore", name: "Isuwaya Mayorista", url: expect.stringMatching(/^https?:\/\//) } });
  expect(tienda.logo).toMatch(/\/icon\.png$/);
});

test("los accesos debajo del resultado: cada página con su título, descripción, canónica y un h1", async ({ page }) => {
  const errores = vigilar(page);
  const PAGINAS: Array<[string, string, RegExp]> = [
    ["/mujer", "Mujer", /^Explorá toda la ropa de mujer Isuwaya: /],
    ["/hombre", "Hombre", /^Explorá toda la ropa de hombre Isuwaya: /],
    ["/contacto", "Contacto", /^¿Necesitás ayuda\? WhatsApp \+54 /],
    ["/nosotros", "Quiénes somos", /^Somos Isuwaya: diseñamos y fabricamos/],
    ["/venta-por-mayor", "Venta por mayor", /^¿Tenés un local o revendés ropa\? Hacé tu pedido en la tienda mayorista/],
    ["/locales", "Nuestros locales", /^Locales de Isuwaya/],
  ];
  const titulos = new Set<string>();
  for (const [ruta, h1, frase] of PAGINAS) {
    const r = await page.goto(ruta);
    expect(r?.status(), ruta).toBe(200);
    await expect(page.locator("h1"), ruta).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 }), ruta).toHaveText(h1);
    const d = (await descripcion(page))!;
    expect(d, ruta).toMatch(frase);
    expect(d.length, ruta).toBeLessThanOrEqual(160);
    expect((await canonica(page))?.endsWith(ruta), ruta).toBe(true);
    await expect(page.locator('meta[name="robots"][content*="noindex"]'), ruta).toHaveCount(0);
    titulos.add(await page.title());
  }
  // Ningún título repetido.
  expect(titulos.size).toBe(PAGINAS.length);
  expect(errores).toEqual([]);
});

test("Venta por mayor: el botón lleva a la tienda mayorista para hacer el pedido", async ({ page, request }) => {
  const errores = vigilar(page);
  await page.goto("/venta-por-mayor");
  const boton = page.getByRole("link", { name: /Hacer mi pedido mayorista/ });
  await expect(boton).toBeVisible();
  await expect(boton).toHaveAttribute("href", "/mayorista");
  // /mayorista redirige a MAYORISTA_URL (la tienda mayorista), sin quedar en caché.
  const r = await request.get("/mayorista", { maxRedirects: 0 });
  expect(r.status()).toBe(302);
  expect(r.headers().location).toMatch(/^https?:\/\//);
  expect(r.headers()["cache-control"]).toContain("no-store");
  // Y la consulta por WhatsApp.
  await expect(page.getByRole("link", { name: "Escribinos" })).toHaveAttribute("href", /^https:\/\/wa\.me\/\d+$/);
  expect(errores).toEqual([]);
});

test("Contacto: WhatsApp, email (si hay) y los locales con su horario", async ({ page, request }) => {
  const config = await (await request.get(`${API}/v1/config`)).json() as { whatsapp: string; email: string | null; locales: Array<{ nombre: string; horario: string }> };
  await page.goto("/contacto");
  await expect(page.getByRole("link", { name: "Escribinos por WhatsApp" })).toHaveAttribute("href", `https://wa.me/${config.whatsapp}`);
  if (config.email) await expect(page.getByRole("link", { name: "Mandanos un email" })).toHaveAttribute("href", `mailto:${config.email}`);
  for (const l of config.locales) await expect(page.getByRole("heading", { level: 2, name: l.nombre })).toBeVisible();
  // (en la página; el pie también tiene uno)
  await expect(page.locator("#contenido").getByRole("link", { name: "Venta por mayor" })).toHaveAttribute("href", "/venta-por-mayor");
});

test("el pie (y el menú del celular) llegan a Quiénes somos, Contacto y Venta por mayor; están en el sitemap", async ({ page, request, isMobile }) => {
  await page.goto("/");
  const pie = page.getByRole("contentinfo");
  for (const [nombre, href] of [["Quiénes somos", "/nosotros"], ["Contacto", "/contacto"], ["Venta por mayor", "/venta-por-mayor"]]) {
    await expect(pie.getByRole("link", { name: nombre, exact: true }).first()).toHaveAttribute("href", href);
  }
  if (isMobile) {
    await page.getByRole("button", { name: "Abrir menú" }).click();
    const menu = page.getByRole("dialog", { name: "Menú" });
    await expect(menu.getByRole("link", { name: "Quiénes somos" })).toHaveAttribute("href", "/nosotros");
    await menu.getByRole("link", { name: "Contacto" }).click();
  } else {
    await pie.getByRole("link", { name: "Contacto", exact: true }).first().click();
  }
  await expect(page).toHaveURL(/\/contacto$/);
  const sitemap = await (await request.get("/sitemap.xml")).text();
  for (const p of ["/nosotros", "/contacto", "/venta-por-mayor"]) expect(sitemap).toContain(`${p}</loc>`);
});
