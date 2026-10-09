import type { Json } from "./http.js";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { pdfSimple } from "./pdf.js";

/*
 * Simulador de los transportes y de WhatsApp, para desarrollo y pruebas.
 * Habla como cada API real (rutas, formatos, XML de OCA, tokens) así los
 * adaptadores se prueban de punta a punta sin credenciales:
 *
 *   /correo/…  /andreani/…  /oca/…  /meli/…  /cabify/…  /whatsapp/…
 *
 * En http://localhost:3920/ hay una página con los envíos creados y un botón
 * para avanzarlos ("en camino" → "en reparto" → "entregado") y los WhatsApp
 * que se mandaron. Casos especiales para probar errores:
 *   CP 9999 → ningún transporte llega;  CP 8888 → Andreani responde 500.
 */
type Transporte = "correo" | "andreani" | "oca" | "meli" | "cabify";
interface Envio { transporte: Transporte; seguimiento: string; pedido: string; servicio: string; paso: number; eventos: Array<{ fecha: Date; texto: string }> }

const PASOS: Record<Transporte, string[]> = {
  correo: ["PREIMPOSICION", "EN TRANSITO", "EN DISTRIBUCION", "ENTREGADO"],
  andreani: ["Pendiente de ingreso", "Ingreso al circuito operativo", "En distribución", "Entregado"],
  oca: ["Pre-Imposición", "Ingresado - En Tránsito", "En Distribución", "Entregado"],
  meli: ["ready_to_ship", "shipped", "shipped/out_for_delivery", "delivered"],
  cabify: ["pending", "picked_up", "in_transit", "delivered"],
};
const SUCURSAL_LISTA: Record<string, string> = {
  correo: "DISPONIBLE PARA RETIRAR EN SUCURSAL", andreani: "En sucursal de destino - Disponible para retirar", oca: "Disponible para retirar en sucursal",
};
const FALLA: Record<Transporte, string> = {
  correo: "NO ENTREGADO - DOMICILIO CERRADO", andreani: "Visita - Domicilio cerrado", oca: "No entregado - Ausente",
  meli: "not_delivered/receiver_absent", cabify: "failed",
};

/** Lo cargado en MiCorreo (/shipping/import): sin número hasta que se «paga e imprime» el rótulo. */
interface CargadoCorreo { extOrderId: string; pedido: string; servicio: string; destinatario: string; seguimiento: string | null; cuerpo: Json }

export interface Simulador {
  url: string;
  envios: Map<string, Envio>;
  /** Cuántas veces se llamó cada ruta (para probar que no se le pega de más a un transporte). */
  llamadas: Map<string, number>;
  /** MiCorreo: lo cargado, por extOrderId. */
  correo: Map<string, CargadoCorreo>;
  /** MiCorreo: pagar e imprimir el rótulo de un envío cargado (lo que se hace en su portal). Devuelve el número de seguimiento. */
  rotuloCorreo(extOrderId: string): string | null;
  mensajes: Array<{ fecha: Date; para: string; plantilla: string; parametros: string[] }>;
  avanzar(seguimiento: string, forzar?: "no_entregado" | "en_sucursal"): Envio | null;
  cerrar(): Promise<void>;
}

const leer = async (req: http.IncomingMessage) => {
  let b = "";
  for await (const c of req) { b += c; if (b.length > 2_000_000) break; }
  return b;
};

export async function levantarSimulador(puerto = 0, host = "127.0.0.1"): Promise<Simulador> {
  const envios = new Map<string, Envio>();
  const correo = new Map<string, CargadoCorreo>();
  const llamadas = new Map<string, number>();
  const mensajes: Simulador["mensajes"] = [];
  const tokens = new Set<string>();
  const nuevoToken = () => { const t = randomBytes(16).toString("hex"); tokens.add(t); return t; };
  const autorizado = (req: http.IncomingMessage) => {
    const t = (req.headers["x-authorization-token"] as string | undefined) ?? (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    return tokens.has(t) || t.startsWith("APP_USR-") || t === "demo";
  };
  const seq = { n: 1000 };
  const crear = (transporte: Transporte, pedido: string, servicio: string, seguimiento?: string) => {
    const id = seguimiento ?? ({ correo: `CA${++seq.n}${randomBytes(2).toString("hex").toUpperCase()}AR`, andreani: `3600000${String(++seq.n).padStart(8, "0")}`, oca: `4${String(++seq.n).padStart(18, "0")}`, meli: `4${String(++seq.n).padStart(10, "0")}`, cabify: `cab_${randomBytes(6).toString("hex")}` })[transporte];
    const e: Envio = { transporte, seguimiento: id, pedido, servicio, paso: 0, eventos: [{ fecha: new Date(), texto: PASOS[transporte][0]! }] };
    envios.set(id, e);
    return e;
  };
  const avanzar: Simulador["avanzar"] = (seguimiento, forzar) => {
    const e = envios.get(seguimiento);
    if (!e) return null;
    if (forzar === "no_entregado") { e.eventos.push({ fecha: new Date(Date.now() + e.eventos.length), texto: FALLA[e.transporte] }); return e; }
    const pasos = PASOS[e.transporte];
    if (e.paso >= pasos.length - 1) return e;
    e.paso++;
    // A sucursal: antes de "entregado" pasa por "disponible para retirar".
    const texto = (forzar === "en_sucursal" || (e.servicio === "sucursal" && e.paso === pasos.length - 2)) && SUCURSAL_LISTA[e.transporte] ? SUCURSAL_LISTA[e.transporte]! : pasos[e.paso]!;
    e.eventos.push({ fecha: new Date(Date.now() + e.eventos.length), texto });
    return e;
  };
  // MiCorreo: el número sale cuando se paga e imprime el rótulo (como "000500076393019A3G0C701").
  const rotuloCorreo: Simulador["rotuloCorreo"] = (extOrderId) => {
    const c = correo.get(extOrderId);
    if (!c) return null;
    if (!c.seguimiento) {
      c.seguimiento = `0005000${String(++seq.n).padStart(8, "0")}${randomBytes(4).toString("hex").toUpperCase()}`;
      crear("correo", c.pedido, c.servicio, c.seguimiento);
    }
    return c.seguimiento;
  };
  // Tarifa de mentira pero razonable: AMBA más barato que el interior; más peso, más caro.
  const precio = (base: number, cp: string, gramos: number) => Math.round(base * (Number(cp) < 1900 ? 1 : 1.4) + Math.max(0, gramos - 1000) * 0.9);
  const sucursales = (prefijo: string, cp: string) => [1, 2, 3].map((i) => ({ id: `${prefijo}${cp}${i}`, nombre: `Sucursal ${prefijo.toUpperCase()} ${cp}-${i}`, calle: ["Av. Rivadavia", "Av. Corrientes", "Belgrano"][i - 1]!, numero: String(1000 + i * 150), cp }));
  const xml = (cuerpo: string) => `<?xml version="1.0" encoding="utf-8"?><DataSet xmlns="http://tempuri.org/"><diffgram><NewDataSet>${cuerpo}</NewDataSet></diffgram></DataSet>`;

  const servidor = http.createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", "http://sim");
    const p = u.pathname;
    llamadas.set(p, (llamadas.get(p) ?? 0) + 1);
    const json = (s: number, c: unknown) => { res.writeHead(s, { "content-type": "application/json" }); res.end(JSON.stringify(c)); };
    const pdf = (lineas: string[]) => { res.writeHead(200, { "content-type": "application/pdf" }); res.end(pdfSimple(lineas)); };
    const texto = (s: number, t: string, tipo = "text/xml; charset=utf-8") => { res.writeHead(s, { "content-type": tipo }); res.end(t); };
    try {
      const conCuerpo = req.method === "POST" || req.method === "PUT" || Number(req.headers["content-length"] ?? 0) > 0;
      const cuerpo = conCuerpo ? await leer(req) : "";
      const body = (() => { try { return JSON.parse(cuerpo || "{}"); } catch { return Object.fromEntries(new URLSearchParams(cuerpo)); } })() as Json;

      // ── Página de la demo ──
      if (p === "/" && req.method === "GET") {
        // Lo que mandó la tienda se escapa (aunque sea una herramienta de desarrollo).
        const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
        const filas = [...envios.values()].reverse().map((e) => `<tr><td>${e.transporte}</td><td>${esc(e.pedido)}</td><td><code>${esc(e.seguimiento)}</code></td><td>${esc(e.servicio)}</td><td>${esc(e.eventos.at(-1)!.texto)}</td><td><form method="post" action="/_avanzar/${encodeURIComponent(e.seguimiento)}"><button>Avanzar</button></form><form method="post" action="/_avanzar/${encodeURIComponent(e.seguimiento)}?forzar=no_entregado"><button>Visita fallida</button></form></td></tr>`).join("");
        const wa = mensajes.slice().reverse().slice(0, 50).map((m) => `<li>${m.fecha.toLocaleTimeString("es-AR")} → ${esc(m.para)}: <b>${esc(m.plantilla)}</b> (${esc(m.parametros.join(" · "))})</li>`).join("");
        return texto(200, `<!doctype html><meta charset="utf-8"><title>Transportes simulados</title><style>body{font:14px system-ui;margin:24px}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:6px 8px}form{display:inline}</style><h1>Transportes simulados</h1><p>Los envíos que creó la tienda. "Avanzar" mueve el estado; el worker lo levanta en la próxima vuelta de seguimiento.</p><table><tr><th>Transporte</th><th>Pedido</th><th>Seguimiento</th><th>Servicio</th><th>Estado</th><th></th></tr>${filas}</table><h2>WhatsApp enviados</h2><ul>${wa}</ul>`, "text/html; charset=utf-8");
      }
      const av = /^\/_avanzar\/(.+)$/.exec(p);
      if (av && req.method === "POST") {
        const e = avanzar(decodeURIComponent(av[1]!), (u.searchParams.get("forzar") as "no_entregado" | null) ?? undefined);
        if (!e) return json(404, { error: "no existe" });
        if ((req.headers.accept ?? "").includes("text/html")) { res.writeHead(303, { location: "/" }); return res.end(); }
        return json(200, { estado: e.eventos.at(-1)!.texto });
      }

      // ── Correo Argentino (MiCorreo, como el manual 2026-05-18) ──
      const errCorreo = (st: number, message: string) => json(st, { code: String(st), message });
      if (p === "/correo/token" && req.method === "POST") {
        if (!/^Basic /.test(req.headers.authorization ?? "")) return errCorreo(401, "Unauthorized");
        const v = new Date(Date.now() - 3 * 3600_000 + 3600_000); // en una hora, hora de Argentina
        return json(200, { token: nuevoToken(), expires: v.toISOString().slice(0, 19).replace("T", " ") });
      }
      // El portal (lo que en la vida real es la web de MiCorreo): pagar e imprimir el rótulo.
      if (p === "/correo/portal" && req.method === "GET") {
        const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
        const filas = [...correo.values()].reverse().map((c) => `<tr><td>${esc(c.pedido)}</td><td>${esc(c.destinatario)}</td><td>${esc(c.servicio)}</td><td>${c.seguimiento ? `<code>${esc(c.seguimiento)}</code> · <a href="/correo/portal/rotulo/${encodeURIComponent(c.extOrderId)}">Rótulo (PDF)</a>` : `<form method="post" action="/correo/portal/rotulo/${encodeURIComponent(c.extOrderId)}"><button>Pagar e imprimir rótulo</button></form>`}</td></tr>`).join("");
        return texto(200, `<!doctype html><meta charset="utf-8"><title>MiCorreo (simulado)</title><style>body{font:14px system-ui;margin:24px}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:6px 8px}</style><h1>MiCorreo · envíos importados (simulado)</h1><p>Lo que cargó la tienda. Al pagar, Correo asigna el número de seguimiento y da el rótulo para imprimir.</p><table><tr><th>Pedido</th><th>Destinatario</th><th>Servicio</th><th>Rótulo</th></tr>${filas}</table>`, "text/html; charset=utf-8");
      }
      const rot = /^\/correo\/portal\/rotulo\/([^/]+)$/.exec(p);
      if (rot) {
        const id = decodeURIComponent(rot[1]!);
        const tn = req.method === "POST" ? rotuloCorreo(id) : correo.get(id)?.seguimiento ?? null;
        if (!tn) return errCorreo(404, "Resource not found");
        if (req.method === "POST") {
          // Desde el navegador (el formulario del portal): vuelve a la lista, que ya muestra el número.
          if ((req.headers.accept ?? "").includes("text/html")) { res.writeHead(303, { location: "/correo/portal" }); return res.end(); }
          return json(200, { trackingNumber: tn });
        }
        const c = correo.get(id)!;
        return pdf(["CORREO ARGENTINO", `Seguimiento ${tn}`, `Pedido ${c.pedido}`, `Para: ${c.destinatario}`]);
      }
      if (p.startsWith("/correo/")) {
        if (!autorizado(req)) return errCorreo(401, "Invalid token");
        const clienteOk = (id: unknown) => /^\d{4,10}$/.test(String(id ?? ""));
        if (p === "/correo/users/validate" && req.method === "POST") {
          return body.email && body.password ? json(200, { customerId: "0090000025", createdAt: "2021-03-10" }) : errCorreo(404, "Usuario no valido o inexistente");
        }
        if (p === "/correo/rates" && req.method === "POST") {
          if (!clienteOk(body.customerId)) return errCorreo(402, `Cliente FAP no identificado ${String(body.customerId ?? "")}`);
          const m = body.dimensions ?? {};
          const lados = [m.height, m.width, m.length].map(Number);
          if (!body.postalCodeOrigin || !body.postalCodeDestination || !Number.isInteger(Number(m.weight)) || lados.some((x) => !Number.isInteger(x))) return errCorreo(400, "getQuotation - Hay campos obligatorios vacios");
          if (Number(m.weight) < 1 || Number(m.weight) > 50000) return errCorreo(422, "Datos Invalidos: Peso supera el maximo tolerado");
          if (lados.some((x) => x > 200) || lados.reduce((t, x) => t + x, 0) > 300) return errCorreo(422, "Datos Invalidos: La suma de los lados no puede superar 300");
          const cp = String(body.postalCodeDestination);
          if (cp === "9999") return json(200, { customerId: body.customerId, validTo: new Date(Date.now() + 86400_000).toISOString(), rates: [] });
          const g = Number(m.weight);
          const todas = [
            { deliveredType: "D", productType: "CP", productName: "Correo Argentino Clasico", price: precio(4800, cp, g) + 0.06, deliveryTimeMin: "2", deliveryTimeMax: "5" },
            { deliveredType: "D", productType: "EP", productName: "Correo Argentino Expreso", price: precio(9800, cp, g) + 0.12, deliveryTimeMin: "1", deliveryTimeMax: "3" },
            { deliveredType: "S", productType: "CP", productName: "Correo Argentino Clasico", price: precio(3900, cp, g) + 0.06, deliveryTimeMin: "2", deliveryTimeMax: "5" },
            { deliveredType: "S", productType: "EP", productName: "Correo Argentino Expreso", price: precio(8900, cp, g) + 0.12, deliveryTimeMin: "1", deliveryTimeMax: "3" },
          ];
          return json(200, { customerId: body.customerId, validTo: new Date(Date.now() + 86400_000).toISOString(), rates: body.deliveredType ? todas.filter((r) => r.deliveredType === body.deliveredType) : todas });
        }
        if (p === "/correo/agencies" && req.method === "GET") {
          if (!clienteOk(u.searchParams.get("customerId"))) return errCorreo(402, "Customer ID no valido");
          const prov = u.searchParams.get("provinceCode") ?? "";
          if (!/^[A-Z]$/.test(prov)) return errCorreo(400, "provinceCode requerido");
          const horas = { sunday: null, monday: { start: "0930", end: "1800" }, tuesday: { start: "0930", end: "1800" }, wednesday: { start: "0930", end: "1800" }, thursday: { start: "0930", end: "1800" }, friday: { start: "0930", end: "1800" }, saturday: { start: "0900", end: "1300" }, holidays: null };
          const cps = prov === "C" ? ["C1406ABC", "C1405AAA", "C1424BBB"] : ["B1842ZAB", "B1828XAA", "B1832CCC"];
          const lista = cps.map((cpa, i) => ({
            code: `${prov}${String(100 + i).padStart(4, "0")}`, name: `Sucursal ${["Centro", "Norte", "Sur"][i]}`, manager: "Encargado", email: "sucursal@correoargentino.com.ar", phone: "(011) 4000-0000",
            services: { packageReception: true, pickupAvailability: true },
            location: { address: { streetName: ["Av. Rivadavia", "Av. Corrientes", "Belgrano"][i], streetNumber: String(1000 + i * 150), floor: null, apartment: null, locality: prov === "C" ? "Flores" : "Monte Grande", city: prov === "C" ? "CABA" : "Esteban Echeverria", province: prov === "C" ? "Ciudad Autonoma Buenos Aires" : "Buenos Aires", provinceCode: prov, postalCode: cpa }, latitude: "-34.6", longitude: "-58.4" },
            hours: horas, status: "ACTIVE",
          }));
          // Una cerrada y una que sólo recibe paquetes (no entrega): la tienda no tiene que ofrecerlas.
          lista.push({ ...lista[0]!, code: `${prov}0900`, name: "Sucursal cerrada", status: "INACTIVE" });
          lista.push({ ...lista[0]!, code: `${prov}0901`, name: "Sólo imposición", services: { packageReception: true, pickupAvailability: false } });
          return json(200, u.searchParams.get("services") === "pickup_availability" ? lista.filter((a) => a.services.pickupAvailability) : lista);
        }
        if (p === "/correo/shipping/import" && req.method === "POST") {
          if (!clienteOk(body.customerId)) return errCorreo(402, "no se encontro datos de remitente - id :" + String(body.customerId ?? ""));
          const sh = body.shipping ?? {};
          if (!body.extOrderId || !body.recipient?.name || !body.recipient?.email) return errCorreo(400, "Hay campos obligatorios vacios");
          if (sh.deliveryType !== "D" && sh.deliveryType !== "S") return errCorreo(402, "Tipo de entrega invalido");
          if (sh.productType !== "CP" && sh.productType !== "EP") return errCorreo(402, "Tipo de encomienda [TENC] no valida");
          if (sh.deliveryType === "S" && !sh.agency) return errCorreo(402, "Verifique la sucursal de destino");
          if (sh.deliveryType === "D" && (!sh.address?.streetName || !sh.address?.streetNumber || !sh.address?.city || !sh.address?.postalCode)) return errCorreo(400, "Hay campos obligatorios vacios");
          if (sh.deliveryType === "D" && !/^[A-Z]$/.test(String(sh.address?.provinceCode ?? ""))) return errCorreo(402, "La provincia es invalida.");
          if (!(Number(sh.weight) > 0)) return errCorreo(402, "El peso debe ser mayor a 0");
          if (Number(sh.weight) > 50000) return errCorreo(402, "El peso excede el maximo permitido para el producto");
          for (const [k, n] of [["alto", sh.height], ["ancho", sh.width], ["largo", sh.length]] as const) if (!(Number(n) > 0 && Number(n) <= 255)) return errCorreo(402, `El ${k} debe estar entre 0 y 255.`);
          if (String(sh.address?.floor ?? "").length > 3 || String(sh.address?.apartment ?? "").length > 3) return errCorreo(400, "floor/apartment: hasta 3 caracteres");
          if (!(Number(sh.declaredValue) >= 0)) return errCorreo(400, "declaredValue invalido");
          const id = String(body.extOrderId);
          if (correo.has(id)) return errCorreo(402, "La orden ya fue importada con anterioridad.");
          correo.set(id, { extOrderId: id, pedido: String(body.orderNumber ?? id), servicio: sh.deliveryType === "S" ? "sucursal" : "domicilio", destinatario: String(body.recipient.name), seguimiento: null, cuerpo: body });
          return json(200, { createdAt: new Date().toISOString() });
        }
        if (p === "/correo/shipping/tracking" && req.method === "GET") {
          const id = String(body.shippingId ?? u.searchParams.get("shippingId") ?? "");
          if (!id) return errCorreo(400, "shippingId requerido");
          const e = envios.get(id);
          if (!e) return json(200, { date: new Date().toISOString(), error: "No existe el cliente o pedido", code: "0" });
          const f = (d: Date) => { const a = new Date(d.getTime() - 3 * 3600_000); return `${String(a.getUTCDate()).padStart(2, "0")}-${String(a.getUTCMonth() + 1).padStart(2, "0")}-${a.getUTCFullYear()} ${String(a.getUTCHours()).padStart(2, "0")}:${String(a.getUTCMinutes()).padStart(2, "0")}`; };
          return json(200, [{ id: String(seq.n), productId: "CP", trackingNumber: e.seguimiento, events: [...e.eventos].reverse().map((ev) => ({ event: ev.texto, date: f(ev.fecha), branch: "CORREO ARGENTINO", status: "", sign: "" })) }]);
        }
      }

      // ── Andreani ──
      if (p === "/andreani/login") {
        if (!/^Basic /.test(req.headers.authorization ?? "")) return json(401, { message: "Unauthorized" });
        res.writeHead(200, { "x-authorization-token": nuevoToken(), "content-type": "application/json" });
        return res.end("{}");
      }
      if (p.startsWith("/andreani/")) {
        if (!autorizado(req)) return json(401, { message: "token inválido" });
        if (p === "/andreani/v1/tarifas") {
          const cp = u.searchParams.get("cpDestino") ?? "";
          if (cp === "9999") return json(404, { title: "Sin cobertura" });
          if (cp === "8888") return json(500, { title: "error interno" });
          const g = Number(u.searchParams.get("bultos[0][kilos]") ?? 1) * 1000;
          const base = u.searchParams.get("contrato") === "400006711" ? 4200 : 5400;
          return json(200, { pesoAforado: "1.0", tarifaConIva: { total: String(precio(base, cp, g)) } });
        }
        if (p === "/andreani/v2/sucursales") {
          return json(200, sucursales("an", u.searchParams.get("codigoPostal") ?? "1406").map((s) => ({ id: s.id, descripcion: s.nombre, direccion: { calle: s.calle, numero: s.numero, localidad: "CABA", codigoPostal: s.cp }, horarioDeAtencion: "Lun a Vie 9 a 18", datosAdicionales: { seHaceAtencionAlCliente: true } })));
        }
        if (p === "/andreani/v2/ordenes-de-envio" && req.method === "POST") {
          if (!body.contrato || !body.destino || !body.bultos?.length) return json(400, { title: "faltan datos" });
          const e = crear("andreani", String(body.bultos[0]?.referencias?.[0]?.contenido ?? ""), body.destino.sucursal ? "sucursal" : "domicilio");
          return json(202, { estado: "Pendiente", bultos: [{ numeroDeBulto: "1", numeroDeEnvio: e.seguimiento, linking: [{ meta: "Etiqueta", contenido: `/v2/ordenes-de-envio/${e.seguimiento}/etiquetas` }] }] });
        }
        const et = /^\/andreani\/v2\/ordenes-de-envio\/([^/]+)\/etiquetas$/.exec(p);
        if (et) { const e = envios.get(decodeURIComponent(et[1]!)); return e ? pdf(["ANDREANI", `Envío ${e.seguimiento}`, `Pedido ${e.pedido}`]) : json(404, {}); }
        const tr = /^\/andreani\/v2\/envios\/([^/]+)\/trazas$/.exec(p);
        if (tr) {
          const e = envios.get(decodeURIComponent(tr[1]!));
          return e ? json(200, { eventos: e.eventos.map((ev) => ({ Fecha: ev.fecha.toISOString(), Estado: ev.texto, Traduccion: ev.texto, Sucursal: "Andreani CABA" })) }) : json(404, {});
        }
      }

      // ── OCA (e-Pak, XML) ──
      if (p.startsWith("/oca/")) {
        const q = req.method === "POST" ? new URLSearchParams(cuerpo) : u.searchParams;
        if (p === "/oca/Tarifar_Envio_Corporativo") {
          const cp = q.get("CodigoPostalDestino") ?? "";
          if (cp === "9999") return texto(200, xml(""));
          const base = q.get("Operativa") === "62342" ? 4000 : 5100;
          return texto(200, xml(`<Table><Tarifador>1</Tarifador><Precio>${precio(base, cp, Number(q.get("PesoTotal") ?? 1) * 1000) / 1.21}</Precio><Total>${precio(base, cp, Number(q.get("PesoTotal") ?? 1) * 1000)}</Total><PlazoEntrega>3</PlazoEntrega></Table>`));
        }
        if (p === "/oca/GetCentrosImposicionConServiciosByCP") {
          return texto(200, `<?xml version="1.0"?><CentrosDeImposicion>${sucursales("oc", q.get("CodigoPostal") ?? "1406").map((s) => `<Centro><IdCentroImposicion>${s.id}</IdCentroImposicion><Sigla>OCA</Sigla><Descripcion>${s.nombre}</Descripcion><Calle>${s.calle}</Calle><Numero>${s.numero}</Numero><Localidad>CABA</Localidad><CodigoPostal>${s.cp}</CodigoPostal></Centro>`).join("")}</CentrosDeImposicion>`);
        }
        if (p === "/oca/IngresoORMultiplesRetiros") {
          if (q.get("usr") !== "demo" || q.get("psw") !== "demo") return texto(200, xml("<Errores><Descripcion>Usuario o clave incorrectos</Descripcion></Errores>"));
          const datos = q.get("xml_Datos") ?? "";
          const pedido = /nroremito="([^"]*)"/.exec(datos)?.[1] ?? "";
          const e = crear("oca", pedido, /idci="(?!0")[^"]+"/.test(datos) ? "sucursal" : "domicilio");
          return texto(200, xml(`<Resumen><CodigoOperacion>${++seq.n}</CodigoOperacion></Resumen><DetalleIngresos><OrdenRetiro>${seq.n}</OrdenRetiro><NumeroEnvio>${e.seguimiento}</NumeroEnvio></DetalleIngresos>`));
        }
        if (p === "/oca/GetPdfDeEtiquetasPorOrdenOrNumeroEnvio") {
          const e = envios.get(q.get("nroEnvio") ?? "");
          if (!e) return texto(200, `<?xml version="1.0"?><string xmlns="http://tempuri.org/"></string>`);
          return texto(200, `<?xml version="1.0"?><string xmlns="http://tempuri.org/">${pdfSimple(["OCA", `Envío ${e.seguimiento}`, `Remito ${e.pedido}`]).toString("base64")}</string>`);
        }
        if (p === "/oca/Tracking_Pieza") {
          const e = envios.get(q.get("Pieza") ?? "");
          return texto(200, xml((e?.eventos ?? []).map((ev) => `<Table><NumeroEnvio>${e!.seguimiento}</NumeroEnvio><Desdcripcion_Estado>${ev.texto}</Desdcripcion_Estado><Descripcion_Motivo>0</Descripcion_Motivo><SUC>CAPITAL FEDERAL</SUC><fecha>${ev.fecha.toISOString()}</fecha></Table>`).join("")));
        }
      }

      // ── Mercado Libre (envíos de Mercado Envíos) ──
      if (p.startsWith("/meli/")) {
        if (!autorizado(req)) return json(401, { message: "invalid_token" });
        if (p === "/meli/users/me") return json(200, { id: 123456789, nickname: "ISUWAYA" });
        if (/^\/meli\/users\/\d+\/shipping_options$/.test(p)) {
          const cp = u.searchParams.get("zip_code") ?? "";
          if (cp === "9999") return json(200, { options: [] });
          const g = Number((u.searchParams.get("dimensions") ?? ",500").split(",")[1]);
          return json(200, { options: [{ id: 1, name: "Normal a domicilio", cost: precio(4500, cp, g), estimated_delivery_time: { shipping: 72 } }] });
        }
        const sh = /^\/meli\/shipments\/(\d+)$/.exec(p);
        if (sh) {
          // Un envío que creó "Mercado Pago" al cobrar: si el simulador no lo conoce, lo da de alta.
          const e = envios.get(sh[1]!) ?? crear("meli", "", "domicilio", sh[1]!);
          const [status, substatus] = e.eventos.at(-1)!.texto.split("/");
          return json(200, { id: Number(e.seguimiento), status, substatus: substatus ?? null, last_updated: e.eventos.at(-1)!.fecha.toISOString(), tracking_number: `ME${e.seguimiento}` });
        }
        if (p === "/meli/shipment_labels") {
          const id = u.searchParams.get("shipment_ids") ?? "";
          return pdf(["MERCADO ENVÍOS", `Envío ${id}`]);
        }
      }

      // ── Mercado Pago (sólo lo que usa Mercado Envíos: del pago a su envío) ──
      const pg = /^\/mp\/v1\/payments\/(\d+)$/.exec(p);
      if (pg) return json(200, { id: Number(pg[1]), status: "approved", order: { id: Number(pg[1]) + 1 } });
      const mo = /^\/mp\/merchant_orders\/(\d+)$/.exec(p);
      if (mo) return json(200, { id: Number(mo[1]), shipments: [{ id: 40_000_000 + Number(mo[1]) }], shipping_cost: 4500 });

      // ── Cabify Logistics ──
      if (p === "/cabify/auth/token" && req.method === "POST") {
        if (!body.client_id || !body.client_secret) return json(401, { error: "invalid_client" });
        return json(200, { access_token: nuevoToken(), expires_in: 3600, token_type: "Bearer" });
      }
      if (p.startsWith("/cabify/")) {
        if (!autorizado(req)) return json(401, { error: "unauthorized" });
        if (p === "/cabify/api/v1/estimates" && req.method === "POST") {
          return json(200, { estimates: [{ product: "express", price: { amount: 3500, currency: "ARS" }, eta_minutes: 180 }] });
        }
        if (p === "/cabify/api/v1/deliveries" && req.method === "POST") {
          if (!body.dropoff?.address) return json(422, { error: "dropoff required" });
          const e = crear("cabify", String(body.external_id ?? ""), "en_el_dia");
          return json(201, { id: e.seguimiento, status: "pending" });
        }
        const d = /^\/cabify\/api\/v1\/deliveries\/([^/]+)$/.exec(p);
        if (d) {
          const e = envios.get(decodeURIComponent(d[1]!));
          return e ? json(200, { id: e.seguimiento, status: e.eventos.at(-1)!.texto, events: e.eventos.map((ev) => ({ status: ev.texto, timestamp: ev.fecha.toISOString(), description: ev.texto })) }) : json(404, {});
        }
      }

      // ── WhatsApp Cloud API ──
      const wa = /^\/whatsapp\/v[\d.]+\/(\d+)\/messages$/.exec(p);
      if (wa && req.method === "POST") {
        if (!autorizado(req)) return json(401, { error: { code: 190, message: "Invalid OAuth access token" } });
        if (body.type !== "template" || !body.template?.name) return json(400, { error: { code: 131009, message: "Parameter value is not valid" } });
        const parametros = (body.template.components?.[0]?.parameters ?? []).map((x: { text: string }) => x.text);
        mensajes.push({ fecha: new Date(), para: String(body.to), plantilla: body.template.name, parametros });
        return json(200, { messaging_product: "whatsapp", contacts: [{ input: body.to, wa_id: body.to }], messages: [{ id: `wamid.${randomBytes(8).toString("hex")}` }] });
      }
      if (p === "/whatsapp/mensajes") return json(200, mensajes);

      json(404, { error: "ruta no simulada", ruta: p });
    } catch (e) {
      json(500, { error: (e as Error).message });
    }
  });
  await new Promise<void>((r) => servidor.listen(puerto, host, r));
  const dir = servidor.address() as { port: number };
  return {
    url: `http://${host}:${dir.port}`,
    envios, correo, rotuloCorreo, llamadas, mensajes, avanzar,
    cerrar: () => new Promise<void>((r) => servidor.close(() => r())),
  };
}
