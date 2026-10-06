import { strFromU8, strToU8, unzipSync, zipSync, type Unzipped } from "fflate";

/*
 * Excel (.xlsx) chico, sin dependencias pesadas: un .xlsx es un zip con XML
 * adentro. Alcanza para las planillas del backoffice (guías de talles): una
 * tabla de texto y números por hoja. No lee fórmulas (usa el último valor
 * calculado que guardó Excel), estilos ni celdas combinadas.
 *
 * Lo que sube alguien es de afuera: tope de tamaño del archivo, de lo que
 * ocupa descomprimido (un zip chico puede inflarse a gigas) y de hojas,
 * filas y columnas.
 */
export const MAX_XLSX = 5 * 1024 * 1024;
const MAX_DESCOMPRIMIDO = 40 * 1024 * 1024;
const MAX_PARTE = 15 * 1024 * 1024;
const MAX_HOJAS = 100;
const MAX_FILAS = 500;
const MAX_COLUMNAS = 50;

export type Celda = string | number | null;
export interface Hoja { nombre: string; filas: Celda[][] }

export class ErrorXlsx extends Error {}

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decodificar = (s: string) => s.replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|[a-z]{2,4});/g, (m, e: string) => {
  if (e[0] === "#") {
    const n = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
  }
  return ENTIDADES[e] ?? m;
});
const escapar = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)
  // Caracteres de control que XML no admite.
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const atributo = (tag: string, nombre: string) => {
  const m = new RegExp(`\\s${nombre}="([^"]*)"`).exec(tag);
  return m ? decodificar(m[1]!) : null;
};
/** "B12" → columna 1 (desde 0). */
const columna = (ref: string) => {
  let n = 0;
  for (const c of /^[A-Z]{1,3}/.exec(ref)?.[0] ?? "") n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
};
/** El texto de un <si> o un <is>: todos sus <t> (los "runs" con formato), sin la fonética. */
const textoDe = (xml: string) => [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)].map((m) => decodificar(m[1] ?? "")).join("");

export function leerXlsx(datos: Uint8Array): Hoja[] {
  if (datos.length > MAX_XLSX) throw new ErrorXlsx("El archivo pesa más de 5 MB.");
  let partes: Unzipped;
  let total = 0;
  try {
    partes = unzipSync(datos, {
      filter: (f) => {
        // Sólo lo que hace falta, y nada que se infle de más.
        const sirve = f.name === "xl/workbook.xml" || f.name === "xl/_rels/workbook.xml.rels" || f.name === "xl/sharedStrings.xml" || /^xl\/worksheets\/[^/]+\.xml$/.test(f.name);
        if (!sirve) return false;
        total += f.originalSize;
        if (f.originalSize > MAX_PARTE || total > MAX_DESCOMPRIMIDO) throw new ErrorXlsx("El archivo es demasiado grande por dentro.");
        return true;
      },
    });
  } catch (e) {
    if (e instanceof ErrorXlsx) throw e;
    throw new ErrorXlsx("No es un archivo de Excel (.xlsx) válido.");
  }
  const xml = (n: string) => (partes[n] ? strFromU8(partes[n]!) : null);
  const libro = xml("xl/workbook.xml");
  if (!libro) throw new ErrorXlsx("No es un archivo de Excel (.xlsx) válido.");

  const rels = new Map<string, string>();
  for (const m of (xml("xl/_rels/workbook.xml.rels") ?? "").matchAll(/<Relationship\b[^>]*>/g)) {
    const id = atributo(m[0], "Id");
    const destino = atributo(m[0], "Target");
    if (id && destino) rels.set(id, destino.replace(/^\/?(xl\/)?/, "xl/"));
  }
  const compartidos = [...(xml("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)].map((m) => textoDe(m[1] ?? ""));

  const hojas: Hoja[] = [];
  for (const m of libro.matchAll(/<sheet\b[^>]*>/g)) {
    if (hojas.length >= MAX_HOJAS) throw new ErrorXlsx(`Como mucho ${MAX_HOJAS} hojas por archivo.`);
    const nombre = atributo(m[0], "name") ?? `Hoja ${hojas.length + 1}`;
    const ruta = rels.get(atributo(m[0], "r:id") ?? "");
    const contenido = ruta ? xml(ruta) : null;
    if (!contenido) continue;
    const filas: Celda[][] = [];
    for (const f of contenido.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const r = Number(atributo(`<row${f[1]}>`, "r") ?? filas.length + 1) - 1;
      if (r >= MAX_FILAS) throw new ErrorXlsx(`La hoja "${nombre}" tiene más de ${MAX_FILAS} filas.`);
      const fila: Celda[] = [];
      for (const c of f[2]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const tag = `<c${c[1]}>`;
        const col = columna(atributo(tag, "r") ?? "");
        const i = col >= 0 ? col : fila.length;
        if (i >= MAX_COLUMNAS) throw new ErrorXlsx(`La hoja "${nombre}" tiene más de ${MAX_COLUMNAS} columnas.`);
        const dentro = c[2] ?? "";
        const v = /<v>([\s\S]*?)<\/v>/.exec(dentro)?.[1];
        const t = atributo(tag, "t");
        let valor: Celda = null;
        if (t === "s") valor = compartidos[Number(v)] ?? null;
        else if (t === "inlineStr") valor = textoDe(/<is>([\s\S]*?)<\/is>/.exec(dentro)?.[1] ?? "");
        else if (t === "str" || t === "e") valor = v === undefined ? null : decodificar(v);
        else if (t === "b") valor = v === "1" ? "VERDADERO" : "FALSO";
        else if (v !== undefined) { const n = Number(v); valor = Number.isFinite(n) ? n : decodificar(v); }
        fila[i] = valor;
      }
      filas[r] = Array.from(fila, (x) => x ?? null);
    }
    hojas.push({ nombre, filas: Array.from(filas, (x) => x ?? []) });
  }
  return hojas;
}

/** Nombre de hoja válido para Excel: sin []:*?/\ y hasta 31 letras, sin repetir. */
export function nombreDeHoja(nombre: string, usados: Set<string>): string {
  const base = (nombre.replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim() || "Hoja").slice(0, 31);
  let n = base;
  for (let i = 2; usados.has(n.toLowerCase()); i++) n = `${base.slice(0, 31 - String(i).length - 1)} ${i}`;
  usados.add(n.toLowerCase());
  return n;
}

const letra = (i: number) => { let s = ""; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

export function escribirXlsx(hojas: Hoja[]): Uint8Array {
  const usados = new Set<string>();
  const nombres = hojas.map((h) => nombreDeHoja(h.nombre, usados));
  const archivos: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${nombres.map((n, i) => `<sheet name="${escapar(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${hojas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    // Dos estilos: el normal y la primera fila/columna en negrita.
    "xl/styles.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`),
  };
  hojas.forEach((h, i) => {
    const filas = h.filas.map((f, r) => `<row r="${r + 1}">${f.map((v, c) => {
      if (v === null || v === "") return "";
      const ref = `${letra(c)}${r + 1}`;
      const estilo = r === 0 || c === 0 ? ' s="1"' : "";
      return typeof v === "number" && Number.isFinite(v)
        ? `<c r="${ref}"${estilo}><v>${v}</v></c>`
        : `<c r="${ref}"${estilo} t="inlineStr"><is><t xml:space="preserve">${escapar(String(v))}</t></is></c>`;
    }).join("")}</row>`).join("");
    archivos[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="34" customWidth="1"/></cols><sheetData>${filas}</sheetData></worksheet>`);
  });
  return zipSync(archivos, { level: 6 });
}
