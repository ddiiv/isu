import { describe, expect, it } from "vitest";
import { terminoBusqueda } from "./texto.js";

describe("terminoBusqueda (search_term de GA4)", () => {
  it("manda el texto buscado, recortado a 100", () => {
    expect(terminoBusqueda("  remera oversize ")).toBe("remera oversize");
    expect(terminoBusqueda("a".repeat(150))).toHaveLength(100);
  });
  it("no manda un email ni un número largo", () => {
    expect(terminoBusqueda("juan@mail.com")).toBeNull();
    expect(terminoBusqueda("12345678")).toBeNull();
    expect(terminoBusqueda("11 5555-1234")).toBeNull();
    expect(terminoBusqueda("")).toBeNull();
  });
  it("deja pasar números cortos (talles, años)", () => {
    expect(terminoBusqueda("remera 2024")).toBe("remera 2024");
    expect(terminoBusqueda("talle 42")).toBe("talle 42");
  });
});
