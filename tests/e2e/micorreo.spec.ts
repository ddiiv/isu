import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { APIRequestContext } from "@playwright/test";
import { expect, test, verResumen, type Page } from "./base";

/*
 * Etapa 15: Correo Argentino con la API de MiCorreo, peso y medidas de cada
 * prenda y todo el pedido en una bolsa.
 *
 *   · antes de pagar, el checkout muestra lo que cobra Correo Argentino (a
 *     domicilio y a sucursal, con las sucursales donde se puede retirar);
 *   · el backoffice pide peso y medidas en cada producto (y de a muchos);
 *   · «Preparar» carga el envío en MiCorreo; el rótulo se paga e imprime en
 *     MiCorreo (acá, su simulador) y el número se carga en el backoffice;
 *     de ahí sale, se sigue y el cliente lo ve en su seguimiento;
 *   · quién abrió los datos del cliente queda en Auditoría.
 */
const RAIZ = process.env.RAIZ ?? process.cwd();
const ADMIN = process.env.ADMIN_URL ?? "http://127.0.0.1:3001";
const API = process.env.API_URL ?? "http://127.0.0.1:4000";
const STOCKER = process.env.STOCKER_API_URL ?? "http://127.0.0.1:3900";
const TRANSPORTES = process.env.TRANSPORTES_SIMULADOR ?? "http://127.0.0.1:3920";
const PAGOS = process.env.PAGOS_TOKEN ?? "solo-desarrollo-pagos-cambiar-en-produccion";
// eslint-disable-next-line security/detect-non-literal-fs-filename -- el .env del propio repo
const ENV = readFileSync(path.join(RAIZ, ".env"), "utf8");
const delEnv = (k: string) => process.env[k] ?? ENV.split("\n").find((l) => l.startsWith(`${k}=`))?.slice(k.length + 1).trim() ?? "";

function vigilar(page: Page) {
  const errores: string[] = [];
  page.on("pageerror", (e) => errores.push(String(e)));
  return errores;
}

test("antes de pagar, el checkout muestra lo que cobra Correo Argentino (a domicilio y a sucursal)", async ({ page }, info) => {
  const errores = vigilar(page);
  await page.goto("/producto/remera-basica-cuello-redondo");
  await page.locator("fieldset", { hasText: "Talle" }).getByRole("button", { disabled: false }).first().click();
  await page.getByRole("button", { name: "Agregar al carrito" }).click();
  await page.getByRole("link", { name: /^Pagar con transferencia/ }).click();
  await page.getByLabel("Email").fill(`e2e-micorreo-${info.project.name}-${Date.now()}@test.com`);
  await page.getByLabel("Nombre", { exact: true }).fill("Ana");
  await page.getByLabel("Apellido").fill("Correo");
  await page.getByLabel("Celular").fill("11 5555 1234");
  await page.getByLabel("DNI o CUIT").fill("30111222");
  await page.getByText("A domicilio o a sucursal, a todo el país").click();
  await page.getByLabel("Calle").fill("Bacacay");
  await page.getByLabel("Número", { exact: true }).fill("3231");
  await page.getByLabel("Código postal").fill("1406");
  await page.getByLabel("Localidad").fill("Flores");

  const opciones = page.getByRole("radiogroup", { name: "¿Cómo te lo mandamos?" });
  const domicilio = opciones.getByRole("radio", { name: /Correo Argentino a domicilio/ });
  await expect(domicilio).toBeVisible({ timeout: 15_000 });
  // Con su precio, antes de pagar.
  await expect(domicilio).toHaveAccessibleName(/Correo Argentino a domicilio.*\$\s?[\d.]+/);
  await expect(opciones.getByText(/Llega en 2 a 5 días hábiles/).first()).toBeVisible();
  await opciones.getByText("Correo Argentino a sucursal").click();
  // Sólo las sucursales abiertas donde se retira (la cerrada y la que sólo recibe no aparecen), con su horario.
  const sucursales = page.getByRole("radiogroup", { name: "Elegí la sucursal" });
  await expect(sucursales.getByRole("radio")).toHaveCount(3);
  await expect(sucursales.getByText(/lun a vie 9:30 a 18 h/).first()).toBeVisible();
  await expect(sucursales.getByText("Sucursal cerrada")).toHaveCount(0);
  await sucursales.getByRole("radio").first().check();
  // El resumen ya suma el envío de Correo antes de confirmar la compra.
  await verResumen(page);
  const resumen = page.locator("aside");
  await expect(resumen.getByText("Correo Argentino a sucursal")).toBeVisible();
  expect(errores).toEqual([]);
});

test.describe("backoffice", () => {
  test.skip(({ isMobile }) => isMobile, "El backoffice se prueba en escritorio");

  test("peso y medidas: obligatorios en el producto, de a muchos en la lista y en el panel", async ({ page }) => {
    test.setTimeout(90_000);
    const errores = vigilar(page);
    await ingresar(page, `e2e-medidas-${Date.now()}@test.com`);
    // El primero de la lista de los que no tienen peso o medidas.
    const nombreDe = async (n: number) => (await page.getByRole("row").nth(n).getByRole("link").first().locator("span.text-marca").innerText()).trim();
    await page.goto(`${ADMIN}/productos?filtro=sin_medidas`);
    await expect(page.getByRole("row").nth(1).getByText("Sin peso o medidas")).toBeVisible();
    const uno = await nombreDe(1);
    await page.getByRole("row").nth(1).getByRole("link").first().click();
    const tarjeta = page.locator("section", { has: page.getByRole("heading", { name: "Peso y medidas para el envío" }) });
    await expect(tarjeta.getByText(/Faltan datos/)).toBeVisible();
    // No guarda sin los cuatro datos.
    await tarjeta.getByRole("spinbutton", { name: /^Peso/ }).fill("650");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByText(/Completá el peso y las tres medidas/)).toBeVisible();
    await tarjeta.getByRole("spinbutton", { name: /^Grosor/ }).fill("6");
    await tarjeta.getByRole("spinbutton", { name: /^Ancho/ }).fill("30");
    await tarjeta.getByRole("spinbutton", { name: /^Largo/ }).fill("35");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByText(/^Guardado\. La tienda se actualiza/)).toBeVisible();
    await expect(tarjeta.getByText(/Faltan datos/)).toHaveCount(0);

    // De a muchos, desde la lista.
    await page.goto(`${ADMIN}/productos?filtro=sin_medidas`);
    await expect(page.getByRole("row").nth(1)).toBeVisible();
    await expect(page.getByRole("row", { name: uno })).toHaveCount(0);
    const dos = await nombreDe(1);
    await page.getByRole("row").nth(1).getByRole("checkbox", { name: /^Elegir / }).check();
    await page.getByRole("button", { name: "Peso y medidas…" }).click();
    await page.getByRole("spinbutton", { name: "Peso (g)" }).fill("250");
    await page.getByRole("spinbutton", { name: "Grosor (cm)" }).fill("2");
    await page.getByRole("spinbutton", { name: "Ancho (cm)" }).fill("25");
    await page.getByRole("spinbutton", { name: "Largo (cm)" }).fill("30");
    await page.getByRole("button", { name: "Aplicar a 1" }).click();
    await expect(page.getByText(/Peso y medidas guardados \(1 productos\)/)).toBeVisible();
    await expect(page.getByRole("row", { name: dos })).toHaveCount(0);

    // El panel cuenta los publicados que faltan.
    await page.goto(`${ADMIN}/`);
    await expect(page.getByRole("link", { name: "Publicados sin peso o medidas" })).toBeVisible();
    // Ajustes: las bolsas, con el ejemplo de cuál se usa.
    await page.goto(`${ADMIN}/ajustes`);
    await expect(page.getByRole("heading", { name: "Paquete: todo en una bolsa" })).toBeVisible();
    await expect(page.getByText(/1 prenda → Chica/)).toBeVisible();
    expect(errores).toEqual([]);
  });

  test("Correo Argentino: preparar lo carga en MiCorreo, el rótulo se imprime allá y su número se carga acá", async ({ page, request }) => {
    test.setTimeout(150_000);
    const errores = vigilar(page);
    const sku = await skuConStock(request);
    const nuevo = await request.post(`${API}/v1/pedidos`, {
      data: {
        items: [{ sku, cantidad: 2 }], medioPago: "transferencia", aceptaTerminos: true,
        contacto: { email: `e2e-micorreo-${Date.now()}@test.com`, nombre: "Ana", apellido: "MiCorreo", telefono: "11 5555 1234", dni: "30111222" },
        entrega: { tipo: "envio", opcion: "correo_argentino:domicilio", direccion: { calle: "Bacacay", numero: "3231", piso: "3 B", cp: "1406", localidad: "Flores", provincia: "CABA", indicaciones: "" } },
      },
    });
    expect(nuevo.status(), await nuevo.text()).toBe(201);
    const { numero } = await nuevo.json() as { numero: string };
    expect((await request.post(`${API}/v1/pagos/registrar`, { headers: { authorization: `Bearer ${PAGOS}` }, data: { pedido: numero, medio: "transferencia", monto: 99_999_999, referencia: `E2E-CA-${Date.now()}`, quien: "e2e" } })).ok()).toBe(true);

    await ingresar(page, `e2e-micorreo-${Date.now()}@test.com`);
    await page.goto(`${ADMIN}/envios`);
    await page.getByLabel(`Elegir ${numero}`).check();
    await page.getByRole("button", { name: "Preparar envíos" }).click();
    await expect(page.getByText(/quedó cargado en MiCorreo/)).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: /^Etiquetados/ }).click();
    const fila = page.getByRole("row", { name: numero });
    await expect(fila.getByText("Falta el número del rótulo")).toBeVisible();
    await expect(fila).toContainText(/bolsa (Chica|Mediana|Grande)/);
    const portal = fila.getByRole("link", { name: /Pagar e imprimir en MiCorreo/ });
    await expect(portal).toHaveAttribute("href", `${TRANSPORTES}/correo/portal`);

    // En MiCorreo (el simulador): pagar e imprimir el rótulo da el número.
    const micorreo = await page.context().newPage();
    await micorreo.goto(`${TRANSPORTES}/correo/portal`);
    const suyo = micorreo.getByRole("row", { name: new RegExp(numero) });
    await suyo.getByRole("button", { name: "Pagar e imprimir rótulo" }).click();
    const tn = (await suyo.locator("code").innerText()).trim();
    expect(tn).toMatch(/^0005000\d{8}[0-9A-F]{8}$/);
    await micorreo.close();

    // De vuelta en el backoffice: el número (como lo escribe el lector de códigos: y Enter).
    await fila.getByLabel(`Número de seguimiento de ${numero}`).fill(tn);
    await fila.getByLabel(`Número de seguimiento de ${numero}`).press("Enter");
    await expect(page.getByText(`${numero}: número ${tn} guardado`)).toBeVisible();
    await expect(page.getByRole("row", { name: numero }).getByRole("link", { name: tn })).toBeVisible();

    // Stocker lo despacha → en camino, con su número en el seguimiento del cliente.
    const d = await request.post(`${STOCKER}/__despachar?pedido=${numero}`, { maxRedirects: 0 });
    expect([200, 303]).toContain(d.status());
    await expect(async () => {
      await page.goto(`${ADMIN}/envios?vista=en_camino`);
      await expect(page.getByRole("row", { name: numero })).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 30_000 });
    const { firmaSeguimiento } = await import(pathToFileURL(path.join(RAIZ, "packages/envios/dist/firma.js")).href) as { firmaSeguimiento: (n: string, s: string) => string };
    await page.goto(`/seguimiento/${numero}?t=${firmaSeguimiento(numero, delEnv("INTERNO_TOKEN"))}`);
    await expect(page.getByText(tn)).toBeVisible();
    await expect(page.getByText("Bacacay")).toHaveCount(0);

    // Abrir el pedido en el backoffice queda registrado (quién vio los datos del cliente).
    await page.goto(`${ADMIN}/pedidos/${numero}`);
    await expect(page.getByText(/Bolsa (Chica|Mediana|Grande) ·/)).toBeVisible();
    await page.goto(`${ADMIN}/auditoria`);
    await page.getByLabel("Filtrar").selectOption("datos_cliente");
    await expect(page.getByRole("row", { name: new RegExp(`pedido ${numero}`) }).first()).toBeVisible();
    expect(errores).toEqual([]);
  });
});

/** Un SKU de muestra con stock de sobra (pregunta al Stocker simulado). */
async function skuConStock(request: APIRequestContext) {
  const token = delEnv("STOCKER_TOKEN");
  const cat = await (await request.get(`${STOCKER}/api/integraciones/tienda/catalogo`, { headers: { authorization: `Bearer ${token}` } })).json() as { productos: Array<{ variantes: Array<{ sku: string; publicable: number }> }> };
  const v = cat.productos.flatMap((p) => p.variantes).find((x) => x.publicable > 5);
  if (!v) throw new Error("sin stock de sobra en el Stocker simulado");
  return v.sku;
}

async function ingresar(page: Page, email: string) {
  const salida = spawnSync("node", ["--env-file-if-exists=.env", "apps/api/dist/cli/crear-admin.js", email, "MiCorreo E2E"], { cwd: RAIZ, encoding: "utf8" }).stderr;
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
  await page.getByRole("textbox", { name: /^Contraseña nueva/ }).fill("frase larga para la prueba de micorreo");
  await page.getByLabel("Repetí la contraseña nueva").fill("frase larga para la prueba de micorreo");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Para atender")).toBeVisible();
}
