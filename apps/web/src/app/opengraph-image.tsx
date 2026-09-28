import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";

/* Imagen para compartir el sitio (WhatsApp, redes). Se genera en el build. */
export const alt = "Isuwaya · Prenditas para todos tus días";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Imagen() {
  const raiz = path.join(process.cwd(), "../../packages/ui/src");
  const [fuente, isotipo] = await Promise.all([
    readFile(path.join(raiz, "fuentes/Outfit-Bold.ttf")),
    readFile(path.join(raiz, "marca/isotipo-recortado.png")),
  ]);
  const logo = `data:image/png;base64,${isotipo.toString("base64")}`;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 80, background: "#eaf1f8", fontFamily: "Outfit" }}>
        <img src={logo} width={120} height={120} alt="" />
        <div style={{ fontSize: 96, color: "#2c5f91", lineHeight: 1, marginTop: 36 }}>Prenditas para</div>
        <div style={{ fontSize: 96, color: "#2c5f91", lineHeight: 1 }}>todos tus días</div>
        <div style={{ fontSize: 44, color: "#1d4675", marginTop: 24 }}>isuwaya · ropa urbana y casual</div>
      </div>
    ),
    { ...size, fonts: [{ name: "Outfit", data: fuente, weight: 700, style: "normal" }] },
  );
}
