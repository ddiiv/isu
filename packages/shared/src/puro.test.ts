import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/* "@isu/shared/puro" es lo que baja al navegador: ni zod ni un módulo que lo importe. */
describe("@isu/shared/puro", () => {
  it("no llega a zod por ningún import", () => {
    const vistos = new Set<string>();
    const externos: string[] = [];
    const pendientes = ["puro.ts"];
    while (pendientes.length) {
      const f = pendientes.pop()!;
      if (vistos.has(f)) continue;
      vistos.add(f);
      const codigo = readFileSync(new URL(f, import.meta.url), "utf8");
      // Los `import type` / `export type` no generan código.
      for (const [, de] of codigo.matchAll(/^(?:import|export) (?!type )[^;]*? from "([^"]+)"/gm)) {
        if (de!.startsWith("./")) pendientes.push(de!.slice(2).replace(/\.js$/, ".ts"));
        else externos.push(`${f} → ${de}`);
      }
    }
    expect(externos).toEqual([]);
    expect(vistos.has("talles.ts") && vistos.has("packs.ts") && vistos.has("constantes.ts")).toBe(true);
  });
});
