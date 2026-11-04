import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { spawn } from "node:child_process";
import { crearAdminPerezoso } from "./admin-perezoso.mjs";

const libre = () => new Promise((r) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => r(port)); }); });
const duerme = (ms) => new Promise((r) => setTimeout(r, ms));

// Un "admin" de juguete: contesta el número de arranque que le tocó y la cabecera que le llegó.
function fabrica(puerto) {
  const arranques = [];
  const codigo = `require("http").createServer((q,s)=>s.end(process.argv[1]+" "+q.headers["x-prueba"])).listen(${puerto},"127.0.0.1")`;
  return { arranques, arrancar: () => { const h = spawn(process.execPath, ["-e", codigo, String(arranques.length + 1)], { stdio: "ignore" }); arranques.push(h); return h; } };
}

test("el admin arranca con el primer pedido, pasa las cabeceras y se apaga sin uso; el siguiente pedido lo levanta de nuevo", async () => {
  const [publico, interno] = [await libre(), await libre()];
  const f = fabrica(interno);
  const p = crearAdminPerezoso({ puertoInterno: interno, arrancar: f.arrancar, inactividadMs: 600 });
  await new Promise((r) => p.servidor.listen(publico, "127.0.0.1", r));
  try {
    await duerme(200);
    assert.equal(f.arranques.length, 0, "sin pedidos no se levanta");

    const pedir = async () => (await fetch(`http://127.0.0.1:${publico}/`, { headers: { "x-prueba": "hola" } })).text();
    assert.equal(await pedir(), "1 hola", "el primer pedido espera al admin y recibe su respuesta");
    assert.equal(await pedir(), "1 hola", "los siguientes usan el mismo");

    await new Promise((r) => f.arranques[0].once("exit", r)); // se apaga solo por inactividad
    assert.equal(await pedir(), "2 hola", "un pedido nuevo lo vuelve a levantar");
    assert.equal(f.arranques.length, 2);
  } finally {
    p.cerrar();
    for (const h of f.arranques) h.kill("SIGKILL");
  }
});

test("si el admin no llega a contestar, se corta la conexión y el próximo pedido lo intenta otra vez", async () => {
  const [publico, interno] = [await libre(), await libre()];
  let intentos = 0;
  // Se cae al instante: nunca abre el puerto.
  const arrancar = () => { intentos++; return spawn(process.execPath, ["-e", "process.exit(1)"], { stdio: "ignore" }); };
  const p = crearAdminPerezoso({ puertoInterno: interno, arrancar, inactividadMs: 60_000, pausaTrasFalloMs: 0 });
  await new Promise((r) => p.servidor.listen(publico, "127.0.0.1", r));
  try {
    await assert.rejects(fetch(`http://127.0.0.1:${publico}/`));
    await assert.rejects(fetch(`http://127.0.0.1:${publico}/`));
    assert.equal(intentos, 2);
  } finally {
    p.cerrar();
  }
});

test("después de un arranque fallido espera antes de relanzarlo: una variable rota no lanza un Next por pedido", async () => {
  const [publico, interno] = [await libre(), await libre()];
  let intentos = 0;
  const arrancar = () => { intentos++; return spawn(process.execPath, ["-e", "process.exit(1)"], { stdio: "ignore" }); };
  const p = crearAdminPerezoso({ puertoInterno: interno, arrancar, inactividadMs: 60_000 });
  await new Promise((r) => p.servidor.listen(publico, "127.0.0.1", r));
  try {
    await assert.rejects(fetch(`http://127.0.0.1:${publico}/`));
    await assert.rejects(fetch(`http://127.0.0.1:${publico}/`));
    assert.equal(intentos, 1);
  } finally {
    p.cerrar();
  }
});

test("si el admin tarda demasiado, se lo apaga y el próximo arranque espera a que se haya ido (nunca dos a la vez)", async () => {
  const [publico, interno] = [await libre(), await libre()];
  const hijos = [];
  let solapados = 0;
  // Nunca abre el puerto: se queda colgado hasta que lo matan.
  const arrancar = () => {
    if (hijos.some((h) => h.exitCode === null && h.signalCode === null)) solapados++;
    const h = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    hijos.push(h);
    return h;
  };
  const p = crearAdminPerezoso({ puertoInterno: interno, arrancar, inactividadMs: 60_000, esperaMaxMs: 300, pausaTrasFalloMs: 0 });
  await new Promise((r) => p.servidor.listen(publico, "127.0.0.1", r));
  try {
    await assert.rejects(fetch(`http://127.0.0.1:${publico}/`));
    await assert.rejects(fetch(`http://127.0.0.1:${publico}/`));
    assert.equal(hijos.length, 2);
    assert.equal(solapados, 0);
  } finally {
    p.cerrar();
    for (const h of hijos) h.kill("SIGKILL");
  }
});
