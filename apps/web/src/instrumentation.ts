/*
 * Al arrancar el servidor de la tienda.
 *
 * En Railway el build no llega a la API: las páginas que se guardan en el
 * build (el inicio, Nuevos, Destacados…) salen con los valores de respaldo,
 * sin productos ni asistente, y así quedarían hasta que vencen (5 minutos).
 * Apenas la API contesta, la tienda se pide a sí misma regenerarlas
 * (/api/revalidar, el mismo aviso que manda el worker cuando cambia algo).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production") return;
  const token = process.env.REVALIDAR_TOKEN ?? "";
  if (token.length < 32) return;
  const api = (process.env.API_URL ?? "http://127.0.0.1:4000").replace(/\/+$/, "");
  const propia = `http://127.0.0.1:${process.env.PORT || 3000}`;
  void (async () => {
    for (let i = 0; i < 200; i++) { // ~10 minutos
      await new Promise((r) => setTimeout(r, 3000));
      try {
        if (!(await fetch(`${api}/healthz`, { cache: "no-store", signal: AbortSignal.timeout(2500) })).ok) continue;
        const r = await fetch(`${propia}/api/revalidar`, {
          method: "POST", cache: "no-store", signal: AbortSignal.timeout(5000),
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ etiquetas: ["catalogo"] }),
        });
        if (r.ok) { console.warn("[arranque] la API contesta: páginas del catálogo regeneradas"); return; }
      } catch { /* la API o la propia tienda todavía no escuchan */ }
    }
    console.warn("[arranque] la API no contestó en 10 minutos: las páginas se regeneran solas al vencer");
  })();
}
