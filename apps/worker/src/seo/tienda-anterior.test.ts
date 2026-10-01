import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearPool, migrar } from "@isu/db";
import { guardar, proponer, skuDePagina, type Pedir } from "./tienda-anterior.js";

/* El lector de la tienda anterior, contra un sitio simulado (sin red). */
const URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:5433/stocker_test";
const pool = crearPool({ url: URL, max: 2 });
const BASE = "https://vieja.test";

const sitio: Record<string, string> = {
  [`${BASE}/sitemap.xml`]: `<?xml version="1.0"?><sitemapindex><sitemap><loc>${BASE}/sitemap-1.xml</loc></sitemap></sitemapindex>`,
  [`${BASE}/sitemap-1.xml`]: `<urlset>
    <url><loc>${BASE}/</loc></url>
    <url><loc>${BASE}/contact</loc></url>
    <url><loc>${BASE}/qa-sv-remera-mujer</loc></url>
    <url><loc>${BASE}/qa-sv-sin-sku-buzo-hombre</loc></url>
    <url><loc>${BASE}/minorista/qa-sv/hombre/pantalones</loc></url>
    <url><loc>${BASE}/Qa-Sv-Remera-Mujer/</loc></url>
  </urlset>`,
  [`${BASE}/qa-sv-remera-mujer`]: `<html><title>Remera QA - Isuwaya</title><script type="application/ld+json">{"sku":"QASVREMNEGM","x":1}{"sku":"QASVREM"}</script></html>`,
  [`${BASE}/qa-sv-sin-sku-buzo-hombre`]: `<html><title>Buzo canguro hombre</title></html>`,
};
const pedir: Pedir = async (u) => (sitio[u] ? { ok: true, status: 200, texto: sitio[u]! } : { ok: false, status: 404, texto: "" });

beforeAll(async () => {
  await migrar(pool);
  await pool.query("DELETE FROM tienda.redirecciones WHERE desde LIKE '/qa-sv%' OR desde LIKE '/minorista/qa-sv%'");
});
afterAll(async () => {
  await pool.query("DELETE FROM tienda.redirecciones WHERE desde LIKE '/qa-sv%' OR desde LIKE '/minorista/qa-sv%'");
  await pool.end();
});

describe("tienda anterior → redirecciones", () => {
  it("toma el SKU padre (el más corto) y el título de la ficha", () => {
    expect(skuDePagina(sitio[`${BASE}/qa-sv-remera-mujer`]!)).toEqual({ sku: "QASVREM", titulo: "Remera QA - Isuwaya" });
    expect(skuDePagina("<html></html>")).toEqual({ sku: null, titulo: null });
  });
  it("propone sólo lo que falta, con plan B deducido, y guardar no duplica", async () => {
    const p = await proponer(pool, BASE, pedir);
    const por = Object.fromEntries(p.map((x) => [x.desde, x]));
    // /contact ya viene de la migración; la raíz no se redirige; la versión con mayúsculas es la misma.
    expect(Object.keys(por).sort()).toEqual(["/minorista/qa-sv/hombre/pantalones", "/qa-sv-remera-mujer", "/qa-sv-sin-sku-buzo-hombre"]);
    expect(por["/qa-sv-remera-mujer"]).toMatchObject({ sku: "QASVREM", hacia: "/mujer/remeras-y-tops" });
    expect(por["/qa-sv-sin-sku-buzo-hombre"]).toMatchObject({ sku: null, hacia: "/hombre/buzos-y-camperas" });
    expect(por["/minorista/qa-sv/hombre/pantalones"]!.hacia).toBe("/hombre/pantalones");
    expect(await guardar(pool, p)).toBe(3);
    expect(await guardar(pool, p)).toBe(0);
    expect(await proponer(pool, BASE, pedir)).toEqual([]);
  });
});
