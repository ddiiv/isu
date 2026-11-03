"use client";
import { useReportWebVitals } from "next/web-vitals";

/*
 * Web vitals de visitas reales (LCP, INP, CLS, TTFB). Con GA configurado van
 * como eventos de GA4; si no, a /api/vitals, que sólo los deja en el log.
 */
const MEDIDAS = new Set(["LCP", "INP", "CLS", "TTFB"]);
const GA = /^G-[A-Z0-9]{4,}$/.test(process.env.NEXT_PUBLIC_GA_ID ?? "");

// Fuera del componente: si la función cambia, Next la vuelve a llamar con todas las medidas (duplicadas).
const informar: Parameters<typeof useReportWebVitals>[0] = (m) => {
  if (!MEDIDAS.has(m.name)) return;
  try {
    if (GA) {
      // Como sugiere Google: delta (GA suma por id), CLS × 1000 para que sea entero.
      window.gtag?.("event", m.name, { value: Math.round(m.name === "CLS" ? m.delta * 1000 : m.delta), metric_id: m.id, metric_value: m.value, metric_rating: m.rating, page_path: location.pathname, non_interaction: true });
    } else {
      navigator.sendBeacon?.("/api/vitals", JSON.stringify({ nombre: m.name, valor: m.value, nota: m.rating, ruta: location.pathname }));
    }
  } catch { /* medir nunca rompe la página */ }
};

export function WebVitals() {
  useReportWebVitals(informar);
  return null;
}
