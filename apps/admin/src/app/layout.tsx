import type { Metadata } from "next";
import { display, texto } from "@isu/ui/fuentes";
import "./globals.css";
import { Hidratado } from "@/components/Hidratado";

export const metadata: Metadata = { title: "Backoffice · Isuwaya", robots: { index: false, follow: false } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR" className={`${display.variable} ${texto.variable}`}>
      <body>{children}<Hidratado /></body>
    </html>
  );
}
