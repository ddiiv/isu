/* eslint-disable @typescript-eslint/no-explicit-any -- los datos estructurados son JSON sin tipo */
import { describe, expect, it } from "vitest";
import {
  RedireccionEntrada, descripcionAutomatica, descripcionCategoria, descripcionProducto, feedXml, horarioSchema, itemsFeed, jsonLdProducto, publicoDe, rutaPropia, rutaVieja,
  type ContextoSeo, type ProductoDetalle, type ProductoTarjeta,
} from "./index.js";

const ctx: ContextoSeo = {
  sitio: "https://www.isuwaya.com", marca: "Isuwaya", foto: (f, w) => `https://fotos.isuwaya.com/${f.clave}-${w}.webp`,
  costoEnvio: 790_000, envioGratisDesde: 5_000_000, cuotas: 3, descuentoTransferencia: 20, diasDevolucion: 30,
};
const foto = (clave: string) => ({ clave, ancho: 1200, alto: 1500, alt: null });
const producto = (cambios: Partial<ProductoDetalle> = {}): ProductoDetalle => ({
  id: 1, slug: "abel-pantalon-hombre", nombre: "Abel Pantalón Hombre", descripcion: null, seoTitulo: null, seoDescripcion: null, sku: "ISUABEPAN",
  migas: [{ nombre: "Hombre", ruta: "/hombre" }, { nombre: "Pantalones", ruta: "/hombre/pantalones" }],
  colores: [
    { clave: "negro", nombre: "Negro", hex: "#000", fotos: [foto("p/1/negro1"), foto("p/1/negro2")] },
    { clave: "azul", nombre: "Azul", hex: "#00f", fotos: [foto("p/1/azul1")] },
  ],
  exhibicion: [{ ...foto("p/1/principal"), color: "negro" }],
  variantes: [
    { sku: "ISUABEPANNEGS", color: "negro", talle: "S", precio: 4_000_000, precioLista: null, stock: 5 },
    { sku: "ISUABEPANNEGM", color: "negro", talle: "M", precio: 4_000_000, precioLista: null, stock: 1 },
    { sku: "ISUABEPANAZUS", color: "azul", talle: "S", precio: 3_200_000, precioLista: 4_000_000, stock: 0 },
  ],
  precio: 3_200_000, precioHasta: 4_000_000, precioLista: null, descuento: null, agotado: false, guiaTalles: null, actualizadoEn: "2026-10-01T00:00:00Z",
  ...cambios,
});

describe("direcciones de las redirecciones", () => {
  it("guarda la dirección vieja normalizada", () => {
    expect(rutaVieja("https://www.isuwaya.com/Abel-Pantalon-Hombre/?ref=x#top")).toBe("/abel-pantalon-hombre");
    expect(rutaVieja("/minorista//hombre/remeras/")).toBe("/minorista/hombre/remeras");
    expect(rutaVieja("contact")).toBe("/contact");
  });
  it("no redirige la raíz ni rutas internas", () => {
    expect(rutaVieja("/")).toBeNull();
    expect(rutaVieja("https://www.isuwaya.com/")).toBeNull();
    expect(rutaVieja("/api/salud")).toBeNull();
    expect(rutaVieja("/_next/static/x.js")).toBeNull();
    expect(rutaVieja("/con espacio")).toBe("/con%20espacio");
  });
  it("el destino es siempre una página de esta tienda", () => {
    expect(rutaPropia("/hombre/remeras")).toBe("/hombre/remeras");
    expect(rutaPropia("/buscar?q=lino")).toBe("/buscar?q=lino");
    expect(rutaPropia("https://www.isuwaya.com/locales?x=1")).toBe("/locales?x=1");
    for (const malo of ["//evil.com", "/\\evil.com", "https://evil.com//x", "javascript:alert(1)", "hombre", "/a b", "", "/\tx"]) {
      expect(rutaPropia(malo), malo).toBeNull();
    }
  });
  it("valida la entrada del backoffice", () => {
    expect(RedireccionEntrada.parse({ desde: "https://www.isuwaya.com/Akil-Short", hacia: "/hombre", sku: "isuakisho" })).toEqual({ desde: "/akil-short", hacia: "/hombre", sku: "ISUAKISHO" });
    expect(RedireccionEntrada.safeParse({ desde: "/", hacia: "/hombre" }).success).toBe(false);
    expect(RedireccionEntrada.safeParse({ desde: "/x", hacia: "https://evil.com/" }).success).toBe(true); // se queda con la ruta: "/"
    expect(RedireccionEntrada.parse({ desde: "/x", hacia: "https://evil.com/robar" }).hacia).toBe("/robar");
    expect(RedireccionEntrada.safeParse({ desde: "/hombre", hacia: "/hombre" }).success).toBe(false);
    expect(RedireccionEntrada.safeParse({ desde: "/x", hacia: "//evil.com" }).success).toBe(false);
  });
});

describe("datos estructurados del producto", () => {
  it("arma un ProductGroup con una variante por talle y color", () => {
    const d = jsonLdProducto(producto(), ctx, "desc") as Record<string, any>;
    expect(d["@type"]).toBe("ProductGroup");
    expect(d.productGroupID).toBe("ISUABEPAN");
    expect(d.variesBy).toEqual(["https://schema.org/color", "https://schema.org/size"]);
    expect(d.hasVariant).toHaveLength(3);
    const azul = d.hasVariant.find((v: any) => v.sku === "ISUABEPANAZUS");
    expect(azul).toMatchObject({ color: "Azul", size: "S", name: "Abel Pantalón Hombre · Azul · talle S" });
    expect(azul.image[0]).toBe("https://fotos.isuwaya.com/p/1/azul1-1200.webp");
    expect(azul.offers).toMatchObject({ price: "32000.00", priceCurrency: "ARS", availability: "https://schema.org/OutOfStock", url: "https://www.isuwaya.com/producto/abel-pantalon-hombre?color=azul" });
    expect(azul.offers.priceSpecification).toMatchObject({ priceType: "https://schema.org/StrikethroughPrice", price: "40000.00" });
    const m = d.hasVariant.find((v: any) => v.sku === "ISUABEPANNEGM");
    expect(m.offers.availability).toBe("https://schema.org/LimitedAvailability");
    expect(m.offers.shippingDetails.shippingRate.value).toBe("7900.00");
    expect(m.offers.hasMerchantReturnPolicy).toMatchObject({ merchantReturnDays: 30, applicableCountry: "AR" });
    expect(d.audience.suggestedGender).toBe("male");
    expect(d.image[0]).toContain("principal");
  });
  it("si la prenda sola llega al envío gratis, publica el envío en $0", () => {
    const d = jsonLdProducto(producto({ variantes: [{ sku: "A", color: "negro", talle: "S", precio: 6_000_000, precioLista: null, stock: 3 }, { sku: "B", color: "negro", talle: "M", precio: 6_000_000, precioLista: null, stock: 3 }] }), ctx, "d") as Record<string, any>;
    expect(d.hasVariant[0].offers.shippingDetails.shippingRate.value).toBe("0.00");
  });
  it("una sola variante va como Product simple", () => {
    const d = jsonLdProducto(producto({ variantes: [{ sku: "ISUX", color: null, talle: "Único", precio: 1_000_000, precioLista: null, stock: 4 }], colores: [] }), ctx, "d") as Record<string, any>;
    expect(d["@type"]).toBe("Product");
    expect(d.sku).toBe("ISUX");
    expect(d.offers.price).toBe("10000.00");
  });
  it("el público sale de la categoría", () => {
    expect(publicoDe(["/mujer/remeras-y-tops"])).toEqual({ genero: "female", edad: "adult" });
    expect(publicoDe(["/ninos/remeras"])).toEqual({ genero: "unisex", edad: "kids" });
    expect(publicoDe(["/hombre", "/mujer"])).toEqual({ genero: "unisex", edad: "adult" });
  });
});

describe("descripciones automáticas", () => {
  it("producto: colores, talles con stock y precio, sin cortar a mitad de frase", () => {
    const d = descripcionProducto(producto(), ctx);
    expect(d).toContain("en Negro y Azul");
    expect(d).toContain("talles S al M");
    expect(d).toContain("Desde $");
    expect(d.length).toBeLessThanOrEqual(158);
    expect(d.endsWith(".")).toBe(true);
    const muchos = producto({ nombre: "Pantalón cargo de gabardina elastizada con puño", colores: ["Negro", "Verde militar", "Beige arena", "Gris topo", "Azul marino", "Bordó"].map((n, i) => ({ clave: `c${i}`, nombre: n, hex: null, fotos: [] })) });
    const dm = descripcionProducto(muchos, ctx);
    expect(dm.length).toBeLessThanOrEqual(158);
    expect(dm).toContain("y más colores");
    expect(dm.endsWith(".")).toBe(true);
  });
  it("usa la del backoffice o la descripción larga si hay", () => {
    expect(descripcionProducto(producto({ seoDescripcion: "La mía" }), ctx)).toBe("La mía");
    const larga = "Pantalón de gabardina elastizada con bolsillos cargo, cintura con elástico y cordón. Ideal para todos los días.";
    expect(descripcionProducto(producto({ descripcion: larga }), ctx)).toMatch(/^Pantalón de gabardina/);
  });
  it("categoría: cantidad, precio desde y talles", () => {
    const t = (precio: number, talles: string[]) => ({ precio, talles }) as unknown as ProductoTarjeta;
    const d = descripcionCategoria("Remeras de hombre", [t(1_800_000, ["S", "M"]), t(2_500_000, ["XL"])], ctx);
    expect(d.replace(/\s/g, " ")).toBe("2 modelos de remeras de hombre de Isuwaya desde $ 18.000, talles S al XL. 20% OFF con transferencia, 3 cuotas sin interés, envíos a todo el país.");
  });
});

describe("horario de los locales", () => {
  it("entiende las formas habituales", () => {
    expect(horarioSchema("Lunes a viernes de 8 a 14 h")).toEqual([{ "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], opens: "08:00", closes: "14:00" }]);
    expect(horarioSchema("Lunes a viernes de 9 a 18 h y sábados de 10:30 a 14 h").map((h) => [h.dayOfWeek.length, h.opens, h.closes])).toEqual([[5, "09:00", "18:00"], [1, "10:30", "14:00"]]);
  });
  it("lo que no entiende no lo inventa", () => {
    expect(horarioSchema("Lunes, miércoles y viernes de 9 a 13")).toEqual([]);
    expect(horarioSchema("Consultar por WhatsApp")).toEqual([]);
    expect(horarioSchema("Lunes a viernes de 18 a 9")).toEqual([]);
  });
});

describe("feed de Google Shopping", () => {
  it("una fila por variante, con oferta, foto del color y envío", () => {
    const items = itemsFeed(producto(), ctx, "Descripción <con> & cosas");
    expect(items).toHaveLength(3);
    const azul = items.find((i) => i.id === "ISUABEPANAZUS")!;
    expect(azul).toMatchObject({ item_group_id: "ISUABEPAN", color: "Azul", size: "S", price: "40000.00 ARS", sale_price: "32000.00 ARS", availability: "out_of_stock", gender: "male", age_group: "adult", shipping_price: "7900.00 ARS" });
    expect(azul.image_link).toBe("https://fotos.isuwaya.com/p/1/azul1-1200.webp");
    expect(azul.link).toBe("https://www.isuwaya.com/producto/abel-pantalon-hombre?color=azul");
    const xml = feedXml(items, ctx);
    expect(xml).toContain('xmlns:g="http://base.google.com/ns/1.0"');
    expect(xml).toContain("Descripción &lt;con&gt; &amp; cosas");
    expect(xml.match(/<item>/g)).toHaveLength(3);
  });
  it("sin fotos no se publica (Merchant Center la rechaza)", () => {
    expect(itemsFeed(producto({ exhibicion: [], colores: [{ clave: "negro", nombre: "Negro", hex: null, fotos: [] }] }), ctx, "d")).toEqual([]);
  });
  it("escapa caracteres de control que romperían el XML", () => {
    const items = itemsFeed(producto({ nombre: "Remera\u0001 «Box»" }), ctx, "d");
    expect(feedXml(items, ctx).includes("\u0001")).toBe(false);
  });
});

describe("reseñas y descripción (etapa 8)", () => {
  it("con reseñas publicadas, las estrellas van en los datos para Google", () => {
    const p = producto({ resenas: { promedio: 4.5, cantidad: 2 }, composicion: "100% algodón" } as never);
    const d = jsonLdProducto(p, ctx, "desc", [
      { id: 1, nombre: "Ana G.", estrellas: 5, texto: "Hermosa", calce: "justo", talle: "M", color: null, fecha: "2026-10-01T12:00:00.000Z", respuesta: null },
    ]) as Record<string, any>;
    expect(d.aggregateRating).toEqual({ "@type": "AggregateRating", ratingValue: 4.5, reviewCount: 2, bestRating: 5, worstRating: 1 });
    expect(d.review[0]).toMatchObject({ author: { name: "Ana G." }, reviewRating: { ratingValue: 5 }, datePublished: "2026-10-01", reviewBody: "Hermosa" });
    expect(d.material).toBe("100% algodón");
    // Sin reseñas, nada (Google castiga estrellas inventadas).
    expect((jsonLdProducto(producto(), ctx, "d") as Record<string, any>).aggregateRating).toBeUndefined();
  });
  it("la descripción automática dice sólo lo que se sabe", () => {
    const t = descripcionAutomatica(producto({ composicion: "100% Algodón jersey" } as never), "Isuwaya");
    expect(t).toContain(", 100% Algodón jersey.");
    expect(t).toMatch(/Disponible en /);
    expect(t).toMatch(/Isuwaya/);
  });
});
