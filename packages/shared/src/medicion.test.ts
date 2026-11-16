import { describe, expect, it } from "vitest";
import { eventoMeta, idClarity, idMeta } from "./medicion.js";

describe("medición: Pixel de Meta y Clarity", () => {
  it("sólo IDs con la forma correcta (van a una dirección y a un script)", () => {
    expect(idMeta("123456789012345")).toBe("123456789012345");
    expect(["", "12", "1234567'; alert(1)", undefined].map(idMeta)).toEqual([null, null, null, null]);
    expect(idClarity("abcd1234ef")).toBe("abcd1234ef");
    expect(["", "AB", "x'y\"z0123", undefined].map(idClarity)).toEqual([null, null, null, null]);
  });
  it("los eventos de GA4 pasan a los estándar de Meta", () => {
    const items = [{ item_id: "SKU1", quantity: 2 }, { item_id: "SKU2" }];
    expect(eventoMeta("view_item", { value: 100, items })).toEqual(["ViewContent", { content_type: "product", content_ids: ["SKU1", "SKU2"], currency: "ARS", value: 100 }]);
    expect(eventoMeta("add_to_cart", { items })![0]).toBe("AddToCart");
    expect(eventoMeta("begin_checkout", { value: 5, items })![1]).toMatchObject({ num_items: 3, value: 5 });
    expect(eventoMeta("purchase", { value: 9, transaction_id: "ISU-1042", items })).toEqual(["Purchase", { content_type: "product", content_ids: ["SKU1", "SKU2"], currency: "ARS", value: 9, num_items: 3 }, "purchase-ISU-1042"]);
    expect(eventoMeta("search", { search_term: "musculosa" })).toEqual(["Search", { search_string: "musculosa" }]);
    expect(eventoMeta("select_item", { items })).toBeNull();
    expect(eventoMeta("search", {})).toBeNull();
  });
});
