import { describe, expect, it, vi } from "vitest";
import { CacheCorta } from "../src/lib/cache.js";

describe("caché corta", () => {
  it("la misma clave consulta una sola vez mientras dura", async () => {
    const c = new CacheCorta(60);
    const cargar = vi.fn(async () => 1);
    await Promise.all([c.obtener("a", cargar), c.obtener("a", cargar), c.obtener("a", cargar)]);
    expect(cargar).toHaveBeenCalledTimes(1);
  });

  it("claves inventadas no la hacen crecer sin techo: pasado el tope se van las más viejas", async () => {
    const c = new CacheCorta(60, 100);
    for (let i = 0; i < 1000; i++) await c.obtener(`cat:inventada-${i}`, async () => null);
    expect(c.tamano).toBeLessThanOrEqual(100);
    // Lo último sigue en la caché; lo primero se fue.
    const cargar = vi.fn(async () => "otra vez");
    expect(await c.obtener("cat:inventada-999", cargar)).toBeNull();
    expect(await c.obtener("cat:inventada-0", cargar)).toBe("otra vez");
  });

  it("al pasar el tope primero borra las vencidas", async () => {
    vi.useFakeTimers();
    try {
      const c = new CacheCorta(1, 10);
      for (let i = 0; i < 9; i++) await c.obtener(`viejas-${i}`, async () => i);
      vi.advanceTimersByTime(2000);
      await c.obtener("fija", async () => "x");
      for (let i = 0; i < 3; i++) await c.obtener(`nuevas-${i}`, async () => i);
      // Las 9 vencidas se fueron en la poda; quedan la fija y las nuevas.
      expect(c.tamano).toBe(4);
    } finally { vi.useRealTimers(); }
  });

  it("un error no queda guardado", async () => {
    const c = new CacheCorta(60);
    await expect(c.obtener("x", async () => { throw new Error("caída"); })).rejects.toThrow("caída");
    expect(await c.obtener("x", async () => "bien")).toBe("bien");
  });
});
