import { obtenerConfig } from "@/lib/api";

/*
 * El aviso de tienda apagada (backoffice → Ajustes → Apagar la tienda). El
 * proxy manda acá todas las páginas de compra mientras dure, y tiene que
 * salir con 503 + Retry-After: una página o un layout de Next no pueden elegir
 * el estado de la respuesta, y un rewrite del proxy tampoco lo traslada. Una
 * ruta sí. Así Google lo toma como parada temporal y no desindexa nada; el
 * noindex es el respaldo por si alguien lo cachea de más.
 *
 * Es HTML suelto, sin el marco de la tienda (nada de menú de compra, carrito
 * ni asistente). Todo lo que viene del ajuste se escapa.
 */
const escapar = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export async function GET() {
  const { tiendaCerrada: t } = await obtenerConfig();
  // Contraste: #171717 sobre blanco (17:1) y #1d4675 sobre blanco (9:1).
  const html = `<!doctype html>
<html lang="es-AR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapar(t.titulo)} · Isuwaya</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #fff; color: #171717; font: 400 1.0625rem/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { box-sizing: border-box; max-width: 34rem; padding: 2rem 1.25rem; text-align: center; }
  .marca { display: inline-flex; align-items: center; gap: .6rem; font-size: 1.6rem; font-weight: 700; letter-spacing: -.01em; color: #1d4675; }
  h1 { margin: 2rem 0 .75rem; font-size: clamp(1.75rem, 6vw, 2.5rem); line-height: 1.15; }
  h1:focus { outline: none; }
  p { margin: .5rem 0; white-space: pre-line; }
  .vuelve { margin-top: 1.25rem; font-weight: 700; color: #1d4675; }
</style>
</head>
<body>
<main id="contenido">
  <p class="marca"><img src="/apple-icon.png" alt="" width="48" height="48">Isuwaya</p>
  <h1 tabindex="-1" id="titulo">${escapar(t.titulo)}</h1>
  <p>${escapar(t.mensaje)}</p>
  ${t.vuelve ? `<p class="vuelve">${escapar(t.vuelve)}</p>` : ""}
</main>
<script>document.getElementById("titulo").focus({ preventScroll: true });</script>
</body>
</html>`;
  return new Response(html, {
    status: 503,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "retry-after": "3600",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
