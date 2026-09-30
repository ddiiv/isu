import path from "node:path";
import type { NextConfig } from "next";

// El .env está en la raíz del monorepo (lo comparten api, worker y web); Next sólo
// mira su propia carpeta. No pisa lo que ya venga del entorno (Railway).
try { process.loadEnvFile(path.join(import.meta.dirname, "../../.env")); } catch { /* sin .env: variables del entorno */ }

/*
 * Backoffice: app aparte, en su propio subdominio (admin.…), para que el
 * código de administración nunca se mande al navegador de un comprador.
 * CSP más estricta que la tienda (sin Analytics) y fuera de los buscadores.
 */
// Las fotos de los productos (R2 en producción, la API en desarrollo).
const IMAGENES = (process.env.NEXT_PUBLIC_CDN_IMAGENES ?? "").split(",").map((u) => u.trim()).filter((u) => /^https?:\/\//.test(u))
  .map((u) => (new URL(u).pathname.length > 1 && !u.endsWith("/") ? `${u}/` : u));

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV !== "production" ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${IMAGENES.join(" ")}`,
  "font-src 'self'",
  // Todo pasa por /api/a (mismo origen): el navegador no habla con la API directo.
  "connect-src 'self'",
  "frame-src 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
].join("; ");

const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  transpilePackages: ["@isu/ui", "@isu/shared"],
  poweredByHeader: false,
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: csp },
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Cache-Control", value: "no-store" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    }];
  },
};
export default config;
