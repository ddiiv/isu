import type { Metadata, Viewport } from "next";
import { display, texto } from "@isu/ui/fuentes";
import { Anuncio } from "@/components/Anuncio";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { BotonWhatsapp } from "@/components/BotonWhatsapp";
import { Asistente } from "@/components/chat/Asistente";
import { Analytics } from "@/components/Analytics";
import { Hidratado } from "@/components/Hidratado";
import { ProveedorCarrito } from "@/components/carrito/Carrito";
import { CajonCarrito } from "@/components/carrito/CajonCarrito";
import { obtenerCategorias, obtenerConfig, obtenerMenu } from "@/lib/api";
import { SITIO } from "@/lib/sitio";
import { preconnect } from "react-dom";

const CDN_FOTOS = (process.env.NEXT_PUBLIC_CDN_IMAGENES ?? "").split(",")[0]?.trim();
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITIO.url),
  title: { default: `${SITIO.nombre} · Ropa urbana y casual`, template: `%s · ${SITIO.nombre}` },
  description: SITIO.descripcion,
  applicationName: SITIO.nombre,
  alternates: { canonical: "/" },
  openGraph: { type: "website", locale: "es_AR", siteName: SITIO.nombre, url: "/" },
  twitter: { card: "summary_large_image" },
  robots: { index: true, follow: true, "max-image-preview": "large" },
  formatDetection: { telephone: false },
  // Search Console y Bing Webmaster (método "etiqueta HTML"). Mejor por DNS en Cloudflare; esto es la alternativa.
  verification: {
    ...(process.env.GOOGLE_SITE_VERIFICATION ? { google: process.env.GOOGLE_SITE_VERIFICATION } : {}),
    ...(process.env.BING_SITE_VERIFICATION ? { other: { "msvalidate.01": process.env.BING_SITE_VERIFICATION } } : {}),
  },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
};

export default async function Layout({ children }: { children: React.ReactNode }) {
  const [config, categorias, fotos] = await Promise.all([obtenerConfig(), obtenerCategorias(), obtenerMenu()]);
  // La primera foto es casi siempre lo más grande de la pantalla: conectarse antes al dominio de fotos.
  if (CDN_FOTOS?.startsWith("http")) preconnect(new URL(CDN_FOTOS).origin);
  return (
    <html lang="es-AR" className={`${display.variable} ${texto.variable}`}>
      <body>
        <a href="#contenido" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-white focus:px-4 focus:py-2 focus:shadow">Saltar al contenido</a>
        <ProveedorCarrito>
          <Anuncio texto={config.anuncio} envioGratisDesde={config.envioGratisDesde} />
          <Header categorias={categorias} menu={{ hayPacks: config.hayPacks, packsEn: config.packsEn, hayLiquidacion: config.hayLiquidacion, liquidacionEn: config.liquidacionEn, fotos }} />
          <main id="contenido">{children}</main>
          <Footer config={config} categorias={categorias} />
          {/* Con el asistente prendido, la burbuja es el chat (con WhatsApp adentro); si no, WhatsApp directo. */}
          {config.chatbot.activo ? <Asistente saludo={config.chatbot.saludo} whatsapp={config.whatsapp} /> : <BotonWhatsapp numero={config.whatsapp} />}
          <CajonCarrito descuento={config.descuentoTransferencia} montoMinimo={config.montoMinimoCarrito} />
        </ProveedorCarrito>
        <Analytics />
        <Hidratado />
      </body>
    </html>
  );
}
