import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatearPesos } from "@isu/shared";
import type { PedidoVenta } from "./pedido.js";

/*
 * El PDF del pedido (adjunto de «Pago confirmado» y del mail interno de venta).
 * Sin imágenes ni fuentes externas: Helvetica estándar, que sólo sabe Latin-1
 * (tildes y ñ sí; un emoji o un guion largo raro no), así que lo demás sale "?".
 */
const A4: [number, number] = [595, 842];
const MARGEN = 40;
const AZUL = rgb(0.17, 0.37, 0.57), GRIS = rgb(0.42, 0.42, 0.42);

/** `interno`: el del aviso al negocio aclara que la venta es de la tienda minorista; el del cliente es su comprobante. */
export async function pdfPedido(p: PedidoVenta, interno = false): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  const soporta = new Set(normal.getCharacterSet());
  // Intl usa un espacio de no cortar entre "$" y el número: se pasa a un espacio común.
  const limpiar = (s: string) => [...s.replace(/\u00a0/g, " ").replace(/\u2212/g, "-")].map((c) => (soporta.has(c.codePointAt(0)!) ? c : "?")).join("");
  const pesos = (c: number) => limpiar(formatearPesos(c));

  let pag!: PDFPage;
  let y = 0;
  const nueva = () => { pag = doc.addPage(A4); y = A4[1] - MARGEN; };
  const linea = (izq: string, der = "", o: { f?: PDFFont; t?: number; color?: ReturnType<typeof rgb>; ancho?: number } = {}) => {
    const f = o.f ?? normal, t = o.t ?? 10;
    if (y < MARGEN + 30) nueva();
    // Un nombre largo se corta con "...": nunca se pisa con el precio.
    let texto = limpiar(izq);
    const tope = (o.ancho ?? A4[0] - 2 * MARGEN) - (der ? f.widthOfTextAtSize(limpiar(der), t) + 12 : 0);
    if (f.widthOfTextAtSize(texto, t) > tope) {
      while (texto.length > 1 && f.widthOfTextAtSize(`${texto}...`, t) > tope) texto = texto.slice(0, -1);
      texto += "...";
    }
    pag.drawText(texto, { x: MARGEN, y, size: t, font: f, color: o.color ?? rgb(0.09, 0.09, 0.09) });
    if (der) pag.drawText(limpiar(der), { x: A4[0] - MARGEN - f.widthOfTextAtSize(limpiar(der), t), y, size: t, font: f, color: o.color ?? rgb(0.09, 0.09, 0.09) });
    y -= t + 6;
  };
  const titulo = (s: string) => { y -= 8; linea(s, "", { f: negrita, t: 11, color: AZUL }); };

  nueva();
  linea(interno ? "Venta de la tienda online minorista · www.isuwaya.com" : "Isuwaya · tu compra en www.isuwaya.com", "", { f: negrita, t: 14, color: AZUL });
  linea(`Pedido ${p.numero}`, new Date(p.creadoEn).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", dateStyle: "short", timeStyle: "short" }), { f: negrita, t: 12 });

  titulo("Cliente");
  linea(p.nombre);
  linea(`${p.email} · Tel. ${p.telefono} · DNI ${p.dni}`);

  titulo("Prendas");
  for (const i of p.items) {
    linea(`${i.cantidad} x ${i.nombre}${i.color ? ` · ${i.color}` : ""}${i.talle ? ` · talle ${i.talle}` : ""}`, pesos(i.precio * i.cantidad));
    linea(`${pesos(i.precio)} c/u`, "", { t: 8, color: GRIS });
  }

  titulo("Totales");
  linea("Subtotal", pesos(p.subtotal));
  if (p.cupon) linea(p.cupon.charAt(0).toUpperCase() + p.cupon.slice(1), p.descuentoCupon ? `-${pesos(p.descuentoCupon)}` : "Envío gratis");
  if (p.descuento) linea("Descuento por transferencia", `-${pesos(p.descuento)}`);
  linea(p.entrega === "envio" ? "Envío" : "Retiro en el local", p.envio ? pesos(p.envio) : "Gratis");
  linea("Total", pesos(p.total), { f: negrita, t: 13 });

  titulo("Envío");
  if (p.entrega === "retiro") linea(`Retiro en ${p.local ?? "el local"}`);
  else {
    linea(`${p.transporte ?? "Envío"}${p.sucursal ? ` · sucursal ${p.sucursal}` : ""}`);
    if (p.direccion) linea(p.direccion);
  }

  titulo("Pago");
  linea(p.medioPago);

  return Buffer.from(await doc.save());
}
