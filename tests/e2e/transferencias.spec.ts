import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, type APIRequestContext, type Page } from "./base";

/*
 * Transferencias que se confirman solas, en un navegador real:
 *
 *   · Talo: el pedido muestra su propio CVU; se "transfiere" en el Talo
 *     simulado y la pantalla del pedido pasa sola a «¡Pago confirmado!».
 *   · Mercado Pago: el pedido pide un monto con centavos; una transferencia
 *     exacta a la cuenta lo confirma; una sin centavos queda en backoffice →
 *     Transferencias y se asigna a mano.
 *
 * Cambia un ajuste de toda la tienda: corre en su propio proyecto, después de
 * los demás (ver playwright.config.ts), para no pisarle la transferencia a
 * compras.spec.
 */
const RAIZ = process.env.RAIZ ?? process.cwd();
const ADMIN = process.env.ADMIN_URL ?? "http://127.0.0.1:3001";
const API = process.env.API_URL ?? "http://127.0.0.1:4000";
// eslint-disable-next-line security/detect-non-literal-fs-filename -- el .env del propio repo
const ENV = readFileSync(path.join(RAIZ, ".env"), "utf8");
const delEnv = (k: string) => process.env[k] ?? ENV.split("\n").find((l) => l.startsWith(`${k}=`))?.slice(k.length + 1).trim() ?? "";
const INTERNO = delEnv("INTERNO_TOKEN");
const TALO = delEnv("TALO_API_URL");
const MP = delEnv("MP_API_URL");

function sql(q: string) {
  const r = spawnSync("node", ["--env-file=../../.env", "-e", `const pg=require("pg");const c=new pg.Client(process.env.DATABASE_URL);c.connect().then(()=>c.query(${JSON.stringify(q)})).then(()=>c.end()).catch((e)=>{console.error(e.message);process.exit(1)})`], { cwd: path.join(RAIZ, "apps/api"), encoding: "utf8" });
  if (r.status !== 0) throw new Error(`sql: ${r.stderr}`);
}
const prender = (talo: boolean, mercadoPago: boolean) =>
  sql(`UPDATE tienda.ajustes SET valor = '${JSON.stringify({ talo, mercadoPago })}' WHERE clave = 'transferenciasAuto'`);

async function pedido(request: APIRequestContext, quien: string) {
  const config = await (await request.get(`${API}/v1/config`)).json() as { locales: Array<{ nombre: string; retiro: boolean }> };
  const ficha = await (await request.get(`${API}/v1/productos/remera-oversize-algodon-peinado`)).json() as { variantes: Array<{ sku: string; stock: number }> };
  const r = await request.post(`${API}/v1/pedidos`, {
    data: {
      items: [{ sku: ficha.variantes.find((v) => v.stock > 0)!.sku, cantidad: 1 }], medioPago: "transferencia", aceptaTerminos: true,
      contacto: { email: `e2e-transf-${quien}-${Date.now()}@test.com`, nombre: "Tomás", apellido: "Transfiere", telefono: "11 5555 1234", dni: "30111222" },
      entrega: { tipo: "retiro", local: config.locales.find((l) => l.retiro)!.nombre },
    },
  });
  expect(r.status(), await r.text()).toBe(201);
  const { numero, acceso } = await r.json() as { numero: string; acceso: string };
  const v = await (await request.get(`${API}/v1/pedidos/${numero}`, { headers: { "x-isu-acceso": acceso } })).json() as { pago: { transferencia: { cbu: string; alias: string; monto: number; via: string } } };
  return { numero, acceso, t: v.pago.transferencia };
}

function vigilar(page: Page) {
  const errores: string[] = [];
  page.on("pageerror", (e) => errores.push(e.message));
  return errores;
}

test.afterAll(() => prender(false, false));

test("Talo: el pedido tiene su propio CVU y se confirma solo al transferir", async ({ page, request }) => {
  const errores = vigilar(page);
  prender(true, false);
  const { numero, acceso, t } = await pedido(request, "talo");
  // El ajuste ya hizo lo suyo (el pedido quedó con su CVU): se apaga para no tocar otras pruebas.
  prender(false, false);
  expect(t.via).toBe("talo");
  await page.goto(`/pedido/${numero}#c=${acceso}`);
  await expect(page.getByRole("heading", { name: "Esperamos tu transferencia" })).toBeVisible();
  await expect(page.getByText(t.cbu)).toBeVisible();
  await expect(page.getByText("sólo para tu pedido")).toBeVisible();
  // El comprobante ya no es el paso principal: queda guardado por si algo falla.
  await expect(page.getByText("Subir el comprobante")).toBeHidden();

  // Alguien transfiere al CVU (el «faucet» del Talo simulado, como el del sandbox de Talo).
  const token = await (await request.post(`${TALO}/users/${delEnv("TALO_USER_ID")}/tokens`, { data: { client_id: delEnv("TALO_CLIENT_ID"), client_secret: delEnv("TALO_CLIENT_SECRET") } })).json() as { data: { token: string } };
  const f = await request.post(`${TALO}/cvu/${t.cbu}/faucet`, { headers: { authorization: `Bearer ${token.data.token}` }, data: { amount: t.monto / 100 } });
  expect(f.ok(), await f.text()).toBe(true);
  await expect(page.getByRole("heading", { name: "¡Pago confirmado!" })).toBeVisible({ timeout: 25_000 });
  expect(errores).toEqual([]);
});

test("Mercado Pago: el monto con centavos confirma solo; sin centavos se asigna a mano desde el backoffice", async ({ page, request }) => {
  test.setTimeout(120_000);
  const errores = vigilar(page);
  prender(false, true);
  const exacto = await pedido(request, "mp-exacto");
  const redondo = await pedido(request, "mp-redondo");
  prender(false, false);
  expect(exacto.t.via).toBe("mercadopago");
  expect(exacto.t.monto % 100).not.toBe(0);

  await page.goto(`/pedido/${exacto.numero}#c=${exacto.acceso}`);
  const pesos = (exacto.t.monto / 100).toLocaleString("es-AR", { minimumFractionDigits: 2 });
  await expect(page.getByText(pesos).first()).toBeVisible();
  await expect(page.getByText("Con los centavos, el monto exacto:")).toBeVisible();

  // Transferencia exacta a la cuenta de Mercado Pago (simulada) y la vuelta del worker (adelantada).
  const transferir = (monto: number) => request.post(`${MP}/simular/transferencia`, { headers: { authorization: `Bearer ${delEnv("MP_ACCESS_TOKEN")}` }, data: { monto, nombre: "Tomás", apellido: "Transfiere" } });
  expect((await transferir(exacto.t.monto / 100)).ok()).toBe(true);
  expect((await request.post(`${API}/v1/interno/conciliar-transferencias`, { headers: { "x-isu-interno": INTERNO } })).ok()).toBe(true);
  await expect(page.getByRole("heading", { name: "¡Pago confirmado!" })).toBeVisible({ timeout: 25_000 });

  // Sin los centavos: no se puede saber de quién es → queda en Transferencias.
  const redonda = Math.floor(redondo.t.monto / 100);
  expect((await transferir(redonda)).ok()).toBe(true);
  expect((await request.post(`${API}/v1/interno/conciliar-transferencias`, { headers: { "x-isu-interno": INTERNO } })).ok()).toBe(true);
  await ingresar(page, `e2e-transf-${Date.now()}@test.com`);
  await page.goto(`${ADMIN}/transferencias`);
  const tarjeta = page.locator("li", { hasText: "Tomás Transfiere" }).filter({ hasText: "Sin pedido" }).first();
  await expect(tarjeta).toBeVisible();
  await tarjeta.getByRole("button", { name: "Asignar a un pedido" }).click();
  await tarjeta.getByLabel("Número de pedido").fill(redondo.numero);
  await tarjeta.getByRole("button", { name: "Asignar y dar por pagado" }).click();
  await expect(page.getByText(`Asignada a ${redondo.numero}`)).toBeVisible();
  const v = await (await request.get(`${API}/v1/pedidos/${redondo.numero}`, { headers: { "x-isu-acceso": redondo.acceso } })).json() as { estado: string };
  expect(v.estado).toBe("pagado");
  expect(errores).toEqual([]);
});

async function ingresar(page: Page, email: string) {
  const salida = spawnSync("node", ["--env-file-if-exists=.env", "apps/api/dist/cli/crear-admin.js", email, "Transferencias E2E"], { cwd: RAIZ, encoding: "utf8" }).stderr;
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
  await page.getByRole("textbox", { name: /^Contraseña nueva/ }).fill("frase larga para la prueba de transferencias");
  await page.getByLabel("Repetí la contraseña nueva").fill("frase larga para la prueba de transferencias");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Para atender")).toBeVisible();
}
