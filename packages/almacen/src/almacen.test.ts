import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { almacenEnDisco, almacenR2, claveNueva, PATRON_COMPROBANTES, PATRON_FOTOS, PATRON_VIDEOS } from "./index.js";

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
  it("videos: sólo mp4 con la clave al azar", () => {
    expect(PATRON_VIDEOS.test(`${claveNueva("v")}.mp4`)).toBe(true);
    for (const malo of [claveNueva("v"), `${claveNueva("v")}.mov`, `${claveNueva("p")}.mp4`, "v/../x.mp4"]) expect(PATRON_VIDEOS.test(malo)).toBe(false);
  });

  it("comprobantes: sólo webp y pdf con nombre al azar", async () => {
    const a = almacenEnDisco(await mkdtemp(path.join(os.tmpdir(), "comp-")), PATRON_COMPROBANTES);
    await a.guardar("c/12/abcdef0123456789.pdf", Buffer.from("%PDF"), "application/pdf");
    await expect(a.guardar("c/12/abcdef0123456789.html", Buffer.from("<script>"), "text/html")).rejects.toThrow();
    await expect(a.guardar("p/1/abcdefgh-400.webp", Buffer.from("x"), "image/webp")).rejects.toThrow();
  });
});

describe("almacén en R2", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it("cada pedido lleva tope (más largo al subir) y si R2 no contesta, falla", async () => {
    const real = AbortSignal.timeout.bind(AbortSignal);
    const topes = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => real(5));
    // R2 colgado: sólo termina cuando se corta el pedido.
    vi.stubGlobal("fetch", (req: Request) => new Promise((_, rechazar) => {
      if (req.signal.aborted) rechazar(req.signal.reason);
      req.signal.addEventListener("abort", () => rechazar(req.signal.reason));
    }));
    const a = almacenR2({ cuenta: "c", bucket: "b", id: "i", secreto: "s" }, PATRON_FOTOS);
    await expect(a.leer("p/1/abcdefgh-400.webp")).rejects.toThrow();
    await expect(a.guardar("p/1/abcdefgh-400.webp", Buffer.from("x"), "image/webp")).rejects.toThrow();
    expect(topes.mock.calls).toEqual([[10_000], [30_000]]);
  });
});
