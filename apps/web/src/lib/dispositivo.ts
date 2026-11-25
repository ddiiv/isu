"use client";

/*
 * El identificador al azar de este navegador para la ruleta de quien no tiene cuenta. Se guarda en localStorage; el servidor sólo
 * guarda su hash y es el que decide (uno por dispositivo y semana, y un tope por conexión): borrarlo no da giros de más.
 * Sin localStorage (modo privado) vale mientras la pestaña esté abierta.
 */
const CLAVE = "isu:ruleta";
let enMemoria: string | null = null;

const nuevo = () => {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const valido = (t: string | null): t is string => !!t && /^[A-Za-z0-9_-]{32,64}$/.test(t);

/** `crear = false`: sólo lee (para mirar si ya hay cupones sin dejar un identificador de más). */
export function leerDispositivo(crear: boolean): string | null {
  try {
    const t = localStorage.getItem(CLAVE);
    if (valido(t)) return t;
    if (!crear) return enMemoria;
    const n = enMemoria ?? nuevo();
    localStorage.setItem(CLAVE, n);
    return n;
  } catch {
    if (!crear) return enMemoria;
    return (enMemoria ??= nuevo());
  }
}
