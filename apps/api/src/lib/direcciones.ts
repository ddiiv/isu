import { provinciaDelCheckout, PROVINCIAS, sinTildes, type LugarDireccion, type RevisionDireccion, type SugerenciaDireccion } from "@isu/shared";

/*
 * Direcciones del checkout (etapa 11): dos servicios de afuera.
 *
 * Google Places (API "New"): sugerencias mientras se escribe la calle y,
 * al elegir una, sus datos (calle, número, código postal, localidad,
 * provincia). Las sugerencias de una compra van con el mismo token de
 * sesión y se cierran con un solo pedido de datos: así Google las cobra como
 * una sesión (las sugerencias, gratis; los datos, 10.000 gratis por mes).
 * Se pide sólo `addressComponents` (nivel "Essentials", el más barato).
 *
 * Georef (Gobierno, gratis, sin clave): revisa una dirección escrita. Trae
 * la calle aunque la altura no exista; la altura es real cuando trae la
 * ubicación (el tramo de la calle que la contiene).
 *
 * Los dos tienen un tiempo máximo corto: si tardan, el checkout sigue sin la ayuda.
 */
export class ErrorDirecciones extends Error {}

const conTiempo = (ms: number) => AbortSignal.timeout(ms);

// ── Google Places ─────────────────────────────────────────────────
export interface Google {
  sugerencias(texto: string, sesion: string): Promise<SugerenciaDireccion[]>;
  lugar(id: string, sesion: string): Promise<LugarDireccion>;
}

interface Componente { longText?: string; shortText?: string; types?: string[] }

/** "C1043AAZ" se queda; "C1043" o "B1708" → "1043" / "1708" (el checkout acepta 4 números o el CPA completo). */
export function cpDelCheckout(cp: string | undefined): string {
  const t = (cp ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (/^[A-Z]\d{4}[A-Z]{3}$/.test(t)) return t;
  return /\d{4}/.exec(t)?.[0] ?? "";
}

/** Los componentes de Google a los campos del checkout. */
export function lugarDeComponentes(cs: Componente[]): LugarDireccion {
  const de = (tipo: string) => cs.find((c) => c.types?.includes(tipo))?.longText?.trim() ?? "";
  const provincia = provinciaDelCheckout(de("administrative_area_level_1"));
  // En CABA va el barrio ("Palermo"); "Comuna 14" no le sirve a nadie para encontrar la casa.
  const sublocalidad = de("sublocality_level_1");
  const localidad = provincia === "CABA"
    ? (de("neighborhood") || (/^comuna\b/i.test(sublocalidad) ? "" : sublocalidad) || "CABA")
    : (de("locality") || de("sublocality_level_1") || de("administrative_area_level_2"));
  return { calle: de("route").slice(0, 100), numero: de("street_number").slice(0, 10), cp: cpDelCheckout(de("postal_code")), localidad: localidad.slice(0, 80), provincia };
}

export function crearGoogle(o: { url: string; clave: string; tiempoMs?: number }): Google {
  const base = o.url.replace(/\/+$/, "");
  const ms = o.tiempoMs ?? 3500;
  const cabeceras = { "content-type": "application/json", "x-goog-api-key": o.clave };
  return {
    async sugerencias(texto, sesion) {
      const r = await fetch(`${base}/v1/places:autocomplete`, {
        method: "POST", headers: cabeceras, signal: conTiempo(ms),
        body: JSON.stringify({
          input: texto, sessionToken: sesion, languageCode: "es", regionCode: "ar", includedRegionCodes: ["ar"],
          // Direcciones, no comercios.
          includedPrimaryTypes: ["street_address", "premise", "subpremise", "route"],
        }),
      }).catch((e: Error) => { throw new ErrorDirecciones(`Google no responde: ${e.message}`); });
      if (!r.ok) throw new ErrorDirecciones(`Google contestó ${r.status}`);
      const d = (await r.json().catch(() => ({}))) as { suggestions?: Array<{ placePrediction?: { placeId?: string; text?: { text?: string }; structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } } } }> };
      return (d.suggestions ?? []).flatMap((s) => {
        const p = s.placePrediction;
        if (!p?.placeId || !/^[A-Za-z0-9_-]{10,300}$/.test(p.placeId)) return [];
        const principal = p.structuredFormat?.mainText?.text ?? p.text?.text ?? "";
        return principal ? [{ id: p.placeId, principal: principal.slice(0, 150), secundario: (p.structuredFormat?.secondaryText?.text ?? "").slice(0, 150) }] : [];
      }).slice(0, 5);
    },
    async lugar(id, sesion) {
      const q = new URLSearchParams({ sessionToken: sesion, languageCode: "es", regionCode: "ar" });
      const r = await fetch(`${base}/v1/places/${encodeURIComponent(id)}?${q}`, {
        headers: { ...cabeceras, "x-goog-fieldmask": "addressComponents" }, signal: conTiempo(ms),
      }).catch((e: Error) => { throw new ErrorDirecciones(`Google no responde: ${e.message}`); });
      if (!r.ok) throw new ErrorDirecciones(`Google contestó ${r.status}`);
      const d = (await r.json().catch(() => ({}))) as { addressComponents?: Componente[] };
      return lugarDeComponentes(Array.isArray(d.addressComponents) ? d.addressComponents : []);
    },
  };
}

// ── Georef ────────────────────────────────────────────────────────
export interface Georef { revisar(d: { calle: string; numero: string; localidad: string; provincia: string }): Promise<RevisionDireccion> }

interface DireccionGeoref {
  altura?: { valor?: number | string | null };
  calle?: { nombre?: string | null };
  localidad?: { nombre?: string | null };
  localidad_censal?: { nombre?: string | null };
  departamento?: { nombre?: string | null };
  provincia?: { nombre?: string | null };
  ubicacion?: { lat?: number | null; lon?: number | null };
}

/** "AV. CORRIENTES" y "avenida corrientes" son la misma calle; "Gral. Paz" y "General Paz", también. */
const PREFIJOS = /^(av|avda|avenida|calle|pje|pasaje|bv|bulevar|boulevard|diag|diagonal|cno|camino|ruta|rn|rp)\s+/;
const ABREVIATURAS: Record<string, string> = { gral: "general", pte: "presidente", dr: "doctor", sta: "santa", sto: "santo", tte: "teniente", cnel: "coronel", ing: "ingeniero", pres: "presidente" };
export function calleNormal(s: string): string {
  let n = sinTildes(s).replace(/[.,;'"`´]/g, " ").replace(/\s+/g, " ").trim();
  for (let i = 0; i < 2; i++) n = n.replace(PREFIJOS, "");
  return n.split(" ").map((p) => ABREVIATURAS[p] ?? p).join(" ");
}
const titulo = (s: string) => s.toLowerCase().replace(/(^|\s|\()(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase());

export function evaluarGeoref(pedido: { calle: string; numero: string; localidad: string; provincia: string }, rs: DireccionGeoref[]): RevisionDireccion {
  if (!rs.length) return { estado: "no_encontrada", sugerencia: null };
  const validas = rs.filter((r) => typeof r.ubicacion?.lat === "number");
  if (!validas.length) return { estado: "altura", sugerencia: null };
  const enCaba = pedido.provincia === "CABA";
  const loc = sinTildes(pedido.localidad);
  const coincideLocalidad = (r: DireccionGeoref) => {
    if (enCaba || !loc) return true;
    return [r.localidad?.nombre, r.localidad_censal?.nombre, r.departamento?.nombre]
      .some((x) => { const n = sinTildes(x ?? ""); return !!n && (n.includes(loc) || loc.includes(n)); });
  };
  const elegida = validas.find(coincideLocalidad) ?? validas[0]!;
  const nombreCalle = elegida.calle?.nombre ?? "";
  const mismaCalle = (() => {
    const a = calleNormal(pedido.calle), b = calleNormal(nombreCalle);
    return !!a && !!b && (a === b || b.includes(a) || a.includes(b));
  })();
  if (mismaCalle && coincideLocalidad(elegida)) return { estado: "ok", sugerencia: null };
  const provincia = provinciaDelCheckout(elegida.provincia?.nombre) ?? pedido.provincia;
  const localidad = enCaba ? pedido.localidad : (elegida.localidad?.nombre ?? elegida.localidad_censal?.nombre ?? pedido.localidad);
  const calle = titulo(nombreCalle);
  return {
    estado: "sugerencia",
    sugerencia: { calle, numero: pedido.numero, localidad, provincia, texto: [`${calle} ${pedido.numero}`, provincia === "CABA" ? null : localidad, provincia].filter(Boolean).join(", ") },
  };
}

export function crearGeoref(o: { url: string; tiempoMs?: number }): Georef {
  const base = o.url.replace(/\/+$/, "");
  const ms = o.tiempoMs ?? 4000;
  return {
    async revisar(d) {
      const codigo = PROVINCIAS.find((p) => p.nombre === d.provincia)?.codigo;
      if (!codigo) return { estado: "sin_servicio", sugerencia: null };
      const q = new URLSearchParams({ direccion: `${d.calle} ${d.numero}`, provincia: codigo, max: "10" });
      const r = await fetch(`${base}/v2.0/direcciones?${q}`, { signal: conTiempo(ms) })
        .catch((e: Error) => { throw new ErrorDirecciones(`Georef no responde: ${e.message}`); });
      if (!r.ok) throw new ErrorDirecciones(`Georef contestó ${r.status}`);
      const j = (await r.json().catch(() => ({}))) as { direcciones?: DireccionGeoref[] };
      return evaluarGeoref(d, Array.isArray(j.direcciones) ? j.direcciones : []);
    },
  };
}
