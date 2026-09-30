"use client";
import { useCallback, useEffect, useState } from "react";
import { CLAVES_MEDIDA, type MedidasCliente } from "@isu/shared";

/*
 * "Mis medidas": las que el cliente cargó en la guía de talles o en "Armá tu
 * outfit". Quedan SÓLO en este navegador (comodidad para no volver a
 * escribirlas); nunca se mandan a la tienda salvo para armar outfits, y ahí
 * no se guardan.
 */
const CLAVE = "isu:medidas";
const EVENTO = "isu:medidas";

function leer(): MedidasCliente {
  try {
    const g = JSON.parse(localStorage.getItem(CLAVE) ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(CLAVES_MEDIDA.flatMap((k) => {
      const v = g[k];
      return typeof v === "number" && v > 0 && v < 300 ? [[k, v]] : [];
    }));
  } catch { return {}; }
}

export function useMedidas() {
  const [medidas, setMedidas] = useState<MedidasCliente>({});
  useEffect(() => {
    setMedidas(leer());
    // Otra parte de la página (o otra pestaña) las cambió.
    const alCambiar = () => setMedidas(leer());
    window.addEventListener(EVENTO, alCambiar);
    const alGuardar = (e: StorageEvent) => { if (e.key === CLAVE) alCambiar(); };
    window.addEventListener("storage", alGuardar);
    return () => { window.removeEventListener(EVENTO, alCambiar); window.removeEventListener("storage", alGuardar); };
  }, []);
  const guardar = useCallback((m: MedidasCliente) => {
    setMedidas(m);
    try { localStorage.setItem(CLAVE, JSON.stringify(m)); } catch { /* modo privado */ }
    window.dispatchEvent(new Event(EVENTO));
  }, []);
  return { medidas, guardar };
}
