import type { FotoPublica, ProductoDetalle, ProductoTarjeta } from "./catalogo.js";
import { compararTalles } from "./talles.js";
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
 * Para el catálogo de WhatsApp: las fotos de ese color y nada más; si el color
 * no tiene, las generales (sin color). Nunca las de otro color: sin ninguna,
 * esa variante no sale (Meta pide foto).
 */
function fotosDelColor(p: ProductoDetalle, color: string | null): FotoPublica[] {
  if (color === null) return fotosDe(p, null);
  const propias = [...p.exhibicion.filter((f) => f.color === color), ...(p.colores.find((c) => c.clave === color)?.fotos ?? [])];
  const elegidas = propias.length ? propias : p.exhibicion.filter((f) => !f.color);
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

/*
 * Cómo se ve la marca en Google (etapa 13). Al buscar «Isuwaya», el primer
 * resultado es el inicio, con estas frases debajo del título, y Google le
 * suma accesos a las páginas principales (Mujer, Hombre, Contacto…).
 */

/** La del inicio: qué es la tienda, para quién y las condiciones de hoy (los envíos primero). */
export function descripcionInicio(categorias: string[], ctx: Pick<ContextoSeo, "marca" | "cuotas" | "descuentoTransferencia">): string {
  const para = categorias.length ? ` para ${lista(categorias.map((c) => c.toLowerCase()), 4)}` : "";
  const conds = ["envíos a todo el país", ...condicionesLista(ctx).filter((c) => !c.startsWith("envíos"))];
  const versiones: string[] = [];
  // Más condiciones antes que una frase más larga: de cada cantidad, la versión larga y la corta.
  for (let k = conds.length; k >= 1; k--) {
    const c = lista(conds.slice(0, k), 4);
    const cond = `${c.charAt(0).toUpperCase()}${c.slice(1)}`;
    versiones.push(`${ctx.marca} — Tienda online de ropa urbana y casual. La fabricamos con talles reales${para} — ${cond}.`);
    versiones.push(`${ctx.marca} — Tienda online de ropa que fabricamos con talles reales${para ? `,${para}` : ""} — ${cond}.`);
  }
  return laQueEntra(versiones);
}

/**
 * La de una categoría de arriba (Mujer, Hombre, Niños), con sus
 * subcategorías de verdad: «Explorá toda la ropa de mujer Isuwaya: remeras y
 * tops, pantalones y calzas…».
 */
export function descripcionCategoriaPrincipal(nombre: string, hijas: string[], ctx: Pick<ContextoSeo, "marca" | "cuotas" | "descuentoTransferencia">): string {
  const base = `Explorá toda la ropa de ${nombre.toLowerCase()} ${ctx.marca}`;
  const subs = [...new Set(hijas.map((h) => h.trim().toLowerCase()).filter(Boolean))];
  const conds = condicionesLista(ctx);
  const versiones: string[] = [];
  for (let n = Math.min(subs.length, 6); n >= 0; n--) {
    const que = n ? `: ${subs.slice(0, n).join(", ")}${subs.length > n ? " y más" : ""}` : "";
    for (let k = conds.length; k >= 1; k--) versiones.push(`${base}${que}. Talles reales, ${conds.slice(0, k).join(", ")}.`);
  }
  return laQueEntra(versiones);
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
  /** WhatsApp: "principal" en una variante por producto (los conjuntos filtran por esto). */
  custom_label_0?: string;
}

/** Una fila por variante (talle × color), agrupadas por producto. Sin foto no se publica: Google la rechaza. */
export function itemsFeed(p: ProductoDetalle, ctx: ContextoSeo, descripcion: string, opciones: { soloFotosDelColor?: boolean; sinFoto?: string } = {}): ItemFeed[] {
  const nombreColor = new Map(p.colores.map((c) => [c.clave, sinUnico(c.nombre)]));
  const publico = publicoDe(p.migas.map((m) => m.ruta));
  const pesos = (c: number) => `${precio(c)} ARS`;
  const items: ItemFeed[] = [];
  for (const v of p.variantes) {
    const fotos = opciones.soloFotosDelColor ? fotosDelColor(p, v.color) : fotosDe(p, v.color);
    if (!fotos.length && !opciones.sinFoto) continue;
    const color = v.color ? nombreColor.get(v.color) ?? null : null;
    const talle = sinUnico(v.talle);
    const rebajado = !!v.precioLista && v.precioLista > v.precio;
    items.push({
      id: v.sku,
      item_group_id: p.sku,
      title: [p.nombre, color, talle && `Talle ${talle}`].filter(Boolean).join(" - ").slice(0, 150),
      description: descripcion.slice(0, 5000),
      link: v.color && p.colores.length > 1 ? `${ctx.sitio}/producto/${p.slug}?color=${v.color}` : `${ctx.sitio}/producto/${p.slug}`,
      image_link: fotos[0] ? ctx.foto(fotos[0], 1200) : opciones.sinFoto!,
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

/**
 * El feed de Google con los precios del portal mayorista (el catálogo de
 * WhatsApp vende por mayor). `precios`: SKU de variante en mayúsculas → precio
 * en pesos. Sólo quedan las variantes con precio mayorista > 0; sin oferta, sin
 * envío y con el link del portal (la tienda minorista tiene otros precios).
 */
// Meta no documenta WebP: la API sirve la misma foto en .jpg.
// shortcut: con CDN (R2) la foto no es de /fotos/ y queda en .webp, porque la .jpg no existe ahí; subir también las .jpg antes de usar CDN en este feed.
const aJpg = (u: string) => u.replace(/(\/fotos\/p\/[^?#]*)\.webp$/, "$1.jpg");

export function itemsFeedMayorista(items: ItemFeed[], precios: ReadonlyMap<string, number>, link: string): ItemFeed[] {
  return items.flatMap((i) => {
    const mayorista = precios.get(i.id.trim().toUpperCase());
    if (!mayorista || !(mayorista > 0)) return [];
    return [{ ...i, link, price: `${mayorista.toFixed(2)} ARS`, sale_price: null, shipping_price: null, image_link: aJpg(i.image_link), additional_image_link: i.additional_image_link.map(aJpg) }];
  });
}

/** Un producto del portal mayorista, con lo que se sepa de él, para el catálogo de WhatsApp. */
export interface ProductoWhatsapp {
  sku: string;
  titulo: string;
  descripcion: string;
  /** Lo que vende el portal, con el precio mayorista en pesos. */
  combinaciones: { color?: string | null; talle?: string | null; precio?: number | null }[];
  /** Precio del producto en pesos, si ninguna combinación trae el suyo. */
  precio?: number | null;
  /** Direcciones absolutas, la principal primero. Sin ninguna va la imagen de la marca. */
  fotos: string[];
  tipo: string;
  genero: string;
  edad: string;
  /** Ningún color ni talle con stock: sale igual, avisando. */
  sinStock: boolean;
}

/**
 * Un artículo por producto: WhatsApp mostraba cada variante suelta ("Cairo Remera - Blanco - Talle L")
 * y el dueño quiere ver los productos, TODOS, aunque no tengan stock o fotos. Siempre "disponible":
 * sin stock, la descripción lo avisa (el asistente confirma en la charla). Colores, talles y el rango
 * de precio van en la descripción; el precio es el más bajo. Sin ningún precio no se puede publicar.
 */
export function detalleWhatsapp(combinaciones: ProductoWhatsapp["combinaciones"], precio?: number | null): { desde: number; texto: string } | null {
  const pesos = combinaciones.map((c) => Number(c.precio)).filter((n) => n > 0);
  if (!pesos.length && Number(precio) > 0) pesos.push(Number(precio));
  if (!pesos.length) return null;
  const [desde, hasta] = [Math.min(...pesos), Math.max(...pesos)];
  // Sin repetir por mayúsculas ("3XL" y "3Xl" en Stocker): queda la primera forma que aparece.
  const unicos = (xs: (string | null | undefined)[]) => {
    const vistos = new Map<string, string>();
    for (const x of xs.map((y) => y?.trim())) if (x && !vistos.has(x.toLowerCase())) vistos.set(x.toLowerCase(), x);
    return [...vistos.values()];
  };
  const colores = unicos(combinaciones.map((c) => c.color));
  const talles = unicos(combinaciones.map((c) => c.talle)).sort(compararTalles);
  const texto = [
    colores.length && `Colores: ${colores.join(", ")}.`,
    talles.length && `Talles: ${talles.join(", ")}.`,
    desde !== hasta && `Precio por mayor de ${formatearPesos(desde * 100)} a ${formatearPesos(hasta * 100)} según talle y color.`,
  ].filter(Boolean).join("\n");
  return { desde, texto };
}

const POCO_STOCK = "Poco stock: consultanos disponibilidad antes de pedir.";

export function itemWhatsapp(p: ProductoWhatsapp, ctx: Pick<ContextoSeo, "marca" | "sitio">, link: string): ItemFeed | null {
  const d = detalleWhatsapp(p.combinaciones, p.precio);
  if (!d) return null;
  const fotos = [...new Set(p.fotos.map(aJpg))];
  // shortcut: sin fotos va el ícono de la tienda (512 px, el mínimo de Meta es 500); cargarle fotos en isu lo reemplaza solo.
  if (!fotos.length) fotos.push(`${ctx.sitio}/icon.png`);
  return {
    id: p.sku,
    item_group_id: "",
    title: p.titulo.slice(0, 150),
    description: [p.sinStock && POCO_STOCK, p.descripcion.trim() || p.titulo, d.texto]
      .filter(Boolean).join("\n\n").slice(0, 5000),
    link,
    image_link: fotos[0]!,
    additional_image_link: fotos.slice(1, 10),
    availability: "in_stock",
    price: `${d.desde.toFixed(2)} ARS`,
    sale_price: null,
    brand: ctx.marca,
    condition: "new",
    color: null,
    size: null,
    gender: p.genero,
    age_group: p.edad,
    google_product_category: "1604",
    product_type: p.tipo || "Ropa",
    identifier_exists: "no",
    shipping_price: null,
    custom_label_0: "principal",
  };
}

/**
 * Las variantes de un producto de la tienda para WhatsApp. WhatsApp las agrupa en la ficha (elegís color
 * y talle), pero en la lista y en los conjuntos muestra cada una suelta: todas llevan el título del
 * producto y UNA queda como "principal" (custom_label_0) para que los conjuntos filtren un producto por
 * modelo. La principal: con stock, la de la foto principal y la más barata. Todas salen "disponibles";
 * la que no tiene stock lo avisa en la descripción.
 */
export function variantesWhatsapp(p: ProductoDetalle, ctx: Pick<ContextoSeo, "foto">, variantes: ItemFeed[], tipo: string): ItemFeed[] {
  if (!variantes.length) return [];
  const portada = fotosDe(p, null)[0];
  const fotoPrincipal = portada ? aJpg(ctx.foto(portada, 1200)) : null;
  const puntaje = (v: ItemFeed) => [v.availability === "in_stock" ? 0 : 1, v.image_link === fotoPrincipal ? 0 : 1, Number.parseFloat(v.price)];
  const principal = [...variantes].sort((a, b) => {
    const [x, y] = [puntaje(a), puntaje(b)];
    return x[0]! - y[0]! || x[1]! - y[1]! || x[2]! - y[2]!;
  })[0];
  return variantes.map((v) => ({
    ...v,
    title: p.nombre.slice(0, 150),
    description: [v.availability === "out_of_stock" && POCO_STOCK, v.description].filter(Boolean).join("\n\n").slice(0, 5000),
    availability: "in_stock" as const,
    product_type: tipo || v.product_type,
    custom_label_0: v === principal ? "principal" : "",
  }));
}

/**
 * Las categorías del portal ("Remeras", "Top", "Musculosa") en las de la tienda ("Mujer > Remeras y tops"),
 * que son las que filtran los conjuntos del catálogo de WhatsApp.
 */
export function tipoDesdePortal(genero: string, categoria: string): string {
  const c = categoria.toLowerCase();
  const mujer = genero === "Mujer";
  const grupo = /buzo|campera/.test(c) ? (genero === "Niños" ? "Camperas" : "Buzos y camperas")
    : /short|bermuda/.test(c) ? "Shorts y bermudas"
      : /pantal|calza|jogger/.test(c) ? (mujer ? "Pantalones y calzas" : "Pantalones")
        : /remera|top|musculosa/.test(c) ? (mujer ? "Remeras y tops" : "Remeras")
          : categoria.trim();
  return [genero.trim(), grupo].filter(Boolean).join(" > ");
}

/** El público de un producto del portal ("Hombre", "Mujer", "Niños"), como lo pide Meta. */
export function publicoDePortal(genero: string): { genero: "male" | "female" | "unisex"; edad: "adult" | "kids" } {
  if (genero === "Niños") return { genero: "unisex", edad: "kids" };
  return { genero: genero === "Hombre" ? "male" : genero === "Mujer" ? "female" : "unisex", edad: "adult" };
}

const xml = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!)
  // Caracteres de control: XML no los admite y Merchant Center rechaza el archivo entero.
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

/**
 * RSS 2.0 con el espacio g: (lo que pide Merchant Center como "feed programado").
 * Meta (catálogo de WhatsApp) escribe la disponibilidad con espacio, "in stock":
 * `disponibilidadConEspacio`.
 */
export function feedXml(items: ItemFeed[], ctx: Pick<ContextoSeo, "sitio" | "marca">, opciones: { disponibilidadConEspacio?: boolean } = {}): string {
  const campo = (k: string, v: string | null) => (v === null || v === "" ? "" : `<g:${k}>${xml(v)}</g:${k}>`);
  const filas = items.map((i) => [
    "<item>",
    campo("id", i.id), campo("item_group_id", i.item_group_id), `<title>${xml(i.title)}</title>`,
    `<description>${xml(i.description)}</description>`, `<link>${xml(i.link)}</link>`,
    campo("image_link", i.image_link), ...i.additional_image_link.map((u) => campo("additional_image_link", u)),
    campo("availability", opciones.disponibilidadConEspacio ? i.availability.replaceAll("_", " ") : i.availability), campo("price", i.price), campo("sale_price", i.sale_price),
    campo("brand", i.brand), campo("condition", i.condition), campo("color", i.color), campo("size", i.size),
    campo("gender", i.gender), campo("age_group", i.age_group), campo("google_product_category", i.google_product_category),
    campo("product_type", i.product_type), campo("identifier_exists", i.identifier_exists), campo("custom_label_0", i.custom_label_0 ?? null),
    i.shipping_price ? `<g:shipping><g:country>AR</g:country><g:price>${xml(i.shipping_price)}</g:price></g:shipping>` : "",
    "</item>",
  ].join(""));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel><title>${xml(ctx.marca)}</title><link>${xml(ctx.sitio)}</link><description>${xml(`Catálogo de ${ctx.marca}`)}</description>\n${filas.join("\n")}\n</channel></rss>\n`;
}
