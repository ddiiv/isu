import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, type Page } from "./base";

/*
 * Video del producto en un navegador real:
 *
 *   · el backoffice lo sube como borrador (en la tienda no se ve), lo publica
 *     y ahí aparece segundo en las fotos de la ficha, sin sonido, y arranca solo;
 *   · se pausa con su botón; se descarga y se borra.
 *
 * Usa los datos de muestra (pnpm demo:fotos y demo:backoffice).
 */
const RAIZ = process.env.RAIZ ?? process.cwd();
const ADMIN = process.env.ADMIN_URL ?? "http://127.0.0.1:3001";
const API = process.env.API_URL ?? "http://127.0.0.1:4000";
const VIDEO = path.join(RAIZ, "tests/e2e/fixtures/video-vertical.mp4");

test("video del producto: borrador, publicado en la ficha, descarga y borrado", async ({ page }, info) => {
  test.skip(info.project.name === "celular", "el backoffice se prueba en la compu");
  test.setTimeout(150_000);
  const errores: string[] = [];
  page.on("pageerror", (e) => errores.push(e.message));

  // Un producto de muestra con fotos.
  const slugs = (await (await fetch(`${API}/v1/productos-slugs`)).json()) as Array<{ slug: string; fotos: string[] }>;
  const slug = slugs.find((s) => s.fotos.length)!.slug;

  await ingresar(page, `e2e-video-${Date.now()}@test.com`);
  await page.goto(`${ADMIN}/productos/${slug}`);
  const tarjeta = page.locator("section", { has: page.getByRole("heading", { name: "Video", exact: true }) });
  await tarjeta.locator('input[type="file"]').setInputFiles(VIDEO);
  await expect(page.getByText("Video subido como borrador")).toBeVisible();
  await expect(tarjeta.getByText("Borrador", { exact: true })).toBeVisible();
  await expect(tarjeta.locator("video")).toHaveAttribute("src", /\/v\/[a-f0-9]{12}\/[a-f0-9]{16}\.mp4$/);

  // Borrador: la ficha no lo muestra.
  await page.goto(`/producto/${slug}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("video")).toHaveCount(0);

  await page.goto(`${ADMIN}/productos/${slug}`);
  await tarjeta.getByRole("button", { name: "Publicar en la tienda" }).click();
  await expect(tarjeta.getByText("Publicado", { exact: true })).toBeVisible();

  // Publicado: segundo en la galería, sin sonido, arranca solo y se pausa con su botón (la página se regenera sola).
  await expect.poll(async () => {
    await page.goto(`/producto/${slug}`);
    return page.locator('section[aria-label="Fotos"] video').count();
  }, { timeout: 40_000 }).toBe(1);
  const galeria = page.locator('section[aria-label="Fotos"] li');
  await expect(galeria.nth(1).locator("video")).toHaveCount(1);
  const video = page.locator('section[aria-label="Fotos"] video');
  await video.scrollIntoViewIfNeeded();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.muted && !v.paused && v.currentTime > 0), { timeout: 15_000 }).toBe(true);
  await page.screenshot({ path: test.info().outputPath("video-en-la-ficha.png") });
  await page.getByRole("button", { name: "Pausar el video" }).click();
  await expect(page.getByRole("button", { name: "Reproducir el video" })).toBeVisible();
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);

  // Descarga con el nombre del producto, y borrado.
  await page.goto(`${ADMIN}/productos/${slug}`);
  const descarga = page.waitForEvent("download");
  await tarjeta.getByRole("link", { name: "Descargar" }).click();
  expect((await descarga).suggestedFilename()).toBe(`${slug}.mp4`);
  page.once("dialog", (d) => void d.accept());
  await tarjeta.getByRole("button", { name: "Borrar" }).click();
  await expect(page.getByText("Video borrado.")).toBeVisible();
  await expect(tarjeta.getByRole("button", { name: "+ Subir video" })).toBeVisible();
  expect(errores).toEqual([]);
});

async function ingresar(page: Page, email: string) {
  const salida = spawnSync("node", ["--env-file-if-exists=.env", "apps/api/dist/cli/crear-admin.js", email, "Videos E2E"], { cwd: RAIZ, encoding: "utf8" }).stderr;
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
  await page.getByRole("textbox", { name: /^Contraseña nueva/ }).fill("frase larga para la prueba de videos");
  await page.getByLabel("Repetí la contraseña nueva").fill("frase larga para la prueba de videos");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Para atender")).toBeVisible();
}
