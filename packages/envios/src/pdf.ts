/*
 * Un PDF de una página con texto, sin dependencias. Lo usa el simulador para
 * las etiquetas de prueba (y el backoffice si un transporte no da etiqueta:
 * una hoja con los datos para escribir a mano).
 */
export function pdfSimple(lineas: string[], tamano: [number, number] = [288, 432]): Buffer {
  // Latin-1 para que salgan tildes con la fuente estándar; lo demás, "?".
  const limpiar = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\xff]/g, "?");
  const [ancho, alto] = tamano;
  const texto = lineas.map((l, i) => `BT /F1 ${i === 0 ? 16 : 10} Tf 18 ${alto - 30 - i * 18} Td (${limpiar(l)}) Tj ET`).join("\n");
  const objetos = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ancho} ${alto}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,
    `<< /Length ${Buffer.byteLength(texto, "latin1")} >>\nstream\n${texto}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];
  let salida = "%PDF-1.4\n";
  const posiciones: number[] = [];
  objetos.forEach((o, i) => { posiciones.push(Buffer.byteLength(salida, "latin1")); salida += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(salida, "latin1");
  salida += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n${posiciones.map((p) => `${String(p).padStart(10, "0")} 00000 n \n`).join("")}`;
  salida += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(salida, "latin1");
}
