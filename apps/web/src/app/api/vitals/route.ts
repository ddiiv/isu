/*
 * POST /api/vitals — web vitals de visitas reales cuando no hay GA
 * (components/WebVitals.tsx). Sólo deja una línea en el log; no guarda nada.
 * Lo que llega se valida entero: cualquiera puede mandar cualquier cosa.
 */
export const dynamic = "force-dynamic";

const NOMBRES = new Set(["LCP", "INP", "CLS", "TTFB"]);
const NOTAS = new Set(["good", "needs-improvement", "poor"]);
const RUTA = /^\/[\w\-./%]{0,200}$/;

// Tope global por minuto: que nadie llene el log mandando de a miles.
const TOPE_POR_MINUTO = 600;
let minuto = 0, enEsteMinuto = 0;

export async function POST(req: Request) {
  const texto = await req.text();
  if (texto.length > 1000) return new Response(null, { status: 413 });
  let d: Record<string, unknown>;
  try { d = JSON.parse(texto) as Record<string, unknown>; } catch { return new Response(null, { status: 400 }); }
  const { nombre, valor, nota, ruta } = d ?? {};
  if (typeof nombre !== "string" || !NOMBRES.has(nombre) || typeof valor !== "number" || !Number.isFinite(valor) || valor < 0 || valor > 600_000
    || typeof nota !== "string" || !NOTAS.has(nota) || typeof ruta !== "string" || !RUTA.test(ruta)) {
    return new Response(null, { status: 400 });
  }
  const ahora = Math.floor(Date.now() / 60_000);
  if (ahora !== minuto) { minuto = ahora; enEsteMinuto = 0; }
  if (++enEsteMinuto <= TOPE_POR_MINUTO) process.stdout.write(`[vitals] ${nombre}=${nombre === "CLS" ? valor.toFixed(3) : Math.round(valor)} ${nota} ${ruta}\n`);
  return new Response(null, { status: 204 });
}
