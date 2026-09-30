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

export interface Simulador {
  url: string;
  envios: Map<string, Envio>;
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
  // Tarifa de mentira pero razonable: AMBA más barato que el interior; más peso, más caro.
  const precio = (base: number, cp: string, gramos: number) => Math.round(base * (Number(cp) < 1900 ? 1 : 1.4) + Math.max(0, gramos - 1000) * 0.9);
  const sucursales = (prefijo: string, cp: string) => [1, 2, 3].map((i) => ({ id: `${prefijo}${cp}${i}`, nombre: `Sucursal ${prefijo.toUpperCase()} ${cp}-${i}`, calle: ["Av. Rivadavia", "Av. Corrientes", "Belgrano"][i - 1]!, numero: String(1000 + i * 150), cp }));
  const xml = (cuerpo: string) => `<?xml version="1.0" encoding="utf-8"?><DataSet xmlns="http://tempuri.org/"><diffgram><NewDataSet>${cuerpo}</NewDataSet></diffgram></DataSet>`;

  const servidor = http.createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", "http://sim");
    const p = u.pathname;
    const json = (s: number, c: unknown) => { res.writeHead(s, { "content-type": "application/json" }); res.end(JSON.stringify(c)); };
    const pdf = (lineas: string[]) => { res.writeHead(200, { "content-type": "application/pdf" }); res.end(pdfSimple(lineas)); };
    const texto = (s: number, t: string, tipo = "text/xml; charset=utf-8") => { res.writeHead(s, { "content-type": tipo }); res.end(t); };
    try {
      const cuerpo = req.method === "POST" || req.method === "PUT" ? await leer(req) : "";
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

      // ── Correo Argentino (MiCorreo) ──
      if (p === "/correo/token" && req.method === "POST") {
        if (!/^Basic /.test(req.headers.authorization ?? "")) return json(401, { message: "Unauthorized" });
        return json(200, { token: nuevoToken(), expire: new Date(Date.now() + 3600_000).toISOString() });
      }
      if (p.startsWith("/correo/")) {
        if (!autorizado(req)) return json(401, { message: "invalid token" });
        if (p === "/correo/rates") {
          const cp = String(body.postalCodeDestination ?? "");
          if (cp === "9999") return json(200, { rates: [] });
          const g = Number(body.dimensions?.weight ?? 500);
          return json(200, { rates: [
            { deliveredType: "D", productType: "CP", productName: "Correo Argentino Clásico", price: precio(4800, cp, g), deliveryTimeMin: "3", deliveryTimeMax: "6" },
            { deliveredType: "S", productType: "CP", productName: "Correo Argentino Clásico a sucursal", price: precio(3900, cp, g), deliveryTimeMin: "3", deliveryTimeMax: "6" },
          ].filter((r) => r.deliveredType === body.deliveredType) });
        }
        if (p === "/correo/agencies") {
          return json(200, sucursales("ca", "1406").map((s) => ({ code: s.id, name: s.nombre, status: "ACTIVE", location: { address: { streetName: s.calle, streetNumber: s.numero, locality: "CABA", postalCode: s.cp } } })));
        }
        if (p === "/correo/shipping/import" && req.method === "POST") {
          const e = crear("correo", String(body.extOrderId ?? ""), body.shipping?.deliveryType === "S" ? "sucursal" : "domicilio");
          return json(200, { createdAt: new Date().toISOString(), trackingNumber: e.seguimiento });
        }
        if (p === "/correo/shipping/tracking") {
          const e = envios.get(u.searchParams.get("shippingId") ?? "");
          if (!e) return json(404, { message: "not found" });
          const f = (d: Date) => `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
          return json(200, [{ trackingNumber: e.seguimiento, events: e.eventos.map((ev) => ({ event: ev.texto, date: f(ev.fecha), branch: "CABA", status: ev.texto })) }]);
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
    envios, mensajes, avanzar,
    cerrar: () => new Promise<void>((r) => servidor.close(() => r())),
  };
}
