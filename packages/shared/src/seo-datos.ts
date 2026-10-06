import type { FotoPublica, ProductoDetalle, ProductoTarjeta } from "./catalogo.js";
import { compararTalles } from "./catalogo.js";
import { formatearPesos } from "./plata.js";
import type { ResenaPublica } from "./resenas.js";

/*
 * Lo que la tienda le dice a Google de cada página: datos estructurados
 * (schema.org), descripciones automáticas y el feed de Google Shopping.
 * Funciones puras: la tienda les pasa la dirección del sitio y cómo armar la
 * URL de una foto; acá no se lee el entorno.
 */
export interface ContextoSeo {
  /** https://www.isuwaya.com (sin barra final) */
  sitio: string;
  marca: string;
  /** URL absoluta de una foto */
  foto: (f: FotoPublica, ancho: 400 | 800 | 1200) => string;
  /** centavos; null = sin costo fijo publicado */
  costoEnvio: number | null;
  envioGratisDesde: number | null;
  cuotas: number;
  descuentoTransferencia: number;
  /** días para cambios y devoluciones */
  diasDevolucion: number;
}

const DISPONIBLE = "https://schema.org/InStock";
const POCAS = "https://schema.org/LimitedAvailability";
const AGOTADO = "https://schema.org/OutOfStock";
const precio = (c: number) => (c / 100).toFixed(2);
const sinUnico = (s: string | null | undefined) => (s && !/^[uú]nico$/i.test(s.trim()) ? s : null);

/** El público según la categoría principal: Google Shopping lo pide para ropa. */
export function publicoDe(rutas: string[]): { genero: "male" | "female" | "unisex"; edad: "adult" | "kids" } {
  const raiz = new Set(rutas.map((r) => r.split("/")[1]));
  if (raiz.has("ninos")) return { genero: "unisex", edad: "kids" };
  if (raiz.has("hombre") && raiz.has("mujer")) return { genero: "unisex", edad: "adult" };
  if (raiz.has("mujer")) return { genero: "female", edad: "adult" };
  if (raiz.has("hombre")) return { genero: "male", edad: "adult" };
  return { genero: "unisex", edad: "adult" };
}

/** Políticas que Google muestra junto al precio ("Envío $X · Devolución gratis 30 días"). */
export function envioYDevolucion(ctx: ContextoSeo, precioPrenda?: number) {
  // Si la prenda sola ya llega al envío gratis, se publica gratis.
  const envio = ctx.costoEnvio === null ? null : ctx.envioGratisDesde !== null && precioPrenda !== undefined && precioPrenda >= ctx.envioGratisDesde ? 0 : ctx.costoEnvio;
  return {
    shippingDetails: {
      "@type": "OfferShippingDetails",
      ...(envio !== null ? { shippingRate: { "@type": "MonetaryAmount", value: precio(envio), currency: "ARS" } } : {}),
      shippingDestination: { "@type": "DefinedRegion", addressCountry: "AR" },
      deliveryTime: {
        "@type": "ShippingDeliveryTime",
        handlingTime: { "@type": "QuantitativeValue", minValue: 0, maxValue: 2, unitCode: "DAY" },
        transitTime: { "@type": "QuantitativeValue", minValue: 1, maxValue: 7, unitCode: "DAY" },
      },
    },
    hasMerchantReturnPolicy: {
      "@type": "MerchantReturnPolicy",
      applicableCountry: "AR",
      returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
      merchantReturnDays: ctx.diasDevolucion,
      returnMethod: "https://schema.org/ReturnByMail",
      returnFees: "https://schema.org/FreeReturn",
      merchantReturnLink: `${ctx.sitio}/devoluciones`,
    },
  };
}

function fotosDe(p: ProductoDetalle, color: string | null): FotoPublica[] {
  // Sin color: todas, la principal primero. Con color: las de ese color y las generales; si no tiene, las del producto (como la ficha).
  const todas = color
    ? [...p.exhibicion.filter((f) => f.color === color), ...(p.colores.find((c) => c.clave === color)?.fotos ?? []), ...p.exhibicion.filter((f) => !f.color)]
    : [...p.exhibicion, ...p.colores.flatMap((c) => c.fotos)];
  const elegidas = todas.length || color === null ? todas : fotosDe(p, null);
  return elegidas.filter((f, i) => elegidas.findIndex((g) => g.clave === f.clave) === i);
}

/**
 * Ficha → ProductGroup con una variante por talle y color (precio, stock,
 * foto y dirección de cada una): Google puede mostrar "en 4 colores" y el
 * precio del talle que se buscó. Un producto de una sola variante va como
 * Product simple.
 */
export function jsonLdProducto(p: ProductoDetalle, ctx: ContextoSeo, descripcion: string, resenas: ResenaPublica[] = []): Record<string, unknown> {
  const url = `${ctx.sitio}/producto/${p.slug}`;
  const nombreColor = new Map(p.colores.map((c) => [c.clave, sinUnico(c.nombre)]));
  const publico = publicoDe(p.migas.map((m) => m.ruta));
  const audiencia = {
    "@type": "PeopleAudience",
    suggestedGender: publico.genero,
    ...(publico.edad === "kids" ? { suggestedMinAge: 2, suggestedMaxAge: 14 } : { suggestedMinAge: 13 }),
  };
  const variantes = [...p.variantes].sort((a, b) => (a.color ?? "").localeCompare(b.color ?? "") || compararTalles(a.talle ?? "", b.talle ?? ""));
  const oferta = (v: (typeof variantes)[number]) => ({
    "@type": "Offer",
    url: v.color && p.colores.length > 1 ? `${url}?color=${v.color}` : url,
    priceCurrency: "ARS",
    price: precio(v.precio),
    ...(v.precioLista && v.precioLista > v.precio
      ? { priceSpecification: { "@type": "UnitPriceSpecification", priceType: "https://schema.org/StrikethroughPrice", price: precio(v.precioLista), priceCurrency: "ARS" } }
      : {}),
    availability: v.stock <= 0 ? AGOTADO : v.stock <= 2 ? POCAS : DISPONIBLE,
    itemCondition: "https://schema.org/NewCondition",
    seller: { "@type": "Organization", name: ctx.marca },
    ...envioYDevolucion(ctx, v.precio),
  });
  const variante = (v: (typeof variantes)[number]) => {
    const color = v.color ? nombreColor.get(v.color) ?? null : null;
    const talle = sinUnico(v.talle);
    const fotos = fotosDe(p, v.color).slice(0, 3).map((f) => ctx.foto(f, 1200));
    return {
      "@type": "Product",
      sku: v.sku,
      name: [p.nombre, color, talle && `talle ${talle}`].filter(Boolean).join(" · "),
      ...(fotos.length ? { image: fotos } : {}),
      ...(color ? { color } : {}),
      ...(talle ? { size: talle } : {}),
      offers: oferta(v),
    };
  };
  const imagenes = fotosDe(p, null).slice(0, 6).map((f) => ctx.foto(f, 1200));
  const base = {
    "@context": "https://schema.org",
    name: p.nombre,
    description: descripcion,
    url,
    brand: { "@type": "Brand", name: ctx.marca },
    ...(imagenes.length ? { image: imagenes } : {}),
    audience: audiencia,
    ...(p.migas.length ? { category: p.migas.map((m) => m.nombre).join(" > ") } : {}),
    ...(p.composicion ? { material: p.composicion } : {}),
    // Etapa 8: las estrellas en Google. Son de compras entregadas (no se pueden escribir sin haber comprado).
    ...(p.resenas?.cantidad && p.resenas.promedio
      ? {
        aggregateRating: { "@type": "AggregateRating", ratingValue: p.resenas.promedio, reviewCount: p.resenas.cantidad, bestRating: 5, worstRating: 1 },
        ...(resenas.length ? {
          review: resenas.slice(0, 5).map((r) => ({
            "@type": "Review",
            reviewRating: { "@type": "Rating", ratingValue: r.estrellas, bestRating: 5, worstRating: 1 },
            author: { "@type": "Person", name: r.nombre },
            datePublished: r.fecha.slice(0, 10),
            ...(r.texto ? { reviewBody: r.texto } : {}),
          })),
        } : {}),
      }
      : {}),
  };
  if (variantes.length <= 1) {
    const v = variantes[0];
    return { ...base, "@type": "Product", sku: v?.sku ?? p.sku, ...(v ? { offers: oferta(v) } : {}) };
  }
  const varia = [
    ...(new Set(variantes.map((v) => v.color)).size > 1 ? ["https://schema.org/color"] : []),
    ...(new Set(variantes.map((v) => v.talle)).size > 1 ? ["https://schema.org/size"] : []),
  ];
  return {
    ...base,
    "@type": "ProductGroup",
    productGroupID: p.sku,
    ...(varia.length ? { variesBy: varia } : {}),
    hasVariant: variantes.map(variante),
  };
}

const lista = (xs: string[], max = 4) => {
  const u = [...new Set(xs)].slice(0, max);
  return u.length <= 1 ? u.join("") : `${u.slice(0, -1).join(", ")} y ${u.at(-1)}`;
};
const rangoTalles = (ts: string[]) => {
  const t = [...new Set(ts.filter((x) => sinUnico(x)))].sort(compararTalles);
  if (!t.length) return null;
  return t.length === 1 ? `talle ${t[0]}` : `talles ${t[0]} al ${t.at(-1)}`;
};
const condicionesLista = (ctx: Pick<ContextoSeo, "cuotas" | "descuentoTransferencia">) =>
  [ctx.descuentoTransferencia > 0 ? `${ctx.descuentoTransferencia}% OFF con transferencia` : null, ctx.cuotas > 1 ? `${ctx.cuotas} cuotas sin interés` : null, "envíos a todo el país"]
    .filter((x): x is string => !!x);
const condiciones = (ctx: Pick<ContextoSeo, "cuotas" | "descuentoTransferencia">) => condicionesLista(ctx).join(", ");
/** La primera versión que entra entera (Google corta ~160): de la más completa a la más corta. */
const laQueEntra = (versiones: string[], max = 158) => versiones.find((v) => v.length <= max) ?? recortar(versiones.at(-1)!, max);
const recortar = (t: string, max = 158) => {
  const limpio = t.replace(/\s+/g, " ").trim();
  if (limpio.length <= max) return limpio;
  const corte = limpio.slice(0, max - 1);
  return `${corte.slice(0, Math.max(corte.lastIndexOf(" "), max - 20))}…`;
};

/**
 * La frase que aparece debajo del título en Google. Si la ficha tiene una
 * descripción larga, sale de ahí; si no, se arma con colores, talles y precio
 * (que es lo que mira quien compara).
 */
export function descripcionProducto(p: ProductoDetalle, ctx: Pick<ContextoSeo, "marca" | "cuotas" | "descuentoTransferencia">): string {
  if (p.seoDescripcion) return p.seoDescripcion;
  const colores = p.colores.map((c) => sinUnico(c.nombre)).filter((c): c is string => !!c);
  const talles = rangoTalles(p.variantes.filter((v) => v.stock > 0).map((v) => v.talle ?? ""));
  const desde = `${p.precio < p.precioHasta ? "Desde " : ""}${formatearPesos(p.precio)}`;
  if (p.descripcion && p.descripcion.trim().length >= 80) return recortar(`${p.descripcion.trim()} ${desde}.`);
  const enColores = (n: number) => (colores.length ? ` en ${lista(colores, n)}${colores.length > n ? " y más colores" : ""}` : "");
  const conds = condicionesLista(ctx);
  const versiones: string[] = [];
  for (const marca of [` de ${ctx.marca}`, ""]) {
    for (const n of [4, 2]) {
      for (let k = conds.length; k >= 1; k--) {
        versiones.push(`${p.nombre}${marca}${enColores(n)}${talles ? `, ${talles}` : ""}. ${desde}: ${conds.slice(0, k).join(", ")}.`);
      }
    }
  }
  return laQueEntra(versiones);
}

/**
 * La descripción que se LEE en la ficha cuando la prenda no tiene una propia
 * (Stocker no las tiene; se cargan en el backoffice). Con lo que se sabe de
 * verdad: colores, talles, composición. Nada inventado.
 */
export function descripcionAutomatica(p: ProductoDetalle, marca: string): string {
  const colores = p.colores.map((c) => sinUnico(c.nombre)).filter((c): c is string => !!c);
  const talles = rangoTalles(p.variantes.map((v) => v.talle ?? ""));
  const frases = [
    `${p.nombre}${p.composicion ? `, ${p.composicion.charAt(0).toLowerCase()}${p.composicion.slice(1)}` : ""}.`,
    colores.length || talles ? `Disponible${colores.length ? ` en ${lista(colores, 6)}${colores.length > 6 ? " y más colores" : ""}` : ""}${talles ? `${colores.length ? "," : ""} ${talles}` : ""}.` : null,
    `Diseñada y confeccionada por ${marca}: talles reales y cumplidos.`,
    p.guiaTalles ? "Mirá la guía de talles para elegir el tuyo." : "¿Dudas con el talle? Escribinos por WhatsApp y te ayudamos.",
  ];
  return frases.filter(Boolean).join(" ");
}

/** Lo mismo para una categoría: qué hay, cuántas prendas, desde qué precio. */
export function descripcionCategoria(titulo: string, productos: ProductoTarjeta[], ctx: Pick<ContextoSeo, "marca" | "cuotas" | "descuentoTransferencia">): string {
  if (!productos.length) return recortar(`${titulo} de ${ctx.marca}: ${condiciones(ctx)}.`);
  const minimo = Math.min(...productos.map((p) => p.precio));
  const talles = rangoTalles(productos.flatMap((p) => p.talles));
  const conds = condicionesLista(ctx);
  const inicio = `${productos.length} ${productos.length === 1 ? "modelo" : "modelos"} de ${titulo.toLowerCase()} de ${ctx.marca} desde ${formatearPesos(minimo)}${talles ? `, ${talles}` : ""}.`;
  return laQueEntra(conds.map((_, i) => `${inicio} ${conds.slice(0, conds.length - i).join(", ").replace(/^./, (c) => c.toUpperCase())}.`));
}

/* ── Horario de los locales ("Lunes a viernes de 8 a 14 h") → schema.org ── */
const DIAS = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"] as const;
const DIAS_SCHEMA = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const hora = (h: string) => {
  const [hh, mm = "00"] = h.split(/[:.]/);
  const n = Number(hh);
  return Number.isInteger(n) && n >= 0 && n <= 24 && /^\d{2}$/.test(mm) ? `${String(n).padStart(2, "0")}:${mm}` : null;
};

/**
 * Entiende las formas habituales: "Lunes a viernes de 8 a 14 h", "Lun a Sáb
 * 10 a 19 hs", "Lunes a viernes de 9 a 18 h y sábados de 10 a 14 h". Lo que
 * no entiende lo deja afuera (mejor nada que un horario equivocado en Google).
 */
export function horarioSchema(texto: string): Array<{ "@type": "OpeningHoursSpecification"; dayOfWeek: string[]; opens: string; closes: string }> {
  const out: Array<{ "@type": "OpeningHoursSpecification"; dayOfWeek: string[]; opens: string; closes: string }> = [];
  const dia = (d: string) => DIAS.findIndex((x) => x.startsWith(d.slice(0, 3)));
  for (const tramo of sinTildes(texto).split(/\s*(?:;|,|\by\b|\n)\s*/)) {
    // Cuantificadores acotados sobre un tramo corto (el horario de un local, ≤ 120 caracteres).
    // eslint-disable-next-line security/detect-unsafe-regex
    const m = tramo.slice(0, 120).match(/([a-z]{3,9})s?(?:\s+(?:a|al|-)\s+([a-z]{3,9}))?\s+(?:de\s+)?(\d{1,2}(?:[:.]\d{2})?)\s*(?:a|-|hasta)\s*(\d{1,2}(?:[:.]\d{2})?)/);
    // Un tramo con días pero sin horario ("Lunes, miércoles y viernes de 9 a 13"): no se adivina.
    if (!m) { if (DIAS.some((d) => tramo.includes(d.slice(0, 3)))) return []; continue; }
    const desde = dia(m[1]!);
    const hasta = m[2] ? dia(m[2]) : desde;
    const abre = hora(m[3]!);
    const cierra = hora(m[4]!);
    if (desde < 0 || hasta < desde || !abre || !cierra || cierra <= abre) return [];
    out.push({ "@type": "OpeningHoursSpecification", dayOfWeek: DIAS_SCHEMA.slice(desde, hasta + 1), opens: abre, closes: cierra });
  }
  return out;
}

/* ── Feed de Google Merchant Center (Google Shopping, gratis) ── */
export interface ItemFeed {
  id: string; item_group_id: string; title: string; description: string; link: string; image_link: string;
  additional_image_link: string[]; availability: "in_stock" | "out_of_stock"; price: string; sale_price: string | null;
  brand: string; condition: "new"; color: string | null; size: string | null; gender: string; age_group: string;
  google_product_category: string; product_type: string; identifier_exists: "no"; shipping_price: string | null;
}

/** Una fila por variante (talle × color), agrupadas por producto. Sin foto no se publica: Google la rechaza. */
export function itemsFeed(p: ProductoDetalle, ctx: ContextoSeo, descripcion: string): ItemFeed[] {
  const nombreColor = new Map(p.colores.map((c) => [c.clave, sinUnico(c.nombre)]));
  const publico = publicoDe(p.migas.map((m) => m.ruta));
  const pesos = (c: number) => `${precio(c)} ARS`;
  const items: ItemFeed[] = [];
  for (const v of p.variantes) {
    const fotos = fotosDe(p, v.color);
    if (!fotos.length) continue;
    const color = v.color ? nombreColor.get(v.color) ?? null : null;
    const talle = sinUnico(v.talle);
    const rebajado = !!v.precioLista && v.precioLista > v.precio;
    items.push({
      id: v.sku,
      item_group_id: p.sku,
      title: [p.nombre, color, talle && `Talle ${talle}`].filter(Boolean).join(" - ").slice(0, 150),
      description: descripcion.slice(0, 5000),
      link: v.color && p.colores.length > 1 ? `${ctx.sitio}/producto/${p.slug}?color=${v.color}` : `${ctx.sitio}/producto/${p.slug}`,
      image_link: ctx.foto(fotos[0]!, 1200),
      additional_image_link: fotos.slice(1, 10).map((f) => ctx.foto(f, 1200)),
      availability: v.stock > 0 ? "in_stock" : "out_of_stock",
      price: pesos(rebajado ? v.precioLista! : v.precio),
      sale_price: rebajado ? pesos(v.precio) : null,
      brand: ctx.marca,
      condition: "new",
      color,
      size: talle ?? (v.talle ? "Único" : null),
      gender: publico.genero,
      age_group: publico.edad,
      // 1604 = Indumentaria y accesorios > Ropa (taxonomía de Google).
      google_product_category: "1604",
      product_type: p.migas.map((m) => m.nombre).join(" > ") || "Ropa",
      identifier_exists: "no",
      shipping_price: ctx.costoEnvio !== null ? pesos(ctx.envioGratisDesde !== null && v.precio >= ctx.envioGratisDesde ? 0 : ctx.costoEnvio) : null,
    });
  }
  return items;
}

const xml = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!)
  // Caracteres de control: XML no los admite y Merchant Center rechaza el archivo entero.
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

/** RSS 2.0 con el espacio g: (lo que pide Merchant Center como "feed programado"). */
export function feedXml(items: ItemFeed[], ctx: Pick<ContextoSeo, "sitio" | "marca">): string {
  const campo = (k: string, v: string | null) => (v === null || v === "" ? "" : `<g:${k}>${xml(v)}</g:${k}>`);
  const filas = items.map((i) => [
    "<item>",
    campo("id", i.id), campo("item_group_id", i.item_group_id), `<title>${xml(i.title)}</title>`,
    `<description>${xml(i.description)}</description>`, `<link>${xml(i.link)}</link>`,
    campo("image_link", i.image_link), ...i.additional_image_link.map((u) => campo("additional_image_link", u)),
    campo("availability", i.availability), campo("price", i.price), campo("sale_price", i.sale_price),
    campo("brand", i.brand), campo("condition", i.condition), campo("color", i.color), campo("size", i.size),
    campo("gender", i.gender), campo("age_group", i.age_group), campo("google_product_category", i.google_product_category),
    campo("product_type", i.product_type), campo("identifier_exists", i.identifier_exists),
    i.shipping_price ? `<g:shipping><g:country>AR</g:country><g:price>${xml(i.shipping_price)}</g:price></g:shipping>` : "",
    "</item>",
  ].join(""));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel><title>${xml(ctx.marca)}</title><link>${xml(ctx.sitio)}</link><description>${xml(`Catálogo de ${ctx.marca}`)}</description>\n${filas.join("\n")}\n</channel></rss>\n`;
}
