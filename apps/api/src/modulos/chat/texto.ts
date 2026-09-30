/*
 * Texto del asistente: normalizar lo que escribe la gente ("q talle soy??",
 * "cuanto sale el envio a cordoba") y compararlo con las preguntas
 * frecuentes. Sin librerías ni extensiones de la base: son pocas preguntas y
 * se comparan en memoria.
 *
 * Cada palabra se reduce a una raíz (sin tildes, sin plural, sin la
 * terminación verbal y como mucho 5 letras): "envíos", "enviar" y "envian"
 * dan "envi"; "cambio" y "cambiar", "cambi"; "seguro" ("segur") no se
 * confunde con "seguimiento" ("segui"). Las palabras raras pesan más que las
 * comunes. Tosco, pero en español alcanza para las preguntas de una tienda.
 */

const VACIAS = new Set(("a al algo algun alguna ante antes aqui asi aun bien cada como con contra cual cuales de del desde donde dos el ella ellas ellos en entre era es esa ese eso esta estas este esto estos fue ha hay hola la las le les lo los mas me mi mis mucho muy nada ni no nos o otra otro para pero poco por porque puede puedo que quien se sea si sin sobre son su sus tambien te tengo tiene tu tus un una uno unos unas usted vos y ya yo che buenas buen dia dias tardes noches gracias favor quiero queria quisiera necesito saber consulta pregunta hacer hago tienen tenes tienes podes pueden seria soy sos estoy estas ser").split(" "));

/* Formas de decir lo mismo → una palabra de la pregunta frecuente. */
const SINONIMOS: Record<string, string> = {
  mandan: "envio", mandar: "envio", mandas: "envio", manda: "envio", correo: "envio", despachan: "envio", despacho: "envio", delivery: "envio", shipping: "envio",
  rastrear: "seguimiento", rastreo: "seguimiento", trackear: "seguimiento", tracking: "seguimiento", codigo: "seguimiento",
  plata: "devolucion", reembolso: "devolucion", reintegro: "devolucion", devuelven: "devolucion", devolver: "devolucion",
  mp: "mercadopago", mercado: "mercadopago", tarjetas: "tarjeta", visa: "tarjeta", master: "tarjeta", mastercard: "tarjeta", naranja: "tarjeta",
  transferir: "transferencia", cbu: "transferencia", alias: "transferencia",
  abren: "horario", cierran: "horario", atienden: "horario", horarios: "horario",
  medida: "talle", medidas: "talle", size: "talle", tallas: "talle", talla: "talle",
  fallada: "falla", fallado: "falla", roto: "falla", rota: "falla", defectuosa: "falla", manchada: "falla",
  mayoreo: "mayorista", revender: "mayorista", reventa: "mayorista",
};

export function normalizar(t: string): string {
  return t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ\s-]/g, " ").replace(/\s+/g, " ").trim();
}

const TERMINACIONES = ["iendo", "ando", "amos", "aron", "ado", "ido", "ar", "er", "ir", "an", "en", "o", "a", "e"];
export const raiz = (p: string) => {
  let x = SINONIMOS[p] ?? p;
  if (x.length > 4 && x.endsWith("es")) x = x.slice(0, -2);
  else if (x.length > 3 && x.endsWith("s")) x = x.slice(0, -1);
  const t = TERMINACIONES.find((f) => x.endsWith(f) && x.length - f.length >= 3);
  if (t) x = x.slice(0, -t.length);
  return x.slice(0, 5);
};

/** Las raíces importantes de un texto (sin palabras vacías ni números). */
export function raices(t: string): string[] {
  return [...new Set(normalizar(t).split(/[\s-]+/).filter((p) => p.length > 1 && !VACIAS.has(p) && !/^\d+$/.test(p)).map(raiz))];
}

export interface FaqIndexada {
  id: number; pregunta: string; respuesta: string; tema: string; enlaceTexto: string | null; enlaceUrl: string | null; orden: number;
  rPregunta: Set<string>; rPalabras: Set<string>; rRespuesta: Set<string>;
}

export function indexar<T extends { pregunta: string; palabras: string; respuesta: string }>(f: T): T & { rPregunta: Set<string>; rPalabras: Set<string>; rRespuesta: Set<string> } {
  return { ...f, rPregunta: new Set(raices(f.pregunta)), rPalabras: new Set(raices(f.palabras)), rRespuesta: new Set(raices(f.respuesta)) };
}

type Indexada = Pick<FaqIndexada, "rPregunta" | "rPalabras" | "rRespuesta">;

/*
 * Peso de cada palabra: más si aparece en pocas preguntas frecuentes ("falla")
 * que en muchas ("pago"). Una palabra que no está en ninguna (casi siempre un
 * producto o un lugar: "remera", "Córdoba") pesa poco: no tapa lo demás.
 */
export function pesos(consulta: string[], faqs: Indexada[]): Map<string, number> {
  const n = Math.max(faqs.length, 1);
  return new Map(consulta.map((r) => {
    const df = faqs.filter((f) => f.rPalabras.has(r) || f.rPregunta.has(r)).length;
    return [r, df ? Math.log(1 + n / df) : 0.5];
  }));
}

/*
 * Puntaje: qué parte (pesada) de lo que preguntó está en la pregunta
 * frecuente (palabras clave 1, pregunta 0,9, respuesta 0,35).
 */
export function puntuar(consulta: string[], f: Indexada, peso: Map<string, number> = new Map()): number {
  if (!consulta.length) return 0;
  let suma = 0, total = 0, fuertes = 0;
  for (const r of consulta) {
    const p = peso.get(r) ?? 1;
    const w = f.rPalabras.has(r) ? 1 : f.rPregunta.has(r) ? 0.9 : f.rRespuesta.has(r) ? 0.35 : 0;
    if (w >= 0.9) fuertes++;
    suma += w * p;
    total += p;
  }
  // Sin ninguna coincidencia en la pregunta o las palabras clave, no es esta.
  if (!fuertes) return 0;
  return suma / total;
}

export function mejores<F extends Indexada & { orden: number }>(consulta: string[], faqs: F[], n = 3) {
  const peso = pesos(consulta, faqs);
  return faqs.map((f) => ({ f, puntaje: puntuar(consulta, f, peso) }))
    .filter((x) => x.puntaje > 0)
    .sort((a, b) => b.puntaje - a.puntaje || a.f.orden - b.f.orden)
    .slice(0, n);
}

/*
 * ¿Alcanza para responder? Si cubre la mitad de lo que preguntó, sí. Si
 * cubre menos pero es claramente la mejor (la segunda queda lejos), también.
 */
export function alcanza(top: Array<{ puntaje: number }>): boolean {
  const [a, b] = top;
  if (!a) return false;
  if (a.puntaje >= 0.5) return true;
  return a.puntaje >= 0.3 && (!b || b.puntaje <= a.puntaje * 0.7);
}

/*
 * Antes de guardar una pregunta sin respuesta se tachan los datos
 * personales: emails, teléfonos, números de pedido, DNI, tarjetas.
 */
export function tachar(t: string): string {
  return t
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[email]")
    .replace(/isu-?\s?\d+/gi, "[pedido]")
    .replace(/\+?\d[\d\s.-]{5,}\d/g, "[número]")
    .slice(0, 300);
}

/* Código postal en el mensaje ("5000", "C1406ABC", "cp 1406") → 4 números. */
export function codigoPostal(t: string): string | null {
  const cpa = /\b[a-z](\d{4})[a-z]{3}\b/i.exec(t);
  if (cpa) return cpa[1]!;
  const m = /(?:^|\D)(\d{4})(?!\d)/.exec(t);
  return m ? m[1]! : null;
}

/* {descuento}, {cuotas}… con los valores de Ajustes. Lo que no existe queda como está. */
export function rellenar(t: string, v: Record<string, string>): string {
  return t.replace(/\{([a-zA-Z]+)\}/g, (m, k: string) => (Object.hasOwn(v, k) ? v[k]! : m));
}
