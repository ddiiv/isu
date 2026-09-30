import { describe, expect, it } from "vitest";
import { mkdtemp, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { almacenEnDisco, PATRON_COMPROBANTES, PATRON_FOTOS } from "./index.js";

describe("almacén en disco", () => {
  it("fotos: no sale de su carpeta ni acepta otros nombres", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "alm-"));
    const a = almacenEnDisco(dir, PATRON_FOTOS);
    for (const malo of ["../x-400.webp", "p/1/../../x-400.webp", "/etc/passwd", "p/1/abcdefgh-400.webp/../../../x", "c/1/abcdefghabcdefgh.pdf"]) {
      await expect(a.guardar(malo, Buffer.from("x"), "image/webp")).rejects.toThrow();
    }
    await a.guardar("p/1/abcdefgh-400.webp", Buffer.from("x"), "image/webp");
    expect(await readdir(path.join(dir, "p/1"))).toEqual(["abcdefgh-400.webp"]);
    expect((await a.leer("p/1/abcdefgh-400.webp"))?.toString()).toBe("x");
    expect(await a.leer("p/1/noexiste1-400.webp")).toBeNull();
  });
  it("comprobantes: sólo webp y pdf con nombre al azar", async () => {
    const a = almacenEnDisco(await mkdtemp(path.join(os.tmpdir(), "comp-")), PATRON_COMPROBANTES);
    await a.guardar("c/12/abcdef0123456789.pdf", Buffer.from("%PDF"), "application/pdf");
    await expect(a.guardar("c/12/abcdef0123456789.html", Buffer.from("<script>"), "text/html")).rejects.toThrow();
    await expect(a.guardar("p/1/abcdefgh-400.webp", Buffer.from("x"), "image/webp")).rejects.toThrow();
  });
});
