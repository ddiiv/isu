import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, type Page } from "./base";

/*
 * SEO: lo que lee Google, contra la tienda levantada.
 *
 *   · Las direcciones de la tienda anterior (Jumpseller) redirigen con 301.
 *   · Fichas con ProductGroup (variantes con precio y stock), migas, canónica.
 *   · Sitemap con fotos y feed de Google Shopping.
 *   · Backoffice: una redirección nueva y el texto de una categoría se ven en
 *     la tienda enseguida.
 */
const RAIZ = process.env.RAIZ ?? process.cwd();
const ADMIN = process.env.ADMIN_URL ?? "http://127.0.0.1:3001";
const ld = (html: string) =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => { const d = JSON.parse(m[1]!); return Array.isArray(d) ? d : [d]; });

test.describe("SEO", () => {
  test("las direcciones viejas redirigen con 301 a su página nueva", async ({ request, page }) => {
    for (const [vieja, nueva] of [["/contact", "/locales"], ["/minorista/hombre/remeras", "/hombre/remeras"], ["/politica-de-reembolso", "/devoluciones"], ["/Minorista/Hombre/Remeras/", "/hombre/remeras"]]) {
      const r = await request.get(vieja!, { maxRedirects: 0 });
      expect([301, 308], vieja).toContain(r.status());
      // La barra final la saca Next primero (308); después, la nuestra (301).
      const destino = r.status() === 308 ? await request.get(new URL(r.headers().location!, "http://x").pathname, { maxRedirects: 0 }) : r;
      expect(destino.status(), vieja).toBe(301);
      expect(new URL(destino.headers().location!, "http://x").pathname).toBe(nueva);
    }
    // Lo que viene de una campaña se conserva.
    const r = await request.get("/contact?utm_source=ig", { maxRedirects: 0 });
    expect(new URL(r.headers().location!, "http://x").search).toBe("?utm_source=ig");
    // Una dirección que nunca existió sigue dando 404 (no se manda todo al inicio).
    expect((await request.get("/esto-nunca-existio", { maxRedirects: 0 })).status()).toBe(404);
    // En el navegador: se llega a la página.
    await page.goto("/contact");
    await expect(page).toHaveURL(/\/locales$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Nuestros locales");
  });

  test("sitemap con fotos, robots y feed de Google Shopping", async ({ request }) => {
    const robots = await (await request.get("/robots.txt")).text();
    expect(robots).toMatch(/Sitemap: .*\/sitemap\.xml/);
    const sitemap = await (await request.get("/sitemap.xml")).text();
    expect(sitemap).toContain("/producto/");
    expect(sitemap).toContain("<image:loc>");
    const feed = await request.get("/feed/google.xml");
    expect(feed.headers()["content-type"]).toContain("xml");
    const xml = await feed.text();
    expect(xml).toContain("<g:item_group_id>");
    expect(xml).toMatch(/<g:price>\d+\.\d{2} ARS<\/g:price>/);
  });

  test("ficha: ProductGroup con variantes, migas, canónica y descripción", async ({ request }) => {
    const sitemap = await (await request.get("/sitemap.xml")).text();
    const ficha = new URL(sitemap.match(/<loc>([^<]*\/producto\/[^<]+)<\/loc>/)![1]!).pathname;
    const html = await (await request.get(ficha)).text();
    const datos = ld(html);
    const prod = datos.find((d) => d["@type"] === "ProductGroup" || d["@type"] === "Product");
    expect(prod, ficha).toBeTruthy();
    const ofertas = prod.hasVariant ? prod.hasVariant.map((v: { offers: unknown }) => v.offers) : [prod.offers];
    for (const o of ofertas) {
      expect(o).toMatchObject({ priceCurrency: "ARS", itemCondition: "https://schema.org/NewCondition" });
      expect(o.price).toMatch(/^\d+\.\d{2}$/);
      expect(o.hasMerchantReturnPolicy.merchantReturnDays).toBe(30);
    }
    expect(datos.some((d) => d["@type"] === "BreadcrumbList")).toBe(true);
    expect(html.match(/<link rel="canonical" href="([^"]+)"/)?.[1]).toMatch(/\/producto\/[a-z0-9-]+$/);
    expect(new URL(html.match(/<link rel="canonical" href="([^"]+)"/)![1]!).pathname).toBe(ficha);
    const desc = html.match(/<meta name="description" content="([^"]+)"/)![1]!;
    expect(desc.length).toBeGreaterThan(50);
    expect(desc.length).toBeLessThanOrEqual(170);
  });

  test("inicio: nombre del sitio y datos de la marca; locales con dirección", async ({ request }) => {
    const inicio = ld(await (await request.get("/")).text());
    expect(inicio.find((d) => d["@type"] === "WebSite")?.name).toBe("Isuwaya");
    expect(inicio.find((d) => d["@type"] === "OnlineStore")?.hasMerchantReturnPolicy).toBeTruthy();
    const locales = ld(await (await request.get("/locales")).text()).filter((d) => d["@type"] === "ClothingStore");
    expect(locales.length).toBeGreaterThan(0);
    expect(locales[0].address.addressCountry).toBe("AR");
  });
});

test.describe("SEO en el backoffice", () => {
  test.skip(({ isMobile }) => isMobile, "El backoffice se prueba en escritorio");
  const EMAIL = "e2e-seo@isuwaya.test";

  async function ingresar(page: Page) {
    const salida = spawnSync("node", ["--env-file-if-exists=.env", "apps/api/dist/cli/crear-admin.js", EMAIL, "SEO E2E"], { cwd: RAIZ, encoding: "utf8" }).stderr;
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
    await page.getByRole("textbox", { name: /^Contraseña nueva/ }).fill("frase larga para seo e2e");
    await page.getByLabel("Repetí la contraseña nueva").fill("frase larga para seo e2e");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText("Para atender")).toBeVisible();
  }

  test("una redirección nueva y el texto de una categoría llegan a la tienda al toque", async ({ page, request }) => {
    const errores: string[] = [];
    page.on("pageerror", (e) => errores.push(String(e)));
    const vieja = `/e2e-vieja-${Date.now().toString(36)}`;
    await ingresar(page);

    await page.getByRole("link", { name: "Redirecciones" }).first().click();
    await expect(page.getByText("/minorista/hombre/remeras")).toBeVisible();
    await page.getByRole("button", { name: "Nueva redirección" }).click();
    await page.getByLabel("Dirección vieja").fill(`https://www.isuwaya.com${vieja.toUpperCase()}/`);
    await page.getByLabel("A dónde manda").fill("https://otro-sitio.com/locales");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText("Guardada. Ya la usa la tienda.")).toBeVisible();
    await page.getByLabel("Buscar").fill(vieja);
    await expect(page.getByText(`→ /locales`)).toBeVisible();
    // La tienda la usa sin esperar los 5 minutos (el worker le avisa).
    await expect.poll(async () => (await request.get(vieja, { maxRedirects: 0 })).headers().location ?? "", { timeout: 15_000 }).toMatch(/\/locales$/);

    // Borrarla: vuelve a dar 404.
    page.once("dialog", (d) => d.accept());
    await page.getByRole("listitem").filter({ hasText: vieja }).getByRole("button", { name: "Borrar" }).click();
    await expect(page.getByText("Borrada.")).toBeVisible();
    await expect.poll(async () => (await request.get(vieja, { maxRedirects: 0 })).status(), { timeout: 15_000 }).toBe(404);

    // Texto de la categoría: aparece abajo de la grilla.
    const texto = `Remeras, buzos y pantalones de mujer (${Date.now()}).`;
    await page.getByRole("link", { name: "Categorías" }).first().click();
    await page.getByRole("listitem").filter({ hasText: "/mujer" }).first().getByRole("button", { name: "Editar" }).first().click();
    await page.getByLabel("Texto de la categoría").fill(`${texto}\n\nSegundo párrafo.`);
    await expect(page.getByLabel("Así se ve en Google")).toBeVisible();
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText("Categoría guardada.")).toBeVisible();
    await expect.poll(async () => (await (await request.get("/mujer")).text()).includes(texto), { timeout: 15_000 }).toBe(true);
    // Dejarla como estaba.
    await page.getByRole("listitem").filter({ hasText: "/mujer" }).first().getByRole("button", { name: "Editar" }).first().click();
    await page.getByLabel("Texto de la categoría").fill("");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText("Categoría guardada.")).toBeVisible();
    expect(errores).toEqual([]);
  });
});
