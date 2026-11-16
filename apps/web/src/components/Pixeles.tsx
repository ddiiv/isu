"use client";
import { useEffect } from "react";
import { CLAVE_CONSENTIMIENTO, leerEleccion } from "@isu/shared";

/** Lo dispara el aviso de cookies al elegir, para cargar los píxeles en el acto si aceptó. */
export const ELECCION_COOKIES = "isu:eleccion";

/*
 * Pixel de Meta y Microsoft Clarity: se cargan SÓLO si hay ID y la persona aceptó las cookies
 * (los IDs ya vienen validados del servidor). Si rechaza, no se pide nada a esos sitios.
 * Los eventos de compra los manda lib/ga.ts (`evento`) con el mismo hecho para Meta.
 */
export function Pixeles({ meta, clarity }: { meta: string | null; clarity: string | null }) {
  useEffect(() => {
    let cargado = false;
    const cargar = () => {
      if (cargado) return;
      try { if (leerEleccion(localStorage.getItem(CLAVE_CONSENTIMIENTO)) !== "granted") return; } catch { return; }
      cargado = true;
      if (meta) {
        /* eslint-disable */
        (function (f: any, b: Document, e: string, v: string) {
          if (f.fbq) return;
          const n: any = (f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); });
          if (!f._fbq) f._fbq = n;
          n.push = n; n.loaded = true; n.version = "2.0"; n.queue = [];
          const t = b.createElement(e) as HTMLScriptElement; t.async = true; t.src = v;
          b.head.appendChild(t);
        })(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
        /* eslint-enable */
        window.fbq?.("init", meta);
        window.fbq?.("track", "PageView");
      }
      if (clarity) {
        const w = window as unknown as Record<string, unknown>;
        const c = (w.clarity = w.clarity ?? function (...a: unknown[]) { ((w.clarity as { q?: unknown[] }).q = (w.clarity as { q?: unknown[] }).q ?? []).push(a); });
        void c;
        const t = document.createElement("script"); t.async = true; t.src = `https://www.clarity.ms/tag/${clarity}`;
        document.head.appendChild(t);
      }
    };
    cargar();
    window.addEventListener(ELECCION_COOKIES, cargar);
    return () => window.removeEventListener(ELECCION_COOKIES, cargar);
  }, [meta, clarity]);
  return null;
}
