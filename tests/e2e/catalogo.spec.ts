import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { APIRequestContext } from "@playwright/test";
import { expect, test, verResumen, type Page } from "./base";
const API = process.env.API_URL ?? "http://127.0.0.1:4000";
const escapar = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/*
 * Catálogo (etapa 1), contra el catálogo de muestra:
 *   pnpm demo:stocker   (Stocker simulado)   +   worker + API + web levantados
 *   pnpm demo:fotos     (fotos de muestra)
 *
 * La prueba de "venta en el local" usa el simulador (STOCKER_SIMULADO_URL):
 * baja el stock en "Stocker" y espera ver el cambio en la tienda sin tocar nada.
 */
const SIM = process.env.STOCKER_SIMULADO_URL ?? "http://127.0.0.1:3900";

function vigilar(page: Page) {
  const errores: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" && !/status of 404/.test(m.text())) errores.push(m.text()); });
  // Chromium marca como "cortada" la respuesta 204 (sin contenido) de un fetch, como /api/t/cuenta sin sesión: no es un error.
  page.on("requestfailed", async (r) => {
    if (/_rsc=|google/.test(r.url()) || (await r.response().catch(() => null))?.status() === 204) return;
    errores.push(`falló ${r.url()}: ${r.failure()?.errorText}`);
  });
  page.on("pageerror", (e) => errores.push(String(e)));
  return errores;
}
const sinScrollHorizontal = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test.describe("grilla", () => {
  test("una categoría muestra sus prendas con foto, precio y transferencia", async ({ page }) => {
    const errores = vigilar(page);
    await page.goto("/mujer");
    const tarjetas = page.locator("main article");
    await expect(tarjetas).toHaveCount(8);
    const primera = tarjetas.first();
    await expect(primera.locator("img").first()).toBeVisible();
    await expect.poll(() => primera.locator("img").first().evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
    await expect(primera.getByText(/con transferencia/)).toBeVisible();
    expect(await sinScrollHorizontal(page)).toBe(true);
    expect(errores).toEqual([]);
  });

  test("filtrar por talle y color, ordenar por precio; queda en la URL", async ({ page }) => {
    await page.goto("/hombre");
    const antes = await page.locator("main article").count();
    await page.getByRole("button", { name: /^Filtrar/ }).click();
    await page.getByRole("button", { name: "46", exact: true }).click();
    await expect(page.locator("main article")).toHaveCount(1);
    await expect(page).toHaveURL(/talle=46/);
    await page.getByRole("button", { name: "Limpiar filtros" }).click();
    await expect(page.locator("main article")).toHaveCount(antes);
    await page.getByLabel(/Ordenar/).selectOption("precio");
    // El precio que se cobra: en una prenda rebajada, el de antes va tachado arriba.
    const n = await page.locator("main article").evaluateAll((tarjetas) => tarjetas.map((a) => {
      const p = [...a.querySelectorAll("h3 ~ div > p")].find((x) => !x.querySelector("s"));
      return Number((p?.textContent ?? "").replace(/\D/g, ""));
    }));
    expect(n).toEqual([...n].sort((a, b) => a - b));
    await expect(page).toHaveURL(/orden=precio/);
    // Un enlace con filtros abre ya filtrado.
    await page.goto("/hombre?talle=46");
    await expect(page.locator("main article")).toHaveCount(1);
  });

  test("tocar un color en la tarjeta cambia la foto y lleva a la ficha con ese color", async ({ page }) => {
    await page.goto("/mujer/remeras-y-tops");
    const tarjeta = page.locator("main article", { hasText: "Remera Oversize" });
    const antes = await tarjeta.locator("img").first().getAttribute("src");
    await tarjeta.getByRole("button", { name: /^Blanco/ }).click();
    await expect.poll(() => tarjeta.locator("img").first().getAttribute("src")).not.toBe(antes);
    await tarjeta.getByRole("link", { name: "Remera Oversize Algodón Peinado" }).click();
    await expect(page).toHaveURL(/\/producto\/remera-oversize-algodon-peinado\?color=blanco/);
    await expect(page.getByText("Color: Blanco")).toBeVisible();
  });

  test("el inicio muestra lo nuevo", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Nuevos y en reposición" })).toBeVisible();
    expect(await page.locator("main article").count()).toBeGreaterThan(0);
  });
});

test.describe("ficha sin stock", () => {
  // Agota un color de una prenda (base de datos), espera a que la API lo vea, regenera la ficha y al final devuelve el stock.
  const RAIZ = process.env.RAIZ ?? process.cwd();
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- el .env del propio repo
  const ENV = readFileSync(path.join(RAIZ, ".env"), "utf8");
  const delEnv = (k: string) => process.env[k] ?? ENV.split("\n").find((l) => l.startsWith(`${k}=`))?.slice(k.length + 1).trim() ?? "";
  function sql<T = Record<string, unknown>>(q: string, params: unknown[] = []): T[] {
    const r = spawnSync("node", ["--env-file=../../.env", "-e",
      `const pg=require("pg");const c=new pg.Client(process.env.DATABASE_URL);c.connect().then(()=>c.query(${JSON.stringify(q)},${JSON.stringify(params)})).then((r)=>{console.log(JSON.stringify(r.rows));return c.end()}).catch((e)=>{console.error(e.message);process.exit(1)})`],
    { cwd: path.join(RAIZ, "apps/api"), encoding: "utf8" });
    if (r.status !== 0) throw new Error(`sql: ${r.stderr}`);
    return JSON.parse(r.stdout || "[]") as T[];
  }
  const revalidar = (request: APIRequestContext, slug: string) =>
    request.post("/api/revalidar", { headers: { authorization: `Bearer ${delEnv("REVALIDAR_TOKEN")}`, "content-type": "application/json" }, data: { etiquetas: [`producto:${slug}`] } });

  test("un color sin stock: «Sin stock» y la consulta por WhatsApp con la prenda y el color", async ({ page, request }, info) => {
    test.skip(info.project.name === "celular", "cambia el stock de una prenda: una vez alcanza");
    test.setTimeout(120_000);
    const SLUG = "buzo-crop-friza";
    const detalle = async () => await (await request.get(`${API}/v1/productos/${SLUG}`)).json() as { colores: Array<{ clave: string; nombre: string }>; variantes: Array<{ color: string | null; stock: number }> };
    const color = (await detalle()).colores.filter((c) => c.nombre !== "Único").at(-1)!;
    const antes = sql<{ id: number; stock: number }>(
      `SELECT v.id, v.stock FROM tienda.variantes v JOIN tienda.productos p ON p.id = v.producto_id JOIN tienda.producto_colores c ON c.id = v.color_id
        WHERE p.slug = $1 AND c.clave = $2`, [SLUG, color.clave]);
    expect(antes.length).toBeGreaterThan(0);
    try {
      sql("UPDATE tienda.variantes SET stock = 0 WHERE id = ANY($1::int[])", [antes.map((v) => v.id)]);
      await expect.poll(async () => (await detalle()).variantes.some((v) => v.color === color.clave && v.stock > 0), { timeout: 45_000, intervals: [2000] }).toBe(false);
      expect((await revalidar(request, SLUG)).ok()).toBe(true);
      await page.goto(`/producto/${SLUG}`);
      await page.getByRole("button", { name: new RegExp(`^${escapar(color.nombre)}`) }).first().click();
      await expect(page.getByText("Sin stock en este color")).toBeVisible();
      await expect(page.getByRole("button", { name: "Sin stock" })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Agregar al carrito" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Comprar ahora" })).toHaveCount(0);
      const href = decodeURIComponent((await page.getByRole("link", { name: "Consultar por WhatsApp" }).getAttribute("href")) ?? "");
      expect(href).toContain("wa.me/5491168515444");
      expect(href).toContain("Buzo Crop Friza");
      expect(href).toContain(`Color: ${color.nombre}`);
    } finally {
      for (const v of antes) sql("UPDATE tienda.variantes SET stock = $2 WHERE id = $1", [v.id, v.stock]);
      await revalidar(request, SLUG);
    }
  });
});

test.describe("ficha de producto", () => {
  test("con stock: agregar o comprar ya (sin WhatsApp); «Comprar ahora» va directo al checkout", async ({ page }) => {
    const errores = vigilar(page);
    await page.goto("/producto/buzo-canguro-frisa-premium");
    await expect(page.locator("h1")).toHaveText("Buzo Canguro Frisa Premium");
    await page.getByRole("button", { name: /^Gris Melange/ }).click();
    await expect(page.getByText("Color: Gris Melange")).toBeVisible();
    await expect(page.getByRole("button", { name: "Agregar al carrito" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Consultar por WhatsApp" })).toHaveCount(0);
    // Sin talle, avisa.
    await page.getByRole("button", { name: "Comprar ahora" }).click();
    await expect(page.getByText("Elegí un talle para agregarlo.")).toBeVisible();
    const talle = page.locator("fieldset", { hasText: "Talle" }).getByRole("button", { disabled: false }).first();
    await talle.click();
    await page.getByRole("button", { name: "Comprar ahora" }).click();
    await expect(page).toHaveURL(/\/checkout$/);
    await verResumen(page);
    await expect(page.getByRole("list", { name: "Prendas del pedido" })).toContainText("Buzo Canguro Frisa Premium");
    expect(await sinScrollHorizontal(page)).toBe(true);
    expect(errores).toEqual([]);
  });

  test("talles sin stock deshabilitados; la foto cambia con el color", async ({ page }) => {
    await page.goto("/producto/remera-oversize-algodon-peinado");
    const deshabilitados = page.locator("fieldset", { hasText: "Talle" }).locator("button[disabled]");
    expect(await deshabilitados.count()).toBeGreaterThan(0);
    const primera = () => page.locator('section[aria-label="Fotos"] img').first().getAttribute("src");
    const antes = await primera();
    await page.getByRole("button", { name: /^Verde Militar/ }).click();
    await expect.poll(primera).not.toBe(antes);
  });

  test("datos estructurados de producto válidos", async ({ page }) => {
    await page.goto("/producto/jogger-rustico-puno");
    const bloques = await page.locator('script[type="application/ld+json"]').allTextContents();
    // Etapa 7: un ProductGroup con una variante por talle y color, cada una con su oferta.
    const producto = bloques.map((b) => JSON.parse(b)).find((d) => d["@type"] === "ProductGroup");
    expect(producto).toMatchObject({ name: "Jogger Rústico Puño", productGroupID: "ISU-3001", brand: { name: "Isuwaya" } });
    expect(producto.hasVariant.length).toBeGreaterThan(1);
    expect(producto.hasVariant[0].offers).toMatchObject({ priceCurrency: "ARS", itemCondition: "https://schema.org/NewCondition" });
    expect(Number(producto.hasVariant[0].offers.price)).toBeGreaterThan(0);
    expect(producto.image.length).toBeGreaterThan(0);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/producto\/jogger-rustico-puno$/);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /-1200\.webp$/);
  });
});

test.describe("búsqueda", () => {
  test("desde el header, sin tildes, y sin resultados sugiere categorías", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("banner").getByRole("link", { name: "Buscar" }).click();
    await page.getByRole("searchbox").fill("pantalon cargo");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/buscar\?q=pantalon\+cargo/);
    await expect(page.locator("main article")).toHaveCount(1);
    await expect(page.locator("main article")).toContainText("Pantalón Cargo");
    await page.goto("/buscar?q=zzzzz");
    await expect(page.getByText(/No encontramos prendas/)).toBeVisible();
    await expect(page.locator("main").getByRole("link", { name: "Mujer" })).toBeVisible();
  });
  test("lo que se escribe no se ejecuta", async ({ page }) => {
    let alerta = false;
    page.on("dialog", async (d) => { alerta = true; await d.dismiss(); });
    await page.goto(`/buscar?q=${encodeURIComponent('"><img src=x onerror=alert(1)>')}`);
    await expect(page.locator("h1")).toContainText('"><img src=x onerror=alert(1)>');
    expect(alerta).toBe(false);
  });
});

test.describe("404", () => {
  for (const ruta of ["/esto-no-existe", "/mujer/no-existe", "/producto/no-existe", "/a/b/c/d", "/producto/Mal_Slug"]) {
    test(`${ruta} → 404 con salida`, async ({ page }) => {
      const r = await page.goto(ruta);
      expect(r?.status()).toBe(404);
      await expect(page.getByRole("heading", { name: "No encontramos esta página" })).toBeVisible();
      await expect(page.getByRole("searchbox")).toBeVisible();
      const robots = await page.locator('meta[name="robots"]').evaluateAll((ms) => ms.map((m) => m.getAttribute("content")));
      expect(robots.some((r) => /noindex/.test(r ?? ""))).toBe(true);
    });
  }
});

test.describe("tiempo real", () => {
  test("una venta en el local agota la prenda en la tienda sin intervención", async ({ page, request }, info) => {
    test.skip(info.project.name !== "escritorio", "una sola vez: modifica el stock");
    test.setTimeout(60_000);
    // Buscar una variante con stock en la ficha, y venderla toda en "Stocker".
    const detalle = await (await request.get(`${process.env.API_URL ?? "http://127.0.0.1:4000"}/v1/productos/short-biker-lycra`)).json();
    const v = detalle.variantes.find((x: { stock: number }) => x.stock > 0);
    test.skip(!v, "sin stock para vender");
    await page.goto("/producto/short-biker-lycra");
    const r = await request.post(`${SIM}/__vender`, { data: { sku: v.sku, cantidad: 1000 } });
    expect(r.ok()).toBe(true);
    // Stocker avisa → worker pide el stock → API y página se regeneran.
    await expect.poll(async () => {
      await page.reload();
      const nombreColor = detalle.colores.find((c: { clave: string }) => c.clave === v.color).nombre;
      const colorBtn = page.locator("fieldset", { hasText: "Color" }).getByRole("button", { name: nombreColor });
      await colorBtn.click();
      return page.locator("fieldset", { hasText: "Talle" }).getByRole("button", { name: v.talle, exact: true }).isDisabled();
    }, { timeout: 30_000, intervals: [1000] }).toBe(true);
  });
});
