import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Redis } from "ioredis";
import { crearInvalidador } from "./invalidar.js";

/*
 * El aviso a la web para regenerar páginas, y el repaso (etapa 12): una
 * página que se estaba regenerando con datos de antes del cambio puede
 * guardarse después del aviso; el segundo aviso la vuelve a vencer.
 */
const recibidos: Array<{ etiquetas: string[]; auth: string | undefined }> = [];
let servidor: http.Server;
let url = "";
const redis = { publish: async () => 1 } as unknown as Redis;
const TOKEN = "t".repeat(40);
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  servidor = http.createServer((req, res) => {
    let cuerpo = "";
    req.on("data", (c) => { cuerpo += c; });
    req.on("end", () => {
      recibidos.push({ etiquetas: JSON.parse(cuerpo).etiquetas, auth: req.headers.authorization });
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
  });
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => servidor.close(() => r())));

describe("invalidar", () => {
  it("avisa a la web y, unos segundos después, repasa (juntando los cambios seguidos)", async () => {
    recibidos.length = 0;
    const invalidar = crearInvalidador({ redis, webUrl: url, token: TOKEN, repasoMs: 600, log: { warn: () => {} } });
    await invalidar(["remera-lisa"]);
    await invalidar(["jogger"]);
    expect(recibidos).toEqual([
      { etiquetas: ["catalogo", "producto:remera-lisa"], auth: `Bearer ${TOKEN}` },
      { etiquetas: ["catalogo", "producto:jogger"], auth: `Bearer ${TOKEN}` },
    ]);
    await esperar(900);
    // Un solo repaso con todo lo que cambió.
    expect(recibidos).toHaveLength(3);
    expect(recibidos[2]!.etiquetas.sort()).toEqual(["catalogo", "producto:jogger", "producto:remera-lisa"]);
  });

  it("muchos productos: el repaso va en tandas de hasta 500 (más «catalogo»)", async () => {
    recibidos.length = 0;
    // (el repaso, más largo que la espera de 250 ms de cada aviso: así junta los dos)
    const invalidar = crearInvalidador({ redis, webUrl: url, token: TOKEN, repasoMs: 600, log: { warn: () => {} } });
    await invalidar(Array.from({ length: 500 }, (_, i) => `a-${i}`));
    await invalidar(Array.from({ length: 300 }, (_, i) => `b-${i}`));
    await esperar(900);
    const repaso = recibidos.slice(2);
    expect(repaso.map((r) => r.etiquetas.length)).toEqual([501, 301]);
    for (const r of repaso) expect(r.etiquetas[0]).toBe("catalogo");
  });

  it("sin web configurada no avisa ni repasa; con repasoMs 0, no repasa", async () => {
    recibidos.length = 0;
    await crearInvalidador({ redis, repasoMs: 50 })(["x"]);
    await crearInvalidador({ redis, webUrl: url, token: TOKEN, repasoMs: 0, log: { warn: () => {} } })(["y"]);
    await esperar(150);
    expect(recibidos.map((r) => r.etiquetas)).toEqual([["catalogo", "producto:y"]]);
  });
});
