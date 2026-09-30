/*
 * Genera fotos de MUESTRA para el catálogo de muestra (siluetas de prendas
 * del color de cada variante), con la forma de carpeta que espera
 * `pnpm fotos:importar`:
 *
 *   demo/fotos/<SKU padre>/<color>/01.jpg, 02.jpg     prenda sola
 *   demo/fotos/<SKU padre>/exhibicion/<color>/01.jpg  "con modelo"
 *
 * Uso: node scripts/demo/fotos-demo.mjs [carpeta]   (por defecto demo/fotos)
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { hexDeColor, esClaro } from "@isu/shared";
import { catalogoDemo } from "./catalogo.mjs";

const destino = path.resolve(process.argv[2] ?? "demo/fotos");
const W = 1000, H = 1250;

const FORMAS = {
  remera: "M330 250 L420 215 Q500 265 580 215 L670 250 L790 370 L720 450 L660 400 L660 980 L340 980 L340 400 L280 450 L210 370 Z",
  top: "M390 230 L430 230 Q500 330 570 230 L610 230 Q600 330 650 420 L650 960 L350 960 L350 420 Q400 330 390 230 Z",
  buzo: "M330 290 Q360 200 440 190 Q500 150 560 190 Q640 200 670 290 L800 420 L820 900 L740 910 L700 500 L680 500 L680 1000 L320 1000 L320 500 L300 500 L260 910 L180 900 L200 420 Z",
  pantalon: "M340 200 L660 200 L700 1050 L560 1050 L505 420 L495 420 L440 1050 L300 1050 Z",
  short: "M320 330 L680 330 L720 760 L540 780 L505 520 L495 520 L460 780 L280 760 Z",
};

function oscurecer(hex, f = 0.75) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => Math.round(x * f));
  return `#${c.map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

function svgPrenda(forma, hex, { fondo = "#f2f1ee", zoom = 1, modelo = false, texto = "" } = {}) {
  const trazo = esClaro(hex) ? "#b9b4a8" : oscurecer(hex);
  const cabeza = modelo ? `<circle cx="500" cy="${forma === "pantalon" || forma === "short" ? 120 : 110}" r="70" fill="#d9b59a"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${fondo}"/><stop offset="1" stop-color="${oscurecer(fondo, 0.93)}"/></linearGradient>
  <filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="14" stdDeviation="18" flood-opacity="0.18"/></filter></defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <g transform="translate(${500 - 500 * zoom} ${625 - 625 * zoom}) scale(${zoom})">
    ${cabeza}
    <path d="${FORMAS[forma]}" fill="${hex}" stroke="${trazo}" stroke-width="5" stroke-linejoin="round" filter="url(#s)"/>
  </g>
  <text x="40" y="${H - 40}" font-family="sans-serif" font-size="28" fill="#8a877f">${texto}</text>
</svg>`;
}

const catalogo = catalogoDemo();
let n = 0;
for (const p of catalogo) {
  const colores = [...new Set(p.variantes.map((v) => v.color))];
  for (const [i, color] of colores.entries()) {
    const hex = hexDeColor(color) ?? "#999999";
    const dir = path.join(destino, p.sku, color);
    await mkdir(dir, { recursive: true });
    await sharp(Buffer.from(svgPrenda(p.forma, hex, { texto: "Foto de muestra" }))).jpeg({ quality: 88 }).toFile(path.join(dir, "01.jpg"));
    await sharp(Buffer.from(svgPrenda(p.forma, hex, { zoom: 1.6, texto: "Detalle · muestra" }))).jpeg({ quality: 88 }).toFile(path.join(dir, "02.jpg"));
    n += 2;
    if (i === 0) {
      const ex = path.join(destino, p.sku, "exhibicion", color);
      await mkdir(ex, { recursive: true });
      await sharp(Buffer.from(svgPrenda(p.forma, hex, { fondo: "#eaf1f8", modelo: true, zoom: 0.9, texto: "Con modelo · muestra" }))).jpeg({ quality: 88 }).toFile(path.join(ex, "01.jpg"));
      n++;
    }
  }
}
console.warn(`${n} fotos de muestra en ${destino}`);
