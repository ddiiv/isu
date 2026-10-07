/*
 * Google Places y Georef simulados (sólo desarrollo y pruebas): las rutas que
 * usa la API para las direcciones del checkout, con unas pocas calles reales.
 *
 *   POST /v1/places:autocomplete           (Google) sugerencias; pide la clave en x-goog-api-key
 *   GET  /v1/places/:id                    (Google) los datos; pide la clave y x-goog-fieldmask
 *   GET  /georef/v2.0/direcciones          (Georef) ?direccion=calle altura&provincia=<código>
 *   GET  /estado                           cuántos pedidos llegaron (para las pruebas)
 *
 * Uso: GOOGLE_MAPS_API_KEY=… node scripts/demo/direcciones-simulado.mjs
 * y en la API: GOOGLE_PLACES_URL=http://127.0.0.1:3940  GEOREF_URL=http://127.0.0.1:3940/georef
 */
import http from "node:http";

const PUERTO = Number(process.env.DIRECCIONES_SIMULADO_PUERTO ?? 3940);
const CLAVE = process.env.GOOGLE_MAPS_API_KEY ?? "";
if (CLAVE.length < 20) { console.error("Falta GOOGLE_MAPS_API_KEY (20+ caracteres)."); process.exit(2); }

// Calle (como la nombra Georef), alturas que existen, localidad, código postal y provincia (código INDEC).
const CALLES = [
  { georef: "AV. CORRIENTES", google: "Avenida Corrientes", desde: 1, hasta: 6800, localidad: "San Nicolás", depto: "Comuna 1", cp: "C1043", prov: "02" },
  { georef: "AV. SANTA FE", google: "Avenida Santa Fe", desde: 600, hasta: 5200, localidad: "Palermo", depto: "Comuna 14", cp: "C1425", prov: "02" },
  { georef: "THAMES", google: "Thames", desde: 1, hasta: 2600, localidad: "Palermo", depto: "Comuna 14", cp: "C1414", prov: "02" },
  { georef: "BACACAY", google: "Bacacay", desde: 1, hasta: 5000, localidad: "Flores", depto: "Comuna 7", cp: "C1406", prov: "02" },
  { georef: "AV. RIVADAVIA", google: "Avenida Rivadavia", desde: 1, hasta: 11800, localidad: "Caballito", depto: "Comuna 6", cp: "C1424", prov: "02" },
  { georef: "GRAL. JOSE DE SAN MARTIN", google: "General José de San Martín", desde: 1, hasta: 2000, localidad: "San Isidro", depto: "San Isidro", cp: "B1642", prov: "06" },
  { georef: "BELGRANO", google: "Belgrano", desde: 1, hasta: 1500, localidad: "Quilmes", depto: "Quilmes", cp: "B1878", prov: "06" },
  { georef: "AV. COLON", google: "Avenida Colón", desde: 1, hasta: 5000, localidad: "Córdoba", depto: "Capital", cp: "X5000", prov: "14" },
  { georef: "CORDOBA", google: "Córdoba", desde: 1, hasta: 9000, localidad: "Rosario", depto: "Rosario", cp: "S2000", prov: "82" },
];
const PROVINCIAS = { "02": "Ciudad Autónoma de Buenos Aires", "06": "Buenos Aires", "14": "Córdoba", "82": "Santa Fe" };

const estado = { autocompletados: 0, detalles: 0, georef: 0, sesiones: new Set() };
const json = (res, s, c) => { res.writeHead(s, { "content-type": "application/json" }); res.end(JSON.stringify(c)); };
const leer = async (req) => { let b = ""; for await (const c of req) { b += c; if (b.length > 50_000) throw new Error("grande"); } return b ? JSON.parse(b) : {}; };
const normal = (s) => String(s).normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[.,]/g, " ")
  .replace(/\b(av|avda|avenida|calle|gral|general|jose|de)\b/g, " ").replace(/\s+/g, " ").trim();
/** "Corrientes 1234" → { nombre: "corrientes", altura: 1234 } */
const partir = (texto) => {
  const partes = String(texto).trim().split(/\s+/);
  const altura = partes.length > 1 && /^\d{1,6}$/.test(partes.at(-1)) ? Number(partes.pop()) : null;
  return { nombre: normal(partes.join(" ")), altura };
};
function distancia(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
// Georef tolera errores de tipeo ("Corientes"); Google, sólo lo que empieza igual.
const parecida = (pedido, calle) => !!pedido && pedido.split(" ").every((p) => normal(calle).split(" ").some((c) => c.startsWith(p) || distancia(p, c) <= (p.length > 5 ? 2 : 1)));
const empieza = (pedido, calle) => !!pedido && normal(calle).startsWith(pedido);
const conClave = (req, res) => {
  if (req.headers["x-goog-api-key"] === CLAVE) return true;
  json(res, 403, { error: { code: 403, message: "The provided API key is invalid.", status: "PERMISSION_DENIED" } });
  return false;
};
const idDe = (c, altura) => `sim_${Buffer.from(`${CALLES.indexOf(c)}|${altura ?? ""}`).toString("base64url")}xxxxxxxx`;

http.createServer(async (req, res) => {
  const u = new URL(req.url ?? "/", `http://127.0.0.1:${PUERTO}`);
  try {
    if (u.pathname === "/estado" && req.method === "GET") return json(res, 200, { ...estado, sesiones: estado.sesiones.size });

    // ── Google: sugerencias ──
    if (u.pathname === "/v1/places:autocomplete" && req.method === "POST") {
      if (!conClave(req, res)) return;
      const b = await leer(req);
      estado.autocompletados++;
      if (b.sessionToken) estado.sesiones.add(b.sessionToken);
      const { nombre, altura } = partir(b.input ?? "");
      const sugerencias = CALLES.filter((c) => empieza(nombre, c.google)).slice(0, 5).map((c) => {
        const principal = altura ? `${c.google} ${altura}` : c.google;
        const secundario = `${c.localidad}, ${c.prov === "02" ? "CABA" : PROVINCIAS[c.prov]}, Argentina`;
        return { placePrediction: { placeId: idDe(c, altura), text: { text: `${principal}, ${secundario}` }, structuredFormat: { mainText: { text: principal }, secondaryText: { text: secundario } }, types: [altura ? "street_address" : "route"] } };
      });
      return json(res, 200, sugerencias.length ? { suggestions: sugerencias } : {});
    }

    // ── Google: datos de la elegida ──
    const lugar = /^\/v1\/places\/([A-Za-z0-9_-]+)$/.exec(u.pathname);
    if (lugar && req.method === "GET") {
      if (!conClave(req, res)) return;
      if (!req.headers["x-goog-fieldmask"]) return json(res, 400, { error: { code: 400, message: "FieldMask is a required parameter.", status: "INVALID_ARGUMENT" } });
      estado.detalles++;
      const [i, altura] = Buffer.from(lugar[1].replace(/^sim_/, "").replace(/x+$/, ""), "base64url").toString().split("|");
      const c = CALLES[Number(i)];
      if (!c) return json(res, 404, { error: { code: 404, message: "Not found", status: "NOT_FOUND" } });
      const caba = c.prov === "02";
      const comp = (longText, types, shortText = longText) => ({ longText, shortText, types, languageCode: "es" });
      return json(res, 200, {
        addressComponents: [
          ...(altura ? [comp(altura, ["street_number"])] : []),
          comp(c.google, ["route"]),
          ...(caba ? [comp(c.localidad, ["neighborhood", "political"]), comp(c.depto, ["sublocality_level_1", "sublocality", "political"]), comp("Buenos Aires", ["locality", "political"])]
            : [comp(c.localidad, ["locality", "political"]), comp(c.depto, ["administrative_area_level_2", "political"])]),
          comp(PROVINCIAS[c.prov], ["administrative_area_level_1", "political"]),
          comp("Argentina", ["country", "political"], "AR"),
          comp(c.cp, ["postal_code"]),
        ],
      });
    }

    // ── Georef ──
    if (u.pathname === "/georef/v2.0/direcciones" && req.method === "GET") {
      estado.georef++;
      const { nombre, altura } = partir(u.searchParams.get("direccion") ?? "");
      const prov = u.searchParams.get("provincia");
      const max = Math.min(Number(u.searchParams.get("max") ?? 10) || 10, 1000);
      const direcciones = CALLES.filter((c) => (!prov || c.prov === prov) && parecida(nombre, c.georef)).slice(0, max).map((c) => {
        const existe = altura !== null && altura >= c.desde && altura <= c.hasta;
        return {
          altura: { unidad: null, valor: altura },
          calle: { categoria: c.georef.startsWith("AV.") ? "AV" : "CALLE", id: String(CALLES.indexOf(c)), nombre: c.georef },
          departamento: { id: "0", nombre: c.depto },
          localidad_censal: { id: "0", nombre: c.prov === "02" ? "Ciudad de Buenos Aires" : c.localidad },
          nomenclatura: `${c.georef} ${altura ?? ""}, ${c.depto}, ${PROVINCIAS[c.prov]}`,
          provincia: { id: c.prov, nombre: PROVINCIAS[c.prov] },
          ubicacion: existe ? { lat: -34.6, lon: -58.4 } : { lat: null, lon: null },
        };
      });
      return json(res, 200, { cantidad: direcciones.length, direcciones, inicio: 0, parametros: Object.fromEntries(u.searchParams), total: direcciones.length });
    }
    json(res, 404, { error: "no existe" });
  } catch (e) {
    json(res, 400, { error: e.message });
  }
}).listen(PUERTO, "127.0.0.1", () => console.warn(`Google Places y Georef simulados en http://127.0.0.1:${PUERTO}`));
