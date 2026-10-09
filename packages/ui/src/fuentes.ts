import localFont from "next/font/local";

/*
 * Tipografías de la marca, servidas desde el propio sitio (sin Google Fonts):
 * una conexión menos en la primera carga y nada de datos del visitante a un
 * tercero. Las dos son OFL (licencias al lado de los archivos).
 *
 * Etapa 14: en WOFF2 y sólo con el alfabeto latino (español, signos, € y
 * flechas): 59 KB en vez de 191 KB en la primera visita. El TTF de Outfit
 * queda para la imagen de redes (opengraph-image), que no lee WOFF2.
 *
 *   Outfit        títulos: geométrica y pesada, el golpe tipográfico grande.
 *   Instrument    texto: legible en tamaños chicos, con buen ancho de letra.
 */
export const display = localFont({
  src: "./fuentes/Outfit-Bold.woff2",
  weight: "700",
  variable: "--fuente-display",
  display: "swap",
  preload: true,
  fallback: ["system-ui", "Arial", "sans-serif"],
});

export const texto = localFont({
  src: [
    { path: "./fuentes/InstrumentSans-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fuentes/InstrumentSans-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--fuente-texto",
  display: "swap",
  preload: true,
  fallback: ["system-ui", "Arial", "sans-serif"],
});
