import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { APIRequestContext } from "@playwright/test";
import { expect, test, verResumen, type Page } from "./base";

/*
 * Etapa 4 en un navegador real, de punta a punta:
 *
 *   checkout con opciones de envío (a sucursal, con su lista) → pago →
 *   backoffice: Preparar (etiqueta en Andreani) e Imprimir → Stocker
 *   despacha (Envíos del día) → el pedido pasa a "En camino", se avisa
 *   por WhatsApp y el enlace de seguimiento público muestra el envío.
 *
 * Necesita los servicios levantados con los simuladores: Stocker
 * (pnpm demo:stocker), Mercado Pago y transportes (pnpm demo:transportes,
 * con TRANSPORTES_SIMULADOR en el .env).
 */
const RAIZ = process.env.RAIZ ?? process.cwd();
const ADMIN = process.env.ADMIN_URL ?? "http://127.0.0.1:3001";
const API = process.env.API_URL ?? "http://127.0.0.1:4000";
const STOCKER = process.env.STOCKER_API_URL ?? "http://127.0.0.1:3900";
const TRANSPORTES = process.env.TRANSPORTES_SIMULADOR ?? "http://127.0.0.1:3920";
const PAGOS = process.env.PAGOS_TOKEN ?? "solo-desarrollo-pagos-cambiar-en-produccion";
/* El .env de la raíz: INTERNO_TOKEN (firma el enlace de seguimiento) y STOCKER_TOKEN. */
// eslint-disable-next-line security/detect-non-literal-fs-filename -- el .env del propio repo
const ENV = readFileSync(path.join(RAIZ, ".env"), "utf8");
const delEnv = (k: string) => process.env[k] ?? ENV.split("\n").find((l) => l.startsWith(`${k}=`))?.slice(k.length + 1).trim() ?? "";
const INTERNO = delEnv("INTERNO_TOKEN");

function vigilar(page: Page) {
  const errores: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); });
  page.on("pageerror", (e) => errores.push(String(e)));
  return errores;
}
async function agregar(page: Page, slug: string) {
  await page.goto(`/producto/${slug}`);
  const talles = page.locator("fieldset", { hasText: "Talle" }).getByRole("button", { disabled: false });
  for (let t = 0; t < await talles.count(); t++) {
    await talles.nth(t).click();
    if (!(await page.getByText(/¡Últim/).isVisible())) {
      await page.getByRole("button", { name: "Agregar al carrito" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      return;
    }
  }
  throw new Error(`${slug}: sin talles con stock de sobra (reiniciá pnpm demo:stocker)`);
}

test.describe("checkout con transportes", () => {
  test("a sucursal: elige transporte y sucursal, el total suma el envío y el pedido muestra 'Tu envío'", async ({ page, request }, info) => {
    const errores = vigilar(page);
    await agregar(page, "jogger-rustico-puno");
    await page.getByRole("link", { name: /^Pagar con transferencia/ }).click();
    await page.getByLabel("Email").fill(`e2e-envio-${info.project.name}-${Date.now()}@test.com`);
    await page.getByLabel("Nombre", { exact: true }).fill("Ana");
    await page.getByLabel("Apellido").fill("Prueba");
    await page.getByLabel("Celular").fill("11 5555 1234");
    await page.getByLabel("DNI o CUIT").fill("30111222");
    await page.getByText("A domicilio o a sucursal, a todo el país").click();
    await expect(page.getByText(/Completá el código postal/)).toBeVisible();
    await page.getByLabel("Calle").fill("Bacacay");
    await page.getByLabel("Número", { exact: true }).fill("3231");
    await page.getByLabel("Código postal").fill("1406");
    await page.getByLabel("Localidad").fill("Flores");

    const opciones = page.getByRole("radiogroup", { name: "¿Cómo te lo mandamos?" });
    await expect(opciones.getByText("Andreani a sucursal")).toBeVisible({ timeout: 15_000 });
    await expect(opciones.getByText("OCA a domicilio")).toBeVisible();
    await opciones.getByText("Andreani a sucursal").click();
    const sucursales = page.getByRole("radiogroup", { name: "Elegí la sucursal" });
    await expect(sucursales.getByRole("radio")).toHaveCount(3);
    // Sin sucursal no confirma.
    await page.getByText("Transferencia bancaria").click();
    await page.getByRole("checkbox", { name: /Acepto los/ }).check();
    await page.getByRole("button", { name: "Confirmar compra" }).click();
    await expect(page.getByText("Elegí la sucursal donde lo vas a retirar.")).toBeVisible();
    await sucursales.getByRole("radio").first().check();
    // El resumen muestra el envío elegido con su precio.
    await verResumen(page);
    const resumen = page.locator("aside");
    await expect(resumen.getByText("Andreani a sucursal")).toBeVisible();
    await expect(resumen.locator("dd").filter({ hasText: /^\$/ }).nth(1)).toBeVisible();
    await page.getByRole("button", { name: "Confirmar compra" }).click();
    await page.waitForURL(/\/pedido\/ISU-\d+/);
    const numero = page.url().match(/ISU-\d+/)![0];

    const r = await request.post(`${API}/v1/pagos/registrar`, {
      headers: { authorization: `Bearer ${PAGOS}` },
      data: { pedido: numero, medio: "transferencia", monto: 99_999_999, referencia: `E2E-ENV-${Date.now()}-${info.project.name}`, quien: "e2e" },
    });
    expect(r.ok()).toBe(true);
    await expect(page.getByRole("heading", { name: "¡Pago confirmado!" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Tu envío" })).toBeVisible();
    await expect(page.getByText(/Retirás en/)).toBeVisible();
    expect(errores).toEqual([]);
  });
});

test.describe("backoffice de envíos", () => {
  test.skip(({ isMobile }) => isMobile, "El backoffice se prueba en escritorio");
  const EMAIL = "e2e-envios@isuwaya.test";

  test("preparar, imprimir, despachar en Stocker → en camino, WhatsApp y seguimiento público", async ({ page, request }) => {
    test.setTimeout(120_000);
    const errores = vigilar(page);
    // Un pedido pagado con Andreani a domicilio (por la API, como lo haría la tienda).
    const op = await request.post(`${API}/v1/envios/opciones`, { data: { items: [{ sku: await skuConStock(request), cantidad: 1 }], destino: { cp: "1406", provincia: "CABA", localidad: "Flores" } } });
    expect(op.ok(), await op.text()).toBe(true);
    const sku = await skuConStock(request);
    const nuevo = await request.post(`${API}/v1/pedidos`, {
      data: {
        items: [{ sku, cantidad: 1 }], medioPago: "transferencia", aceptaTerminos: true, avisosWhatsapp: true,
        contacto: { email: `e2e-envios-${Date.now()}@test.com`, nombre: "Ana", apellido: "Envíos", telefono: "11 5555 1234", dni: "30111222" },
        entrega: { tipo: "envio", opcion: "andreani:domicilio", direccion: { calle: "Bacacay", numero: "3231", piso: "", cp: "1406", localidad: "Flores", provincia: "CABA", indicaciones: "" } },
      },
    });
    expect(nuevo.status(), await nuevo.text()).toBe(201);
    const { numero } = await nuevo.json() as { numero: string };
    expect((await request.post(`${API}/v1/pagos/registrar`, { headers: { authorization: `Bearer ${PAGOS}` }, data: { pedido: numero, medio: "transferencia", monto: 99_999_999, referencia: `E2E-ADM-${Date.now()}`, quien: "e2e" } })).ok()).toBe(true);

    await ingresar(page, EMAIL);
    await page.goto(`${ADMIN}/envios`);
    await page.getByLabel(`Elegir ${numero}`).check();
    await page.getByRole("button", { name: "Preparar envíos" }).click();
    await expect(page.getByText(/1 envío preparado/)).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: /^Etiquetados/ }).click();
    const fila = page.getByRole("row", { name: numero });
    await expect(fila).toContainText(/36\d{6,}/);
    await page.getByLabel(`Elegir ${numero}`).check();
    const descarga = page.waitForEvent("download");
    await page.getByRole("button", { name: "Imprimir etiquetas" }).click();
    const pdf = await descarga;
    expect(pdf.suggestedFilename()).toMatch(/^etiquetas-.*\.pdf$/);

    // El depósito despacha en Stocker → NOTIFY → worker → "En camino".
    const d = await request.post(`${STOCKER}/__despachar?pedido=${numero}`, { maxRedirects: 0 });
    expect([200, 303]).toContain(d.status());
    await expect(async () => {
      await page.goto(`${ADMIN}/envios?vista=en_camino`);
      await expect(page.getByRole("row", { name: numero })).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 30_000 });
    // El WhatsApp "en camino" llegó al simulador de Meta.
    await expect(async () => {
      const html = await (await request.get(`${TRANSPORTES}/`)).text();
      expect(html).toContain("pedido_en_camino");
      expect(html).toContain(numero);
    }).toPass({ timeout: 30_000 });

    // Seguimiento público con el enlace firmado: sin datos personales.
    const { firmaSeguimiento } = await import(pathToFileURL(path.join(RAIZ, "packages/envios/dist/firma.js")).href) as { firmaSeguimiento: (n: string, s: string) => string };
    await page.goto(`/seguimiento/${numero}?t=${firmaSeguimiento(numero, INTERNO)}`);
    await expect(page.getByRole("heading", { name: /Ana, en camino/i })).toBeVisible();
    await expect(page.getByText("Andreani · a domicilio")).toBeVisible();
    await expect(page.getByText("Bacacay")).toHaveCount(0);
    // Con una firma inventada no muestra nada.
    await page.goto(`/seguimiento/${numero}?t=${"A".repeat(24)}`);
    await expect(page.getByText(/El enlace no es válido/)).toBeVisible();
    expect(errores.filter((e) => !/404/.test(e))).toEqual([]);
  });
});

/** Un SKU de muestra con stock de sobra (pregunta al Stocker simulado). */
async function skuConStock(request: APIRequestContext) {
  const token = delEnv("STOCKER_TOKEN");
  const cat = await (await request.get(`${STOCKER}/api/integraciones/tienda/catalogo`, { headers: { authorization: `Bearer ${token}` } })).json() as { productos: Array<{ variantes: Array<{ sku: string; publicable: number }> }> };
  const v = cat.productos.flatMap((p) => p.variantes).find((x) => x.publicable > 3);
  if (!v) throw new Error("sin stock de sobra en el Stocker simulado");
  return v.sku;
}

async function ingresar(page: Page, email: string) {
  const salida = spawnSync("node", ["--env-file-if-exists=.env", "apps/api/dist/cli/crear-admin.js", email, "Envíos E2E"], { cwd: RAIZ, encoding: "utf8" }).stderr;
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
  await page.getByRole("textbox", { name: /^Contraseña nueva/ }).fill("frase larga para la prueba de envíos");
  await page.getByLabel("Repetí la contraseña nueva").fill("frase larga para la prueba de envíos");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Para atender")).toBeVisible();
}
