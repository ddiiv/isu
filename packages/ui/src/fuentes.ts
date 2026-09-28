import localFont from "next/font/local";

/*
 * Tipografías de la marca, servidas desde el propio sitio (sin Google Fonts):
 * una conexión menos en la primera carga y nada de datos del visitante a un
 * tercero. Las dos son OFL (licencias al lado de los archivos).
 *
 *   Outfit        títulos: geométrica y pesada, el golpe tipográfico grande.
 *   Instrument    texto: legible en tamaños chicos, con buen ancho de letra.
 */
export const display = localFont({
  src: "./fuentes/Outfit-Bold.ttf",
  weight: "700",
  variable: "--fuente-display",
  display: "swap",
  preload: true,
  fallback: ["system-ui", "Arial", "sans-serif"],
});

export const texto = localFont({
  src: [
    { path: "./fuentes/InstrumentSans-Regular.ttf", weight: "400", style: "normal" },
    { path: "./fuentes/InstrumentSans-Bold.ttf", weight: "700", style: "normal" },
  ],
  variable: "--fuente-texto",
  display: "swap",
  preload: true,
  fallback: ["system-ui", "Arial", "sans-serif"],
});
