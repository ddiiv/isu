import path from "node:path";
import type { NextConfig } from "next";

// El .env está en la raíz del monorepo (lo comparten api, worker y web); Next sólo
// mira su propia carpeta. No pisa lo que ya venga del entorno (Railway).
try { process.loadEnvFile(path.join(import.meta.dirname, "../../.env")); } catch { /* sin .env: variables del entorno */ }

/*
 * Cabeceras de seguridad de la tienda.
 *
 * CSP: las páginas se generan estáticas (ISR) para que carguen al instante y
 * aguanten picos sin tocar el servidor; eso impide usar nonces por pedido.
 * Por eso script-src lleva 'unsafe-inline' (los scripts de arranque de Next),
 * pero NADA más externo que Google Analytics, sin eval, sin objetos, sin
 * iframes de terceros y sin que nos embeban. La defensa principal contra XSS
 * es que React escapa todo y el único HTML crudo es el JSON-LD, que se
 * serializa escapando "<".
 */
const GA = ["https://www.googletagmanager.com", "https://www.google-analytics.com", "https://*.google-analytics.com", "https://*.analytics.google.com"];
const IMAGENES = (process.env.NEXT_PUBLIC_CDN_IMAGENES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
// En CSP, una fuente con ruta y sin "/" final coincide SÓLO con esa ruta exacta: "…/fotos" no deja cargar "…/fotos/p/1.webp".
const FUENTES_IMAGENES = IMAGENES.map((u) => (new URL(u).pathname.length > 1 && !u.endsWith("/") ? `${u}/` : u));
const dev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${dev ? "'unsafe-eval'" : ""} ${GA[0]}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${[...GA, ...FUENTES_IMAGENES].join(" ")}`,
  "font-src 'self'",
  `connect-src 'self' ${GA.join(" ")} ${process.env.NEXT_PUBLIC_API_URL ?? ""}`,
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  dev ? "" : "upgrade-insecure-requests",
].filter(Boolean).join("; ");

const config: NextConfig = {
  output: "standalone",
  // Monorepo: el build standalone tiene que ver los paquetes de la raíz.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  transpilePackages: ["@isu/ui", "@isu/shared"],
  poweredByHeader: false,
  reactStrictMode: true,
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: IMAGENES.filter((u) => u.startsWith("https:")).map((u) => ({ protocol: "https" as const, hostname: new URL(u).hostname })),
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp.replace(/\s+/g, " ") },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self)" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          ...(dev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" }]),
        ],
      },
    ];
  },
};

export default config;
