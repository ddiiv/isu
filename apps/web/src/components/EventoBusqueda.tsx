"use client";
import { useEffect } from "react";
import { terminoBusqueda } from "@isu/shared/puro";
import { evento } from "@/lib/ga";

/* GA4 `search`: una vez por consulta ya resuelta (no por tecla). No dibuja nada. */
export function EventoBusqueda({ q, total }: { q: string; total: number }) {
  useEffect(() => {
    const t = terminoBusqueda(q);
    if (t) evento("search", { search_term: t, results: total });
  }, [q, total]);
  return null;
}
