import { describe, expect, it } from "vitest";
import { leerEleccion, valoresConsentimiento } from "./consentimiento.js";

describe("consentimiento", () => {
  it("sólo acepta granted y denied", () => {
    expect(leerEleccion("granted")).toBe("granted");
    expect(leerEleccion("denied")).toBe("denied");
    for (const raro of [null, undefined, "", "GRANTED", "true", 1, {}]) expect(leerEleccion(raro)).toBeNull();
  });
  it("manda los 4 valores iguales a la elección", () => {
    expect(valoresConsentimiento("denied")).toEqual({ ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "denied" });
  });
});
