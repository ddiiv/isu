import type { MetadataRoute } from "next";
import { SITIO } from "@/lib/sitio";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/carrito", "/checkout", "/cuenta", "/buscar?", "/api/"] }],
    sitemap: `${SITIO.url}/sitemap.xml`,
    host: SITIO.url,
  };
}
