"use client";
import { useEffect } from "react";

/*
 * Marca <html data-hidratado> cuando la página ya tiene su JavaScript andando.
 * La usan las pruebas en navegador para no tocar un botón antes de tiempo.
 */
export function Hidratado() {
  useEffect(() => { document.documentElement.dataset.hidratado = "1"; }, []);
  return null;
}
